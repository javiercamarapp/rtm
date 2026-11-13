#!/usr/bin/env node
// CUADRE completo de la carga, solo lectura. Dos vias contra la base:
//   Via 1 (libro): operacion.cuadre_socios (libro conciliado), comprobaciones C1..C24 y CU1..CU3, balance, estado de resultados, capital por mes.
//   Via 2 (auxiliares): saldos por pedido, posicion con proveedores, kardex, cuenta de los socios, renta devengada (todo leido de las tablas operativas).
// Y las compara con las CIFRAS OBJETIVO de un archivo PRIVADO (--objetivo): las cifras reales nunca viven en el repo.
//   DATABASE_URL=... node scripts/cargador/cuadre.mjs --objetivo <objetivo.json> [--actor Javier] [--json <salida.json>]
// Formato del objetivo (centavos): { utilidad_neta, utilidad_por_socio:{Javier,Angelo}, capital, aportacion_neta:{..}, diferencia_a_igualar, le_toca_aportar,
//   valuacion_personal:{..}, saldo_karen_por_pagar, saldo_isaac_por_pagar, por_cobrar_clientes, por_cobrar_karen, por_cobrar_isaac, pedido_socio_a_costo, inventario,
//   mercancia_por_recibir, fondos_en_poder:{Angelo}, activo_total, efectivo, utilidad_por_mes:{"AAAA-MM": n} }
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { fmt } from './lib.mjs';

const { values: a } = parseArgs({ options: { objetivo: { type: 'string' }, actor: { type: 'string', default: 'Javier' }, url: { type: 'string' }, json: { type: 'string' } } });
const url = a.url ?? process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL o --url.'); process.exit(2); }
const objetivo = a.objetivo ? JSON.parse(readFileSync(a.objetivo, 'utf8')) : null;
const TOL_REDONDEO = 10; // centavos de tolerancia por redondeo del costo promedio movil

const c = new pg.Client({ connectionString: url });
await c.connect();
const filas = [];
const rojas = [];
try {
  await c.query('begin read only');
  const u = await c.query("select id from seguridad.usuario where rol = 'socio' and socio_nombre = $1 and activo", [a.actor]);
  if (!u.rows[0]) throw new Error(`no hay usuario socio activo ${a.actor}`);
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u.rows[0].id]);
  const j = async (sql, p = []) => (await c.query(sql, p)).rows[0].r;
  const n = async (sql, p = []) => Number((await c.query(sql, p)).rows[0].n);

  // ---------- Via 1: libro ----------
  const cuadre = await j('select operacion.cuadre_socios() as r');
  const compro = await j('select api.conta_comprobaciones() as r');
  const balance = await j('select api.conta_balance(null) as r');
  const er = await j("select api.conta_estado_resultados('2000-01-01','2999-12-31') as r");
  const cap = await j('select api.capital_por_mes(null, null) as r');
  const neta = await j('select api.socios_aportacion_neta() as r');
  const saldo = (arr, cod) => Number(arr.find((x) => x.codigo === cod)?.monto_cent ?? 0);
  const utilidadLibro = saldo(balance.capital, '4-7');
  const ingresos = er.lineas.filter((l) => l.tipo === 'I').reduce((s, l) => s + Number(l.monto_cent), 0);
  const egresos = er.lineas.filter((l) => l.tipo === 'C' || l.tipo === 'G').reduce((s, l) => s + Number(l.monto_cent), 0);

  // ---------- Via 2: auxiliares ----------
  const renta = await n('select coalesce(sum(monto_cent),0) n from operacion.renta_devengo');
  const cxcAux = await n("select coalesce(sum(operacion.pedido_saldo(id)),0) n from operacion.pedido where estado = 'enviado'");
  const cxcOrigen = async (cond) => n(`select coalesce(sum(operacion.pedido_saldo(pe.id)),0) n from operacion.pedido pe left join operacion.pedido_ds pd on pd.pedido_id = pe.id where pe.estado = 'enviado' and ${cond}`);
  const cxcKaren = await cxcOrigen("(pe.origen in ('karen_directo','karen_via_isaac','bodega_omar')) and coalesce(pd.tipo_venta,'cliente') = 'cliente'");
  const cxcIsaac = await cxcOrigen("pe.origen = 'isaac_directo' and coalesce(pd.tipo_venta,'cliente') = 'cliente'");
  const cxcSocio = await cxcOrigen("pd.tipo_venta = 'socio_a_costo'");
  const posKaren = await n("select operacion.ds_posicion_proveedor(catalogo.proveedor_id('Karen')) n");
  const posIsaac = await n("select operacion.ds_posicion_proveedor(catalogo.proveedor_id('Isaac')) n");
  const kardex = await n('select coalesce(sum(valor_cent),0) n from operacion.existencia_modelo');
  const piezas = await n('select coalesce(sum(piezas),0) n from operacion.existencia_modelo');
  const fondos = async (s) => n('select coalesce(operacion.saldo_socio(id, $2),0) n from catalogo.socio where nombre = $1', [s, 'fondos']);
  const fondosAng = await fondos('Angelo');
  const fondosJav = await fondos('Javier');
  const sinRecibir = await n("select coalesce(sum(c.total_cent),0) n from operacion.compra c where c.estado = 'confirmada'");

  const push = (concepto, objetivoV, sistema, extra = {}) => filas.push({ concepto, objetivo: objetivoV ?? null, sistema, ...extra });

  // ---------- Comprobaciones ----------
  const verif = cuadre.verificaciones ?? [];
  const verifRojas = verif.filter((x) => !x.ok).map((x) => x.id);
  const comprob = compro.comprobaciones ?? [];
  const comprobRojas = comprob.filter((x) => !x.ok).map((x) => x.codigo);
  const faltaC = ['C1', 'C24', 'CU1', 'CU3'].filter((k) => !comprob.some((x) => x.codigo === k));
  const identidad = balance.total_activo_cent === balance.total_pasivo_cent + balance.total_capital_cent;
  const checks = [
    ['Libro conciliado (operacion.cuadre_socios)', cuadre.libro_conciliado === true && verifRojas.length === 0, `${cuadre.etiqueta}; verificaciones ${verif.length}, rojas: ${verifRojas.join(',') || 'ninguna'}`],
    [`Comprobaciones C1..C24 y CU1..CU3 (${comprob.length})`, comprobRojas.length === 0 && comprob.length >= 27 && faltaC.length === 0, `rojas: ${comprobRojas.join(',') || 'ninguna'}`],
    ['Balance: activo = pasivo + capital contable + utilidad (libro)', balance.cuadra === true && identidad, `activo ${fmt(balance.total_activo_cent)} = pasivo ${fmt(balance.total_pasivo_cent)} + capital y utilidad ${fmt(balance.total_capital_cent)}`],
    ['Auxiliares contra mayor (clientes, proveedores, inventario, socios)', (compro.auxiliares ?? []).every((x) => x.ok), `${(compro.auxiliares ?? []).length} auxiliares`],
    ['Utilidad: libro (4-7) = ingresos - egresos del estado de resultados', utilidadLibro === ingresos - egresos, `${fmt(utilidadLibro)} vs ${fmt(ingresos - egresos)}`],
    ['Libro contra auxiliar: clientes (1210) = saldos de pedidos enviados', saldo(balance.activo, '1210') === cxcAux, `${fmt(saldo(balance.activo, '1210'))} vs ${fmt(cxcAux)}`],
    ['Libro contra kardex: inventario (1310) = valor del kardex', saldo(balance.activo, '1310') === kardex, `${fmt(saldo(balance.activo, '1310'))} vs ${fmt(kardex)}`],
    ['Libro contra auxiliar: Karen (2120) = posicion con el proveedor', saldo(balance.pasivo, '2120') === -posKaren, `${fmt(saldo(balance.pasivo, '2120'))} vs ${fmt(-posKaren)}`],
    ['Libro contra auxiliar: Isaac (2110) = posicion con el proveedor', saldo(balance.pasivo, '2110') === -posIsaac, `${fmt(saldo(balance.pasivo, '2110'))} vs ${fmt(-posIsaac)}`],
    ['Libro contra auxiliar: fondos en poder de socios (1150+1160) = cuentas de los socios', saldo(balance.activo, '1150') + saldo(balance.activo, '1160') === fondosAng + fondosJav, `${fmt(fondosAng + fondosJav)}`],
  ];
  for (const [nombre, ok] of checks) if (!ok) rojas.push(nombre);

  // ---------- Comparacion con el objetivo ----------
  if (objetivo) {
    const clasifica = (o, s, { ajuste = 0, tol = 0 } = {}) => {
      const d = s - o;
      if (d === 0) return { estado: 'igual', dif: 0 };
      const resid = d - ajuste;
      if (Math.abs(resid) <= tol && ajuste !== 0) return { estado: 'explicada', dif: d, causa: `renta de bodega ${fmt(Math.abs(ajuste))} y redondeo ${fmt(Math.abs(resid))}` };
      if (ajuste === 0 && Math.abs(d) <= tol) return { estado: 'explicada', dif: d, causa: 'redondeo del costo promedio movil' };
      if (Math.abs(resid) === 0) return { estado: 'explicada', dif: d, causa: `renta de bodega ${fmt(Math.abs(ajuste))}` };
      return { estado: 'DIFERENCIA', dif: d };
    };
    const cmp = (concepto, o, s, opt) => { if (o == null) return; const r = clasifica(o, s, opt); filas.push({ concepto, objetivo: o, sistema: s, ...r }); if (r.estado === 'DIFERENCIA') rojas.push(`objetivo: ${concepto}`); };
    const socio = (nombre) => cap.acumulado.socios.find((x) => x.socio === nombre);
    const netaSocio = (nombre) => neta.socios.find((x) => x.socio === nombre);
    cmp('Utilidad neta conocida', objetivo.utilidad_neta, utilidadLibro, { ajuste: -renta, tol: TOL_REDONDEO });
    for (const s of ['Javier', 'Angelo']) cmp(`Utilidad de ${s} (50 %)`, objetivo.utilidad_por_socio?.[s], socio(s).utilidad_generada_cent, { ajuste: -Math.round(renta / 2), tol: TOL_REDONDEO });
    cmp('Capital aportado', objetivo.capital, saldo(balance.capital, '3110') + saldo(balance.capital, '3120'));
    for (const s of ['Javier', 'Angelo']) cmp(`Aportacion neta de ${s}`, objetivo.aportacion_neta?.[s], netaSocio(s).aportacion_neta_cent);
    cmp('Diferencia a igualar (aportaciones netas)', objetivo.diferencia_a_igualar, Math.max(...neta.socios.map((x) => x.diferencia_a_igualar_cent)));
    if (objetivo.le_toca_aportar) filas.push({ concepto: 'Le toca aportar el siguiente pago', objetivo: objetivo.le_toca_aportar, sistema: neta.le_toca_aportar, estado: objetivo.le_toca_aportar === neta.le_toca_aportar ? 'igual' : 'DIFERENCIA' });
    for (const s of ['Javier', 'Angelo']) cmp(`Valuacion personal de ${s}`, objetivo.valuacion_personal?.[s], socio(s).valuacion_cent, { ajuste: -Math.round(renta / 2), tol: TOL_REDONDEO });
    cmp('Saldo con Karen (por pagarle)', objetivo.saldo_karen_por_pagar, -posKaren);
    cmp('Saldo con Isaac (por pagarle, incluye el pedido a costo del socio)', objetivo.saldo_isaac_por_pagar, -posIsaac);
    cmp('Por cobrar a clientes (Karen e inventario + Isaac)', objetivo.por_cobrar_clientes, cxcKaren + cxcIsaac);
    cmp('  de Karen e inventario de Merida', objetivo.por_cobrar_karen, cxcKaren);
    cmp('  de Isaac', objetivo.por_cobrar_isaac, cxcIsaac);
    cmp('Pedido a costo del socio (pendiente de pago)', objetivo.pedido_socio_a_costo, cxcSocio);
    cmp('Inventario de Merida (kardex)', objetivo.inventario, kardex, { tol: TOL_REDONDEO });
    cmp('Mercancia pedida por recibir (1320)', objetivo.mercancia_por_recibir, saldo(balance.activo, '1320'));
    cmp('Mercancia por recibir segun ordenes confirmadas sin recibir', objetivo.mercancia_por_recibir, sinRecibir);
    for (const [s, v] of Object.entries(objetivo.fondos_en_poder ?? {})) cmp(`Fondos de la sociedad en poder de ${s}`, v, s === 'Angelo' ? fondosAng : fondosJav);
    cmp('Activo total', objetivo.activo_total, balance.total_activo_cent, { tol: TOL_REDONDEO });
    cmp('Efectivo de la sociedad (1101)', objetivo.efectivo, saldo(balance.activo, '1101'));
    for (const [mes, v] of Object.entries(objetivo.utilidad_por_mes ?? {})) {
      const m = cap.meses.find((x) => x.mes === mes);
      cmp(`Utilidad del mes ${mes}`, v, m ? Number(m.periodo.total.utilidad_generada_cent) : 0, { tol: 0 });
    }
    if (objetivo.pasivo_total != null) cmp('Pasivo total', objetivo.pasivo_total, balance.total_pasivo_cent, { ajuste: renta });
  } else {
    push('Utilidad neta (libro)', null, utilidadLibro);
  }
  const extra = [
    ['Existencia de Merida (piezas)', piezas],
    ['Renta de bodega devengada (regla vigente: por pieza enviada desde la bodega)', renta],
    ['Pasivo con Omar (2210)', saldo(balance.pasivo, '2210')],
    ['Total de activo (libro)', balance.total_activo_cent], ['Total de pasivo (libro)', balance.total_pasivo_cent], ['Capital contable y utilidad (libro)', balance.total_capital_cent],
  ];

  console.log('CUADRE de la carga (solo lectura)\n');
  console.log('Comprobaciones del sistema:');
  for (const [nombre, ok, detalle] of checks) console.log(`  [${ok ? 'OK ' : 'ROJA'}] ${nombre} - ${detalle}`);
  if (objetivo) {
    console.log('\nComparacion con las cifras objetivo (tentativas):');
    for (const f of filas) {
      const val = (v) => (typeof v === 'number' ? fmt(v) : String(v ?? '-'));
      console.log(`  [${f.estado ?? '-'}] ${f.concepto}: objetivo ${val(f.objetivo)} | sistema ${val(f.sistema)}${f.dif ? ` | dif ${fmt(f.dif)}` : ''}${f.causa ? ` | causa: ${f.causa}` : ''}`);
    }
  }
  console.log('\nOtras cifras del sistema:');
  for (const [k, v] of extra) console.log(`  ${k}: ${k.includes('piezas') ? v : fmt(v)}`);
  if (a.json) writeFileSync(a.json, JSON.stringify({ checks: checks.map(([nombre, ok, detalle]) => ({ nombre, ok, detalle })), filas, extra, rojas }, null, 1), { mode: 0o600 });
  await c.query('rollback');
} finally {
  await c.end();
}
console.log(rojas.length ? `\nRESULTADO: ${rojas.length} punto(s) por revisar: ${rojas.join('; ')}` : '\nRESULTADO: sin rojas; las diferencias con el objetivo (si las hay) tienen causa identificada.');
process.exit(rojas.length ? 1 : 0);
