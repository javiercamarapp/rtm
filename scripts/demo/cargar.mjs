#!/usr/bin/env node
// Siembra el conjunto demo (100 % ficticio) en una base VACIA y LOCAL. Comando: npm run demo:cargar
//   DATABASE_URL=postgresql://postgres:...@127.0.0.1:55322/postgres npm run demo:cargar -- [--movimientos 250] [--hoy AAAA-MM-DD] [--semilla texto] [--dry-run]
// Sin DATABASE_URL usa el Supabase LOCAL (supabase status). Rehusa correr si la URL apunta a produccion o a un host que no sea localhost/127.0.0.1/::1,
// salvo --permitir-remoto-demo con un proyecto listado en RTM_DEMO_PROYECTOS (crear ese proyecto exige autorizacion del dueno; ver docs/cuentas-demo.md).
// Rehusa tambien si la base no esta vacia. Todo se carga con las funciones oficiales (api.* y operacion.*): el libro, el kardex y las comprobaciones C1..C24 quedan consistentes.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { generarDemo } from './generador.mjs';
import { evaluarDestino, exigirBaseVacia, ErrorGuarda, hoyMerida } from './guardas.mjs';
import { Ejecutor } from './ejecutor.mjs';
import { cargarStockProveedor } from './stock-proveedor.mjs';
import { verificarLibro } from './verificar.mjs';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string' }, movimientos: { type: 'string', default: '250' }, hoy: { type: 'string' }, semilla: { type: 'string' }, auth: { type: 'string', default: 'auto' },
    'permitir-remoto-demo': { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, ayuda: { type: 'boolean', default: false },
  },
});
if (a.ayuda) {
  console.log('Uso: demo:cargar [--url <DATABASE_URL>] [--movimientos 250] [--hoy AAAA-MM-DD] [--semilla texto] [--auth auto|gotrue|directo] [--permitir-remoto-demo] [--dry-run]');
  process.exit(0);
}

function urlLocalPorOmision() {
  try {
    return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
  } catch {
    return null;
  }
}

const plan = generarDemo({ hoy: a.hoy ?? hoyMerida(), movimientos: Number(a.movimientos), ...(a.semilla ? { semilla: a.semilla } : {}) });
console.log(`Plan demo: ${plan.meta.movimientos} movimientos (${plan.meta.operaciones} operaciones) del ${plan.meta.inicio} al ${plan.meta.ultimo}; ${plan.clientes.length} clientes, ${plan.catalogo.modelos.length} modelos.`);
console.log(`  ${Object.entries(plan.meta.porTipo).map(([t, n]) => `${t}: ${n}`).join(', ')}`);
if (plan.meta.hoy > hoyMerida()) {
  console.error(`REHUSADO: --hoy (${plan.meta.hoy}) es posterior a la fecha real (${hoyMerida()}): la base nunca fecha un movimiento en el futuro y el libro quedaria inconsistente.`);
  process.exit(2);
}
if (a['dry-run']) {
  console.log('Dry-run: no se conecto a ninguna base ni se escribio nada.');
  process.exit(0);
}

let codigo = 0;
try {
  const url = a.url ?? process.env.DATABASE_URL ?? urlLocalPorOmision();
  const destino = evaluarDestino(url, { permitirRemotoDemo: a['permitir-remoto-demo'], proyectosDemo: (process.env.RTM_DEMO_PROYECTOS ?? '').split(',') });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await exigirBaseVacia(client);
    const sesion = (await client.query('select session_user as u')).rows[0].u;
    if (sesion !== 'postgres') throw new ErrorGuarda(`La conexion debe ser del rol propietario postgres (es ${sesion}): negocio.hoy() solo respeta la fecha de la carga con ese rol.`);
    const ej = new Ejecutor(client, plan, { url });
    // Acceso: en el Supabase local se usa la API de administracion de GoTrue (sin correos); en una base de prueba sin GoTrue, insercion directa.
    let modo = a.auth;
    let apiUrl;
    let llave;
    if (modo === 'auto' || modo === 'gotrue') {
      try {
        const st = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL) && destino.destino === 'local') {
          modo = 'gotrue';
          apiUrl = st.API_URL;
          llave = st.SERVICE_ROLE_KEY;
        } else modo = 'directo';
      } catch {
        if (modo === 'gotrue') throw new ErrorGuarda('No hay Supabase local en ejecucion (supabase start).');
        modo = 'directo';
      }
    }
    console.log(`Acceso: ${modo === 'gotrue' ? 'usuarios de Auth local por la API de administracion' : 'insercion directa (base de prueba sin GoTrue)'}.`);
    await ej.cuentas({ modo, apiUrl, llaveServicio: llave });
    await ej.catalogo();
    await ej.correr({ progreso: (i, t) => console.log(`  ${i}/${t} operaciones`) });
    const stock = await cargarStockProveedor(ej);
    console.log(`Stock de proveedor: ${stock.mensaje}`);
    const v = await verificarLibro(client, ej.uuid.B);
    for (const l of v.lineas) console.log(`  [${l.ok ? 'OK ' : 'ROJA'}] ${l.texto}`);
    for (const w of ej.advertencias) console.log(`Advertencia: ${w}`);
    console.log(v.ok ? 'Demo cargado: libro conciliado y comprobaciones en verde.' : 'Demo cargado CON comprobaciones en rojo: revisar antes de presentar.');
    if (!v.ok) codigo = 1;
  } finally {
    await client.end();
  }
} catch (e) {
  if (e instanceof ErrorGuarda) console.error(`REHUSADO: ${e.message}`);
  else console.error(`FALLO${e.paso ? ` en "${e.paso}"` : ''}: ${e.code ?? ''} ${String(e.message).split('\n')[0]}`);
  codigo = e instanceof ErrorGuarda ? 2 : 1;
}
process.exit(codigo);
