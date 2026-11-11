// `npm run verificar`: la unica puerta de F0. Corre, en orden y deteniendose en el primer fallo:
//   tipos -> lint (fronteras) -> guardas de diseno -> escaner de secretos -> pruebas unitarias y de contratos
//   -> Supabase local (si hace falta) -> pruebas de base de datos (pgTAP) -> pruebas del acceso (Playwright + Mailpit)
// Si el verificador levanto Supabase, lo deja DETENIDO al terminar (usa --mantener para dejarlo corriendo).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { corriendo, detener, iniciar } from '../entorno/supabase.mjs';

const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const mantener = process.argv.includes('--mantener');
const inicio = Date.now();
const pasos = [];
let levantado = false;

function correr(nombre, cmd, args) {
  const t0 = Date.now();
  process.stdout.write(`\n== ${nombre}\n`);
  const r = spawnSync(cmd, args, { cwd: raiz, stdio: 'inherit', env: process.env });
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  pasos.push({ nombre, ok: r.status === 0, seg });
  if (r.status !== 0) terminar(1);
}

function terminar(codigo) {
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
if (!existsSync(`${raiz}/.env.local`)) correr('Generando .env.local', 'node', ['scripts/entorno/generar-env-local.mjs']);
correr('Pruebas de base de datos (pgTAP)', 'npx', ['supabase', 'test', 'db']);
correr('Pruebas del acceso (Playwright, Chromium, Mailpit local)', 'npx', ['playwright', 'test']);
terminar(0);
