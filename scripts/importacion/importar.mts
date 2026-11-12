// Importador DETERMINISTA de catalogo, costos y precios (solo nombre y precios; sin telefonos ni direcciones).
//   npx tsx scripts/importacion/importar.ts --dry-run          cuenta y verifica, no toca la base
//   npx tsx scripts/importacion/importar.ts --verificar        como --dry-run y falla si no salen las cifras del documento (43/19/179/12/17)
//   npx tsx scripts/importacion/importar.ts                    aplica a la base LOCAL (idempotente: correrlo dos veces no cambia nada)
// Los datos reales se leen de los archivos fuente en tiempo de ejecucion; nada de eso se escribe en archivos versionados.
// Fuentes por omision: documento de Angelo en Descargas, notas de memoria de Javier y ~/.rtm-datos/decisiones-importacion.json.
// Para fixtures: --angelo --javier --karen --carpeta-tabuladores --decisiones.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { leerListaAngelo } from '@/dominio/importacion/lista_angelo';
import { leerCostosKaren, leerListaJavier } from '@/dominio/importacion/lista_javier';
import { construirPlan } from '@/dominio/importacion/plan';
import type { ReglaAlias } from '@/dominio/importacion/alias_angelo';
import type { Decisiones } from '@/dominio/importacion/tipos';
import { formatearMoneda } from '@/dominio/formato';
import { normalizar } from '@/dominio/catalogo/normalizar';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const valor = (n: string, def: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : def; };

const memoria = join(homedir(), '.claude/projects/-Users-javiercamaraportepetit/memory');
const rutaAngelo = valor('angelo', join(homedir(), 'Downloads/logica-negocio-angelo.md'));
const rutaJavier = valor('javier', join(memoria, 'clientes-vapes-javier-perfiles.md'));
const rutaKaren = valor('karen', join(memoria, 'software-bodega-merida-decisiones-10nov.md'));
const carpeta = valor('carpeta-tabuladores', join(homedir(), 'Downloads'));
const rutaAlias = valor('alias', '');
const rutaDec = valor('decisiones', join(homedir(), '.rtm-datos/decisiones-importacion.json'));

function leerArchivo(prefijo: string): string | null {
  if (!existsSync(carpeta)) return null;
  const f = readdirSync(carpeta).filter((n) => n.startsWith(`${prefijo}`) && n.endsWith('-1.txt') && !/ \d\.txt$/.test(n)).sort();
  return f.length ? readFileSync(join(carpeta, f[0]!), 'utf8') : null;
}

const decisiones: Decisiones = existsSync(rutaDec)
  ? { nombre_completo: {}, mismo_tabulador: {}, alias_confirmados: [], equivalencias: [], persona_bodega: null, ...(JSON.parse(readFileSync(rutaDec, 'utf8')) as Partial<Decisiones>) }
  : { nombre_completo: {}, mismo_tabulador: {}, alias_confirmados: [], equivalencias: [], persona_bodega: null };

const angelo = leerListaAngelo(readFileSync(rutaAngelo, 'utf8'));
const javier = leerListaJavier(readFileSync(rutaJavier, 'utf8'), leerArchivo);
const karen = leerCostosKaren(readFileSync(rutaKaren, 'utf8'));
const { plan, verificacion: v } = construirPlan(angelo, javier, karen, decisiones, rutaAlias ? (JSON.parse(readFileSync(rutaAlias, 'utf8')) as ReglaAlias[]) : undefined);

const m = (c: bigint) => formatearMoneda(c);
console.log('== Verificacion (calculada con codigo)');
console.log(`Isaac: ${v.costosIsaac} costos | Angelo: ${v.clientesAngelo} clientes, ${v.lineasAngelo} lineas de precio, ${v.margenesCero} con margen cero`);
console.log(`Margenes que no son precio menos costo: ${v.margenesQueNoCuadran.length}; costos de renglon distintos de la tabla: ${v.costosQueNoCoinciden.length}`);
for (const x of [...v.margenesQueNoCuadran, ...v.costosQueNoCoinciden]) console.log(`  - ${x}`);
console.log(`Javier: ${v.clientesJavier} clientes, ${v.lineasJavier} lineas de precio | Karen: ${v.costosKaren} costos (supuesto, desde 2026-11-10)`);
for (const t of v.totalesPorCliente) console.log(`  ${t.cliente.padEnd(18)} ${String(t.lineas).padStart(3)} lineas  suma de precios ${m(t.sumaPrecios).padStart(12)}  suma de margenes ${m(t.sumaMargenes).padStart(12)}`);
console.log(`Listas sin dueno: ${plan.listasSinDuenio.length} | Modelos: ${new Set(plan.modelos.map((x) => normalizar(x.nombre))).size} (${plan.sinDisponibilidad.length} sin disponibilidad ahora) | alias de modelo: ${plan.aliasModelo.length} | alias de cliente: ${plan.aliasCliente.length}`);
for (const c of plan.conflictos) console.log(`CONFLICTO: ${c}`);
for (const a of plan.advertencias) console.log(`AVISO: ${a}`);

if (flag('verificar')) {
  const esperado = { costosIsaac: 43, clientesAngelo: 19, lineasAngelo: 179, margenesCero: 12, costosKaren: 17 } as const;
  const mal = (Object.keys(esperado) as (keyof typeof esperado)[]).filter((k) => v[k] !== esperado[k]).map((k) => `${k}: ${v[k]} (esperado ${esperado[k]})`);
  if (v.margenesQueNoCuadran.length) mal.push(`${v.margenesQueNoCuadran.length} margenes que no cuadran`);
  if (v.costosQueNoCoinciden.length) mal.push(`${v.costosQueNoCoinciden.length} costos de renglon distintos de la tabla`);
  if (mal.length) { console.error(`VERIFICACION FALLO\n${mal.join('\n')}`); process.exit(1); }
  console.log('VERIFICACION OK: 43 costos de Isaac, 19 clientes, 179 lineas, 12 con margen cero, 17 costos de Karen; cada margen es precio menos costo.');
}
if (flag('dry-run') || flag('verificar')) process.exit(0);

// ---- Aplicar a la base LOCAL ------------------------------------------------------------------------------------------------
function urlLocal(): string {
  if (process.env.RTM_DB_URL) return process.env.RTM_DB_URL;
  return (JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { DB_URL: string }).DB_URL;
}
// Modo nube: no se conecta; escribe un archivo SQL (una transaccion, idempotente) que se ejecuta con `supabase db query --linked -f`.
const salidaSql = (() => { const i = process.argv.indexOf('--sql-salida'); return i > 0 ? process.argv[i + 1] : null; })();
if (salidaSql) {
  const arr = (a: unknown[]): string => `{${a.map((x) => (x === null ? 'NULL' : `"${String(x).replace(/(["\\\\])/g, '\\$1')}"`)).join(',')}}`;
  const lit = (v: unknown): string => (v === null || v === undefined ? 'null' : pg.escapeLiteral(Array.isArray(v) ? arr(v) : String(v)));
  const sentencias: string[] = ['begin;', "select set_config('rtm.canal', 'importacion', true);"];
  const q = async (sql: string, p: unknown[]) => { sentencias.push(`${sql.replace(/\$(\d+)/g, (_m, n) => lit(p[Number(n) - 1]))};`); return { rows: [] }; };
  await (async () => {
    // Misma secuencia que aplicar(), con q que acumula.
    for (const mo of plan.modelos) await q('select catalogo.asegurar_modelo($1,$2,$3,$4)', [mo.marca, mo.nombre, mo.puffs, mo.lista]);
    for (const n of plan.sinDisponibilidad) await q('select catalogo.fijar_disponibilidad($1,$2,$3)', [`imp:disp:${normalizar(n)}:sin_disponibilidad`, n, 'sin_disponibilidad']);
    for (const cl of plan.clientes) await q('select catalogo.asegurar_cliente($1,$2,$3,$4)', [cl.nombre, cl.duenio, cl.tipo, cl.nota]);
    if (plan.personaBodega) await q('select catalogo.asegurar_persona_bodega($1,$2)', [plan.personaBodega.cliente, plan.personaBodega.nombre]);
    for (const d of plan.destinos) await q('select catalogo.agregar_destino($1,$2,$3)', [d.cliente, d.etiqueta, d.zona]);
    for (const a of plan.aliasModelo) await q("select catalogo.agregar_alias($1,'modelo',$2,$3,$4,$5)", [`imp:am:${normalizar(a.alias)}`, a.alias, a.destinos, a.porConfirmar, a.nota]);
    for (const a of plan.aliasCliente) await q("select catalogo.agregar_alias($1,'cliente',$2,$3,$4,$5)", [`imp:ac:${normalizar(a.alias)}`, a.alias, a.destinos, a.porConfirmar, a.nota]);
    for (const k of plan.costos) await q('select catalogo.fijar_costo($1,$2,$3,$4,$5,$6,null,$7)', [`imp:costo:${k.proveedor}:${normalizar(k.modelo)}:${k.desde}:${k.centavos}`, k.proveedor, k.modelo, k.centavos.toString(), k.desde, k.fuente, k.supuesto]);
    for (const p of plan.precios) await q('select catalogo.fijar_precio($1,$2,$3,$4,$5,$6,$7)', [`imp:precio:${normalizar(p.cliente)}:${normalizar(p.modelo)}:${p.desde}:${p.centavos}`, p.cliente, p.modelo, p.centavos.toString(), p.desde, p.origen, p.nota]);
    for (const l of plan.listasSinDuenio) await q('select catalogo.guardar_lista_sin_duenio($1,$2,$3)', [l.referencia, l.origen, JSON.stringify(l.filas.map((f) => ({ modelo: f.modelo, precio_cent: Number(f.centavos) })))]);
    for (const h of plan.historicos) await q('select catalogo.registrar_precio_historico_externo($1,$2,$3,$4,$5,$6)', [`imp:hist:${normalizar(h.cliente)}:${normalizar(h.modelo)}:${h.centavos}`, h.cliente, h.modelo, h.centavos.toString(), h.origen, h.nota]);
  })();
  sentencias.push('commit;');
  const { writeFileSync, chmodSync } = await import('node:fs');
  writeFileSync(salidaSql, sentencias.join('\n') + '\n');
  chmodSync(salidaSql, 0o600);
  console.log(`SQL de importacion escrito (${sentencias.length - 3} llamadas); no contiene telefonos ni direcciones, pero NO se versiona.`);
  process.exit(0);
}
const url = urlLocal();
const host = new URL(url).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') { console.error('El importador solo corre contra la base local.'); process.exit(2); }

const TABLAS = ['catalogo.modelo', 'catalogo.cliente', 'catalogo.tabulador_precio', 'catalogo.costo_proveedor', 'catalogo.modelo_alias', 'catalogo.cliente_alias', 'catalogo.precio_historico_externo', 'catalogo.lista_sin_duenio', 'seguridad.operacion'];
const c = new pg.Client({ connectionString: url });
await c.connect();
let llamadas = 0;
const q = async (sql: string, p: unknown[]) => { llamadas += 1; return c.query(sql, p); };

async function aplicar() {
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  for (const mo of plan.modelos) await q('select catalogo.asegurar_modelo($1,$2,$3,$4)', [mo.marca, mo.nombre, mo.puffs, mo.lista]);
  for (const n of plan.sinDisponibilidad) await q('select catalogo.fijar_disponibilidad($1,$2,$3)', [`imp:disp:${normalizar(n)}:sin_disponibilidad`, n, 'sin_disponibilidad']);
  for (const cl of plan.clientes) await q('select catalogo.asegurar_cliente($1,$2,$3,$4)', [cl.nombre, cl.duenio, cl.tipo, cl.nota]);
  if (plan.personaBodega) await q('select catalogo.asegurar_persona_bodega($1,$2)', [plan.personaBodega.cliente, plan.personaBodega.nombre]);
  for (const d of plan.destinos) await q('select catalogo.agregar_destino($1,$2,$3)', [d.cliente, d.etiqueta, d.zona]);
  for (const a of plan.aliasModelo) await q("select catalogo.agregar_alias($1,'modelo',$2,$3,$4,$5)", [`imp:am:${normalizar(a.alias)}`, a.alias, a.destinos, a.porConfirmar, a.nota]);
  for (const a of plan.aliasCliente) await q("select catalogo.agregar_alias($1,'cliente',$2,$3,$4,$5)", [`imp:ac:${normalizar(a.alias)}`, a.alias, a.destinos, a.porConfirmar, a.nota]);
  for (const k of plan.costos) await q('select catalogo.fijar_costo($1,$2,$3,$4,$5,$6,null,$7)', [`imp:costo:${k.proveedor}:${normalizar(k.modelo)}:${k.desde}:${k.centavos}`, k.proveedor, k.modelo, k.centavos.toString(), k.desde, k.fuente, k.supuesto]);
  for (const p of plan.precios) await q('select catalogo.fijar_precio($1,$2,$3,$4,$5,$6,$7)', [`imp:precio:${normalizar(p.cliente)}:${normalizar(p.modelo)}:${p.desde}:${p.centavos}`, p.cliente, p.modelo, p.centavos.toString(), p.desde, p.origen, p.nota]);
  for (const l of plan.listasSinDuenio) await q('select catalogo.guardar_lista_sin_duenio($1,$2,$3)', [l.referencia, l.origen, JSON.stringify(l.filas.map((f) => ({ modelo: f.modelo, precio_cent: Number(f.centavos) })))]);
  for (const h of plan.historicos) await q('select catalogo.registrar_precio_historico_externo($1,$2,$3,$4,$5,$6)', [`imp:hist:${normalizar(h.cliente)}:${normalizar(h.modelo)}:${h.centavos}`, h.cliente, h.modelo, h.centavos.toString(), h.origen, h.nota]);
}
async function conteos(): Promise<number[]> {
  const out: number[] = [];
  for (const t of TABLAS) out.push(Number((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n));
  return out;
}

try {
  await c.query('begin');
  if (flag('prueba-idempotencia')) {
    // Aplica dos veces dentro de una transaccion y la revierte: no deja nada en la base.
    await aplicar();
    const uno = await conteos();
    await aplicar();
    const dos = await conteos();
    await c.query('rollback');
    const igual = uno.every((n, i) => n === dos[i]);
    console.log(`Idempotencia: ${igual ? 'OK' : 'FALLO'} (filas tras la 1a aplicacion ${uno.join('/')}, tras la 2a ${dos.join('/')}; transaccion revertida)`);
    process.exitCode = igual ? 0 : 1;
  } else {
    await aplicar();
    await c.query('commit');
    console.log(`Importacion aplicada a la base local (${llamadas} llamadas SQL, idempotentes).`);
  }
} catch (e) {
  await c.query('rollback');
  console.error(`Importacion revertida: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
