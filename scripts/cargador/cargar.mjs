#!/usr/bin/env node
// Cargador idempotente de asientos y pedidos historicos. Lee las fuentes privadas por ruta (--archivos); NO guarda ni imprime datos personales.
//   node scripts/cargador/cargar.mjs --archivos <carpeta> --dry-run
//   DATABASE_URL=postgresql://... node scripts/cargador/cargar.mjs --archivos <carpeta> [--lote N | --hasta-lote N] [--con-destinatarios]
// Solo usa funciones existentes del sistema (api.* y operacion.* con la identidad de un socio). Una segunda corrida no cambia nada (clave de idempotencia por operacion).
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { leerFuentes, leerAlias } from './fuentes.mjs';
import { construirPlan, resumenPlan, LOTES } from './plan.mjs';
import { conectar, uuidsSocios, crearContexto, ejecutarPaso, estadoBase, prerrequisitos, hayPersonaBodega, MENSAJE_PERSONA_BODEGA } from './db.mjs';

const { values: a } = parseArgs({
  options: {
    archivos: { type: 'string' }, url: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, lote: { type: 'string' }, 'hasta-lote': { type: 'string' },
    actor: { type: 'string', default: 'Javier' }, duenio: { type: 'string', default: 'Javier' }, 'con-destinatarios': { type: 'boolean', default: false }, 'sabor-obsequio': { type: 'string' },
    'verificar-estado': { type: 'boolean', default: false }, 'verificar-conteos': { type: 'boolean', default: false }, 'forzar-no-vacia': { type: 'boolean', default: false }, salida: { type: 'string' }, ayuda: { type: 'boolean', default: false },
  },
});
if (a.ayuda || !a.archivos) {
  console.log('Uso: cargar.mjs --archivos <carpeta> [--dry-run] [--verificar-estado] [--lote N | --hasta-lote N] [--con-destinatarios] [--actor Javier] [--sabor-obsequio "<sabor>"] [--url <DATABASE_URL>] [--salida <archivo.json>]');
  process.exit(a.ayuda ? 0 : 2);
}

const dominio = leerFuentes(a.archivos);
const alias = leerAlias(a.archivos);
const llave = a['con-destinatarios'] ? process.env.DS_LLAVE_DESTINATARIO : null;
if (a['con-destinatarios'] && (!llave || llave.length < 32)) { console.error('--con-destinatarios exige DS_LLAVE_DESTINATARIO (minimo 32 caracteres) en el entorno.'); process.exit(2); }
const plan = construirPlan(dominio, alias, { actor: a.actor, duenio: a.duenio, conDestinatarios: a['con-destinatarios'], saborObsequioPendiente: a['sabor-obsequio'] ?? null });
const desde = a.lote ? Number(a.lote) : 1;
const hasta = a.lote ? Number(a.lote) : a['hasta-lote'] ? Number(a['hasta-lote']) : 99;
const seleccion = plan.pasos.filter((p) => p.lote >= desde && p.lote <= hasta);

const r = resumenPlan(plan);
console.log(`Plan: ${r.total} pasos. ${Object.entries(r.lotes).map(([l, n]) => `lote ${l} (${LOTES[l]}): ${n}`).join('; ')}`);
for (const w of plan.advertencias) console.log(`Advertencia: ${w}`);

if (a['dry-run'] && !a['verificar-estado'] && !a['verificar-conteos']) {
  for (const p of seleccion) if (p.lote > 1) console.log(`  [lote ${p.lote}] ${p.tipo}: ${p.desc}`);
  const cat = {};
  for (const p of seleccion.filter((x) => x.lote === 1)) cat[p.tipo] = (cat[p.tipo] ?? 0) + 1;
  if (Object.keys(cat).length) console.log(`  [lote 1] ${Object.entries(cat).map(([t, n]) => `${t}: ${n}`).join(', ')}`);
  console.log('Dry-run: no se conecto a ninguna base ni se escribio nada.');
  process.exit(0);
}

const url = a.url ?? process.env.DATABASE_URL;
if (!url) { console.error('Falta --url o DATABASE_URL.'); process.exit(2); }
const client = await conectar(url);
if (a['verificar-estado'] || a['verificar-conteos']) await client.query('begin read only');
let codigo = 0;
try {
  const est = await estadoBase(client);
  console.log(`Estado de la base: ${JSON.stringify(est)}`);
  if (a['verificar-conteos']) {
    // Solo lectura: lo que la carga debe haber dejado (base destino vacia antes de cargar) contra lo que hay.
    const esperado = {
      pedidos: dominio.pedidos.length, compras: dominio.compras.length, pagos_de_clientes: dominio.cobros.filter((c) => !c.omitido).length,
      pagos_de_socios_a_proveedores: dominio.capital.length + dominio.compras.reduce((s, c) => s + c.aportes.length, 0), movimientos_merma: dominio.bajas.length,
    };
    const q = async (sql) => Number((await client.query(sql)).rows[0].n);
    const real = {
      pedidos: await q('select count(*) n from operacion.pedido'), compras: await q('select count(*) n from operacion.compra'), pagos_de_clientes: await q('select count(*) n from operacion.pago'),
      pagos_de_socios_a_proveedores: await q("select count(*) n from operacion.cuenta_proveedor_mov where concepto = 'pago_socio'"), movimientos_merma: await q("select count(*) n from operacion.movimiento_inventario where tipo = 'merma'"),
    };
    let ok = true;
    for (const k of Object.keys(esperado)) {
      const bien = esperado[k] === real[k];
      ok = ok && bien;
      console.log(`  [${bien ? 'OK ' : 'DIF'}] ${k}: esperado ${esperado[k]}, en la base ${real[k]}`);
    }
    const pendientes = await q("select count(*) n from seguridad.operacion where clave like 'carga:%' and resultado is null");
    console.log(`  [${pendientes === 0 ? 'OK ' : 'DIF'}] operaciones de la carga sin terminar: ${pendientes}`);
    await client.end();
    process.exit(ok && pendientes === 0 ? 0 : 1);
  }
  if (a['verificar-estado']) {
    // Solo lectura: ningun INSERT, UPDATE ni llamada a funciones de escritura.
    const pre = await prerrequisitos(client, plan);
    for (const i of pre.items) console.log(`  [${i.ok ? 'OK ' : i.aviso ? 'AVISO' : 'FALTA'}] ${i.texto}`);
    console.log(`  Catalogo: ${pre.modelosNuevos} de ${pre.modelosPlan} modelos del plan no existen todavia (se crean en el lote 1).`);
    console.log(pre.ok ? 'Verificacion de solo lectura: la base esta lista para la carga.' : 'Verificacion de solo lectura: HAY PRERREQUISITOS SIN CUMPLIR; no cargar.');
    await client.end();
    process.exit(pre.ok ? 0 : 1);
  }
  const pre = await prerrequisitos(client, plan);
  const faltan = pre.items.filter((i) => !i.ok && !i.aviso && !(a['forzar-no-vacia'] && i.id === 'vacia')).map((i) => i.texto);
  if (faltan.length) throw new Error(`prerrequisitos sin cumplir: ${faltan.join(' | ')}`);
  const socios = await uuidsSocios(client);
  const ctx = crearContexto();
  const log = [];
  // Los pasos de lotes anteriores dejan ids que los siguientes usan: se re-ejecutan en modo idempotente y deben NO cambiar nada (si cambian, el lote anterior no estaba cargado y se aborta).
  const previos = plan.pasos.filter((p) => p.lote < desde);
  for (const p of previos) await ejecutarPaso(client, p, ctx, { socios, llave, exigirSinCambio: true });
  let nuevos = 0, iguales = 0;
  for (const p of seleccion) {
    if (p.lote >= 5 && !(await hayPersonaBodega(client))) throw new Error(MENSAJE_PERSONA_BODEGA);
    const t0 = Date.now();
    const res = await ejecutarPaso(client, p, ctx, { socios, llave });
    if (res.cambio) nuevos += 1; else iguales += 1;
    log.push({ lote: p.lote, tipo: p.tipo, desc: p.desc, cambio: res.cambio, ms: Date.now() - t0 });
    if (res.cambio) console.log(`  OK  [lote ${p.lote}] ${p.desc}`);
  }
  console.log(`Resultado: ${nuevos} pasos aplicados, ${iguales} sin cambios (ya estaban cargados).`);
  if (a.salida) writeFileSync(a.salida, JSON.stringify({ nuevos, iguales, log }, null, 1), { mode: 0o600 });
} catch (e) {
  console.error(`FALLO${e.paso ? ` en "${e.paso}"` : ''}: ${e.code ?? ''} ${String(e.message).split('\n')[0]}`);
  codigo = 1;
} finally {
  await client.end();
}
process.exit(codigo);
