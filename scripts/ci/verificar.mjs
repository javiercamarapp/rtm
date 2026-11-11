// `npm run verificar`: la unica puerta de F0. Corre, en orden y deteniendose en el primer fallo:
//   tipos -> lint (fronteras) -> guardas de diseno -> escaner de secretos -> pruebas unitarias y de contratos
//   -> Supabase local (si hace falta) -> pruebas de base de datos (pgTAP) -> integracion con la base (concurrencia) -> pruebas del acceso (Playwright + Mailpit)
// Si el verificador levanto Supabase, lo deja DETENIDO al terminar (usa --mantener para dejarlo corriendo).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { corriendo, detener, iniciar } from '../entorno/supabase.mjs';

const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const mantener = process.argv.includes('--mantener');
const inicio = Date.now();
const pasos = [];
let levantado = false;
let basePreparadaParaPantallas = false;

function correr(nombre, cmd, args) {
  const t0 = Date.now();
  process.stdout.write(`\n== ${nombre}\n`);
  const r = spawnSync(cmd, args, { cwd: raiz, stdio: 'inherit', env: process.env });
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  pasos.push({ nombre, ok: r.status === 0, seg });
  if (r.status !== 0) terminar(1);
}

/** Deja la base como estaba para el dueno: reinicia (borra lo que dejaron las pruebas de pantallas) y vuelve a importar las listas reales si estan en este equipo. */
function restaurarBase() {
  const corr = (cmd, args) => spawnSync(cmd, args, { cwd: raiz, stdio: 'inherit', env: process.env });
  corr('npx', ['supabase', 'db', 'reset']);
  corr('node', ['scripts/entorno/generar-env-local.mjs']);
  if (existsSync(`${process.env.HOME}/Downloads/logica-negocio-angelo.md`)) corr('npx', ['tsx', 'scripts/importacion/importar.mts']);
}

/** Detiene el servidor de la app que haya quedado en el puerto 3100 SOLO si es de este repo (tiene una compilacion vieja o el entorno de antes del reinicio). */
function detenerServidorPrevio() {
  const r = spawnSync('lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  for (const pid of r.stdout.split('\n').filter(Boolean)) {
    const cwd = spawnSync('lsof', ['-p', pid, '-a', '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout;
    if (cwd.includes(`n${raiz}`)) {
      const k = spawnSync('kill', [pid]);
      if (k.status !== 0) {
        console.error(`No se pudo detener el servidor previo (pid ${pid}); detenlo a mano y repite.`);
        terminar(1);
      }
    } else {
      console.error(`El puerto 3100 lo usa otro proyecto (pid ${pid}): no se toca.`);
      terminar(1);
    }
  }
}

function terminar(codigo) {
  if (basePreparadaParaPantallas) {
    process.stdout.write('\n== Restaurando la base local (reinicio y listas reales si estan en este equipo)\n');
    try {
      restaurarBase();
    } catch {
      /* se informa abajo */
    }
  }
  if (levantado && !mantener) {
    process.stdout.write('\n== Apagando el Supabase que levanto el verificador\n');
    try {
      detener();
    } catch {
      /* ya estaba detenido */
    }
  }
  const total = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log('\n--- Resumen de verificar ---');
  for (const p of pasos) console.log(`${p.ok ? 'OK    ' : 'FALLO '} ${p.nombre} (${p.seg} s)`);
  console.log(codigo === 0 ? `\nVERIFICAR: OK (${pasos.length} pasos, ${total} s)` : `\nVERIFICAR: FALLO (${total} s)`);
  process.exit(codigo);
}

correr('Tipos (tsc)', 'npx', ['tsc', '--noEmit']);
correr('Lint y fronteras entre capas (eslint)', 'npx', ['eslint', 'src', 'scripts', 'test']);
correr('Guardas estaticas de diseno y dominio', 'node', ['scripts/ci/guardas.mjs']);
correr('Escaner de secretos y correos', 'node', ['scripts/ci/escaner-secretos.mjs']);
correr('Pruebas unitarias y de contratos (vitest)', 'npx', ['vitest', 'run']);

if (!corriendo()) {
  console.log('\n== Levantando Supabase local (solo base, Auth, API y Mailpit)');
  iniciar();
  levantado = true;
}
// Siempre se regenera: le pone la contrasena local al rol `servidor` (un `db reset` la borra) y conserva la pimienta.
correr('Entorno local (.env.local y rol servidor)', 'node', ['scripts/entorno/generar-env-local.mjs']);
correr('Pruebas de base de datos (pgTAP)', 'npx', ['supabase', 'test', 'db']);
correr('Pruebas de integracion con la base local (concurrencia del limite de intentos)', 'npx', ['vitest', 'run', '--config', 'vitest.integracion.config.mts']);
const F = 'test/fixtures/importacion';
correr('Importador: idempotencia con fixtures (dos aplicaciones en una transaccion revertida)', 'npx', [
  'tsx', 'scripts/importacion/importar.mts', '--prueba-idempotencia', '--angelo', `${F}/angelo.md`, '--javier', `${F}/javier.md`, '--karen', `${F}/javier.md`,
  '--carpeta-tabuladores', `${F}/tabuladores`, '--decisiones', `${F}/decisiones.json`, '--alias', `${F}/alias.json`,
]);
if (existsSync(`${process.env.HOME}/Downloads/logica-negocio-angelo.md`)) {
  correr('Importador sobre las fuentes reales (43 costos, 19 clientes, 179 lineas, 12 en cero, 17 de Karen)', 'npx', ['tsx', 'scripts/importacion/importar.mts', '--verificar']);
} else {
  console.log('\n== Importador sobre las fuentes reales: OMITIDO (no estan en este equipo)');
}
// Las pruebas de pantallas de F2 dejan hechos de negocio (de solo insercion, no se pueden borrar): se corren sobre una base reiniciada y se restaura al final.
console.log('\n== Base limpia para las pruebas de pantallas (reinicio) y servidor nuevo');
basePreparadaParaPantallas = true;
correr('Reinicio de la base local', 'npx', ['supabase', 'db', 'reset']);
correr('Entorno local tras el reinicio', 'node', ['scripts/entorno/generar-env-local.mjs']);
detenerServidorPrevio();
correr('Pruebas de pantallas y acceso (Playwright: laptop 1440, iPhone 16 Pro, plegable cerrado y abierto)', 'npx', ['playwright', 'test']);
terminar(0);
