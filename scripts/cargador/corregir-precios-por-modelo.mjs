#!/usr/bin/env node
// CORRECCION DE PRECIOS POR MODELO de pedidos enviados (decision del dueno, 14-nov). Los datos reales NO viven en el repo: entran con --datos <archivo JSON privado>
// (formato y validacion en correccion-precios-lib.mjs; ejemplo ficticio en test/fixtures/cargador/precios-por-modelo-ejemplo.json).
//   DATABASE_URL=... node scripts/cargador/corregir-precios-por-modelo.mjs --datos <ruta> --verificar   (solo lectura: antes/despues, totales que no cambian, renglones bajo costo)
//   DATABASE_URL=... node scripts/cargador/corregir-precios-por-modelo.mjs --datos <ruta> --aplicar     (usa SOLO la funcion oficial operacion.corregir_precio_por_modelo; una transaccion por pedido)
// Se corre DESPUES del despliegue de la migracion 20261115400000. No imprime nombres de clientes ni datos personales. --actor (por omision Javier) es el socio que firma.
// Idempotente: clave fija por pedido; una segunda corrida dice "sin cambio" y no escribe nada. Si algo no cuadra, el pedido no se toca.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { leerDatos, validarObjetivo, preciosCentavos, renglonesBajoCosto, claveCorreccion } from './correccion-precios-lib.mjs';

const { values: a } = parseArgs({ options: { datos: { type: 'string' }, verificar: { type: 'boolean', default: false }, aplicar: { type: 'boolean', default: false }, actor: { type: 'string', default: 'Javier' }, url: { type: 'string' } } });
if (a.verificar === a.aplicar) { console.error('Indica exactamente una opcion: --verificar o --aplicar.'); process.exit(2); }
const url = a.url ?? process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL o --url.'); process.exit(2); }
if (!a.datos) { console.error('Falta --datos <archivo JSON privado con los folios, modelos y precios>.'); process.exit(2); }
let OBJETIVO;
try { OBJETIVO = leerDatos(JSON.parse(readFileSync(a.datos, 'utf8'))); } catch (e) { console.error(`Error: ${e.message}`); process.exit(2); }
const errs = validarObjetivo(OBJETIVO);
if (errs.length) { console.error(`Los datos no cuadran:\n${errs.join('\n')}`); process.exit(2); }

const peso = (c) => (Number(c) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const c = new pg.Client({ connectionString: url });
await c.connect();
let fallo = false;

/** Estado de un pedido (solo lectura): renglones por modelo, totales y utilidad. */
async function estado(folio) {
  const ped = (await c.query('select id, estado, recargo_cent, envio_cent, descuento_cent from operacion.pedido where folio = $1', [folio])).rows[0];
  if (!ped) throw new Error(`${folio}: no existe en esta base`);
  const lineas = (await c.query(
    `select m.nombre_canonico as modelo, l.piezas_surtidas as piezas, l.precio_cent, l.costo_unit_cent
       from operacion.pedido_linea l join catalogo.modelo m on m.id = l.modelo_id where l.pedido_id = $1 order by m.nombre_canonico, l.id`, [ped.id])).rows
    .map((l) => ({ ...l, piezas: Number(l.piezas), precio_cent: Number(l.precio_cent), costo_unit_cent: l.costo_unit_cent == null ? null : Number(l.costo_unit_cent) }));
  const nota = (await c.query(`select folio_documento, total_cent, (snapshot_cliente->>'subtotal_cent')::bigint as subtotal_cent from operacion.nota where pedido_id = $1 order by id desc limit 1`, [ped.id])).rows[0];
  const util = (await c.query('select utilidad_total_cent, costo_cent from operacion.v_ds_pedido where pedido_id = $1', [ped.id])).rows[0];
  const cob = (await c.query('select operacion.pedido_cobrado($1) as cobrado, operacion.pedido_saldo($1) as saldo', [ped.id])).rows[0];
  const porModelo = new Map();
  for (const l of lineas) {
    const m = porModelo.get(l.modelo) ?? { modelo: l.modelo, piezas: 0, venta: 0, costo: 0, renglones: 0, pmin: Infinity, pmax: 0 };
    m.piezas += l.piezas; m.venta += l.piezas * l.precio_cent; m.costo += l.piezas * (l.costo_unit_cent ?? 0); m.renglones += 1;
    m.pmin = Math.min(m.pmin, l.precio_cent); m.pmax = Math.max(m.pmax, l.precio_cent);
    porModelo.set(l.modelo, m);
  }
  return { ped, lineas, nota, util, cob, modelos: [...porModelo.values()] };
}

function huella(e) {
  return { subtotal: Number(e.nota?.subtotal_cent), total_nota: Number(e.nota?.total_cent), recargo: Number(e.ped.recargo_cent), utilidad: Number(e.util?.utilidad_total_cent), costo: Number(e.util?.costo_cent),
           cobrado: Number(e.cob.cobrado), saldo: Number(e.cob.saldo) };
}

async function reportar(folio, e) {
  const precios = preciosCentavos(OBJETIVO, folio);
  const faltan = e.modelos.filter((m) => !(m.modelo in precios)).map((m) => m.modelo);
  const sobran = Object.keys(precios).filter((m) => !e.modelos.some((x) => x.modelo === m));
  console.log(`\n== ${folio} (estado ${e.ped.estado}) ==`);
  if (faltan.length || sobran.length) { console.log(`  DIFERENCIA de modelos con lo esperado. En el pedido y no en el objetivo: ${faltan.join(', ') || '-'}; en el objetivo y no en el pedido: ${sobran.join(', ') || '-'}`); fallo = true; }
  let sumaNueva = 0;
  for (const m of e.modelos) {
    const nuevo = precios[m.modelo];
    const pz = OBJETIVO[folio].piezas?.[m.modelo] ?? null;
    if (pz != null && pz !== m.piezas) { console.log(`  DIFERENCIA de piezas en ${m.modelo}: pedido ${m.piezas}, objetivo ${pz}`); fallo = true; }
    if (nuevo != null) sumaNueva += m.piezas * nuevo;
    const costoU = m.piezas ? m.costo / m.piezas : 0;
    const antes = m.pmin === m.pmax ? peso(m.pmin) : `${peso(m.pmin)}-${peso(m.pmax)}`;
    console.log(`  ${m.modelo.padEnd(18)} ${String(m.piezas).padStart(4)} pz | costo ${peso(costoU)} | precio antes ${antes} -> despues ${nuevo != null ? peso(nuevo) : '?'} | venta antes ${peso(m.venta)} -> despues ${nuevo != null ? peso(m.piezas * nuevo) : '?'} | margen despues ${nuevo != null ? peso(nuevo - costoU) : '?'}`);
  }
  const h = huella(e);
  const ok = sumaNueva === h.subtotal;
  console.log(`  Suma por modelo (despues) ${peso(sumaNueva)} contra subtotal vigente ${peso(h.subtotal)} y total del objetivo ${peso(OBJETIVO[folio].total_pesos * 100)}: ${ok && sumaNueva === OBJETIVO[folio].total_pesos * 100 ? 'CUADRA' : 'NO CUADRA'}`);
  if (!ok || sumaNueva !== OBJETIVO[folio].total_pesos * 100) fallo = true;
  console.log(`  Totales que NO cambian: total de nota ${peso(h.total_nota)}, recargo ${peso(h.recargo)}, costo ${peso(h.costo)}, utilidad ${peso(h.utilidad)}, cobrado ${peso(h.cobrado)}, saldo ${peso(h.saldo)}`);
  const bajoAntes = renglonesBajoCosto(e.lineas);
  const bajoDespues = renglonesBajoCosto(e.lineas.map((l) => ({ ...l })), precios);
  console.log(`  Renglones bajo costo: antes ${bajoAntes} de ${e.lineas.length}, despues ${bajoDespues}`);
  return { bajoAntes, bajoDespues, renglones: e.lineas.length };
}

try {
  const u = await c.query("select id from seguridad.usuario where rol = 'socio' and socio_nombre = $1 and activo", [a.actor]);
  if (!u.rows[0]) throw new Error(`no hay usuario socio activo ${a.actor}`);
  const hayFuncion = (await c.query("select count(*)::int n from pg_proc where proname = 'corregir_precio_por_modelo' and pronamespace = 'operacion'::regnamespace")).rows[0].n;
  if (!hayFuncion) throw new Error('la base no tiene operacion.corregir_precio_por_modelo: despliega primero la migracion 20261115400000');
  let tAntes = 0; let tDespues = 0; let tRen = 0;
  if (a.verificar) {
    await c.query('begin read only');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u.rows[0].id]);
    for (const folio of Object.keys(OBJETIVO)) { const r = await reportar(folio, await estado(folio)); tAntes += r.bajoAntes; tDespues += r.bajoDespues; tRen += r.renglones; }
    await c.query('rollback');
    console.log(`\nRenglones bajo costo en total: antes ${tAntes} de ${tRen}, despues ${tDespues}.`);
    console.log(fallo ? '\nVERIFICACION CON DIFERENCIAS: NO apliques. Revisa lo marcado arriba.' : '\nVERIFICACION LIMPIA. Solo lectura: no se escribio nada.');
    process.exitCode = fallo ? 1 : 0;
  } else {
    for (const folio of Object.keys(OBJETIVO)) {
      await c.query('begin');
      try {
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u.rows[0].id]);
        const antes = await estado(folio);
        const r = await c.query('select operacion.corregir_precio_por_modelo($1, $2, $3::jsonb, $4) as r',
          [claveCorreccion(folio), antes.ped.id, JSON.stringify(preciosCentavos(OBJETIVO, folio)), 'correccion con datos privados del dueno, 14-nov']);
        await c.query('set constraints all immediate');
        const despues = await estado(folio);
        const h1 = JSON.stringify(huella(antes)); const h2 = JSON.stringify(huella(despues));
        if (h1 !== h2) throw new Error(`${folio}: los totales cambiaron (${h1} contra ${h2}); no se aplica`);
        await c.query('commit');
        const res = r.rows[0].r;
        console.log(`${folio}: ${res.estado}${res.repetido ? ' (repetido)' : ''}${res.nota ? `, nota ${res.nota}` : ''}; totales identicos; renglones bajo costo ${renglonesBajoCosto(antes.lineas)} -> ${renglonesBajoCosto(despues.lineas)}`);
      } catch (e) {
        await c.query('rollback').catch(() => {});
        console.error(`${folio}: NO aplicado (${e.message})`);
        fallo = true;
      }
    }
    console.log(fallo ? '\nTERMINO CON ERRORES: los pedidos marcados no se tocaron. Corre --verificar.' : '\nListo. Corre --verificar para ver el resultado y el cuadre completo (cuadre.mjs) para las comprobaciones C1..C24.');
    process.exitCode = fallo ? 1 : 0;
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
