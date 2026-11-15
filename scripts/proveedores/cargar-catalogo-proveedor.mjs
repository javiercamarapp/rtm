#!/usr/bin/env node
// Registra en el catalogo propio los modelos y TODOS los sabores (disponibles y no disponibles) que ve un proveedor.
//
//   RTM_DB_URL=<url> node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=karen --tienda=<products.json> --verificar|--aplicar
//   RTM_DB_URL=<url> node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac --verificar|--aplicar        (lee scripts/catalogo/isaac-remate.json)
//
// --verificar: hace TODO dentro de una transaccion y la revierte (dice que crearia). --aplicar: confirma.
// Reglas: marcas, modelos y sabores se escriben en MAYUSCULAS en pantalla (la base guarda el nombre y la mayuscula es presentacion); los IGUALES se fusionan (asegurar_*);
// los PARECIDOS (candidatos del plan, o nombres que la base rechaza por casi iguales) NO se crean ni se unen: salen en `por confirmar`. Cada sabor nuevo nace con existencia 0 (solo se crea el sku).
// Isaac ademas guarda su stock DISPONIBLE (proveedores.guardar_stock_isaac). El costo de Waka Blast 45K (210) se fija como costo de lista de Isaac SUPUESTO. NUNCA se leen precios de la tienda.
// Idempotente: una segunda corrida no cambia nada. La base se abre con identidad de socio (request.jwt.claim.sub) y canal 'importacion'. No imprime secretos ni la direccion de la tienda.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compacta, cargarAliasWaka } from './conciliar-marcas.mjs';
import { itemsDeIsaac, itemsDeTienda, nombreModelo, planificar, puffsExactos, saboresUnicos } from './plan-catalogo.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function leerCatalogo(c) {
  const modelos = (await c.query(`select m.id, ma.nombre as marca, m.nombre_canonico as n from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where m.unificado_en is null order by m.id`)).rows;
  const alias = (await c.query('select modelo_id, alias_norm from catalogo.modelo_alias where modelo_id is not null')).rows;
  const al = new Map();
  for (const a of alias) al.set(a.modelo_id, [...(al.get(a.modelo_id) ?? []), a.alias_norm]);
  const marcas = (await c.query('select nombre from catalogo.marca where unificado_en is null')).rows.map((r) => r.nombre);
  return { catalogo: modelos.map((m) => ({ id: Number(m.id), marca: m.marca, n: m.n, al: al.get(m.id) ?? [] })), marcas };
}

/** Marca existente que se escribe igual (mayusculas, espacios, guiones); si no existe, el nombre tal cual lo da la fuente. */
export function marcaFinal(marca, marcas) {
  return marcas.find((m) => compacta(m) === compacta(marca)) ?? String(marca).trim();
}

async function intentar(c, nombre, fn) {
  await c.query(`savepoint ${nombre}`);
  try {
    const r = await fn();
    await c.query(`release savepoint ${nombre}`);
    return { ok: true, valor: r };
  } catch (e) {
    await c.query(`rollback to savepoint ${nombre}`);
    await c.query(`release savepoint ${nombre}`);
    return { ok: false, error: String(e.message ?? e).split('\n')[0] };
  }
}

export async function cargar(c, { fuente, items, modo, aliasWaka, propuestas, hoy }) {
  const { catalogo, marcas } = await leerCatalogo(c);
  const plan = planificar(items, catalogo, { aliasWaka, propuestas, modo });
  const resumen = { fuente, modelosEnFuente: items.length, coinciden: plan.coincide.length, modelosCreados: 0, saboresEnFuente: 0, skusCreados: 0, skusYaExistian: 0, saboresNuevos: 0, porConfirmar: [], rechazados: [], costos: 0 };
  for (const p of plan.porConfirmar) resumen.porConfirmar.push({ tipo: 'modelo', fuente: p.item.titulo, candidatos: p.candidatos, motivo: p.motivo });

  const aCargar = plan.coincide.map((x) => ({ item: x.item, id: x.modeloId, nombre: catalogo.find((m) => m.id === x.modeloId).n, nuevo: false }));
  for (const it of plan.nuevo) {
    const nombre = nombreModelo(it.titulo);
    const r = await intentar(c, 'sp_modelo', async () => (await c.query('select catalogo.asegurar_modelo($1, $2, $3, $4, $5, $6) as id', [marcaFinal(it.marca, marcas), nombre, it.puffs ?? puffsExactos(it.titulo), 'ambas', 'disponible', null])).rows[0].id);
    if (!r.ok) { resumen.rechazados.push({ tipo: 'modelo', fuente: it.titulo, motivo: r.error }); continue; }
    resumen.modelosCreados += 1;
    aCargar.push({ item: it, id: Number(r.valor), nombre, nuevo: true });
  }

  const stock = [];
  for (const m of aCargar) {
    const saborIds = [];
    for (const s of saboresUnicos(m.item)) {
      resumen.saboresEnFuente += 1;
      // Repetido EXACTO (mismo nombre salvo mayusculas, espacios, guiones o acentos): se fusiona con el que ya existe (regla del dueno, 14-nov).
      const exacto = (await c.query('select nombre_canonico from catalogo.sabor where unificado_en is null and catalogo.llave_exacta(nombre_canonico) = catalogo.llave_exacta($1) order by id limit 1', [s.nombre])).rows[0];
      if (exacto) s.nombre = exacto.nombre_canonico;
      const antes = (await c.query('select id from catalogo.sabor where nombre_norm = catalogo.normalizar($1)', [s.nombre])).rowCount;
      const r = await intentar(c, 'sp_sku', async () => {
        const ya = (await c.query('select k.id, k.sabor_id from catalogo.sku k join catalogo.sabor sb on sb.id = k.sabor_id where k.modelo_id = $1 and sb.nombre_norm = catalogo.normalizar($2)', [m.id, s.nombre])).rows[0];
        if (ya) return { existia: true, sabor: ya.sabor_id };
        const id = (await c.query('select catalogo.asegurar_sku($1, $2) as id', [m.nombre, s.nombre])).rows[0].id;
        return { existia: false, sabor: (await c.query('select sabor_id from catalogo.sku where id = $1', [id])).rows[0].sabor_id };
      });
      if (!r.ok) { resumen.rechazados.push({ tipo: 'sabor', fuente: `${m.nombre} / ${s.nombre}`, motivo: r.error }); continue; }
      if (r.valor.existia) resumen.skusYaExistian += 1; else resumen.skusCreados += 1;
      if (!antes && !r.valor.existia) resumen.saboresNuevos += 1;
      saborIds.push(Number(r.valor.sabor));
    }
    stock.push({ modelo_id: m.id, sabores: saborIds });
  }

  if (fuente === 'isaac') {
    await c.query('select proveedores.guardar_stock_isaac($1::jsonb, $2)', [JSON.stringify(stock), 'catalogo Remate de Isaac']);
    for (const m of aCargar) {
      if (!m.item.costoMxn) continue;
      const r = await intentar(c, 'sp_costo', async () => c.query('select catalogo.fijar_costo($1, $2, $3, $4, $5, $6, $7, $8) as r', [`isaac-remate-costo-${compacta(m.nombre)}`, 'Isaac', m.nombre, Math.round(m.item.costoMxn * 100), hoy, 'dueno 15-nov (de palabra)', null, true]));
      if (r.ok) resumen.costos += 1; else resumen.rechazados.push({ tipo: 'costo', fuente: m.nombre, motivo: r.error });
    }
  }
  // Los sabores parecidos (no iguales) entran a la cola de preguntas de los socios; nunca se unen solos.
  resumen.preguntasDeParecidos = (await c.query("select catalogo.escanear_duplicados('sabor') as r")).rows[0].r;
  return resumen;
}

/** Una corrida completa en UNA transaccion con identidad de socio y canal 'importacion'. aplicar=false revierte. Devuelve el resumen. */
export async function ejecutar({ url, fuente, items, aplicar, aliasWaka, propuestas }) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    const socio = (await c.query("select id from seguridad.usuario where rol = 'socio' and activo order by id limit 1")).rows[0];
    if (!socio) throw new Error('no hay un usuario socio activo');
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('rtm.canal', 'importacion', true)", [socio.id]);
    const hoy = (await c.query('select negocio.hoy() as d')).rows[0].d;
    const r = await cargar(c, { fuente, items, modo: fuente, aplicar, aliasWaka, propuestas, hoy });
    await c.query(aplicar ? 'commit' : 'rollback');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

export function leerReglas() {
  const aliasWaka = cargarAliasWaka(join(RAIZ, 'scripts', 'catalogo', 'alias-waka.json'));
  const propuestas = new Map(JSON.parse(readFileSync(join(RAIZ, 'scripts', 'catalogo', 'marcas-modelos.json'), 'utf8')).modelos.map((m) => [m.id, m.marca]));
  return { aliasWaka, propuestas };
}

export function imprimir(r, aplicar) {
  console.log(`${aplicar ? 'APLICADO' : 'VERIFICADO (revertido)'}: ${JSON.stringify({ ...r, porConfirmar: r.porConfirmar.length, rechazados: r.rechazados.length })}`);
  for (const p of r.porConfirmar) console.log(`  POR CONFIRMAR ${p.fuente}: ${p.motivo}; candidatos ${p.candidatos.join(', ')}`);
  for (const p of r.rechazados) console.log(`  RECHAZADO (${p.tipo}) ${p.fuente}: ${p.motivo}`);
}

function argumentos(av) {
  const v = (n) => av.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  return { aplicar: av.includes('--aplicar'), verificar: av.includes('--verificar'), fuente: v('fuente'), tienda: v('tienda') };
}

async function principal() {
  const a = argumentos(process.argv.slice(2));
  if (a.aplicar === a.verificar || !['karen', 'isaac'].includes(a.fuente ?? '') || (a.fuente === 'karen' && !a.tienda)) {
    console.error('Uso: cargar-catalogo-proveedor.mjs --fuente=karen --tienda=<products.json> | --fuente=isaac  con --verificar | --aplicar (y RTM_DB_URL)');
    return 2;
  }
  if (!process.env.RTM_DB_URL) { console.error('Falta RTM_DB_URL.'); return 2; }
  const items = a.fuente === 'karen' ? itemsDeTienda(JSON.parse(readFileSync(a.tienda, 'utf8'))) : itemsDeIsaac(JSON.parse(readFileSync(join(RAIZ, 'scripts', 'catalogo', 'isaac-remate.json'), 'utf8')));
  try {
    imprimir(await ejecutar({ url: process.env.RTM_DB_URL, fuente: a.fuente, items, aplicar: a.aplicar, ...leerReglas() }), a.aplicar);
    return 0;
  } catch (e) {
    console.error(`Error: ${String(e.message ?? e).split('\n')[0]}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await principal());
