// Capturas de F1 con datos ILUSTRATIVOS (fixtures). Orquesta:
//   1) reinicia la base local  2) importa los fixtures + datos de demostracion  3) corre Playwright (Chromium y WebKit)
//   4) reinicia otra vez y, con --restaurar-real, vuelve a importar las listas reales (solo en esta Mac) para dejar la base como estaba.
// Las capturas del repo nunca llevan datos reales. Uso: node scripts/capturas/capturas-f1.mjs [--restaurar-real]
import { execFileSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
const F = 'test/fixtures/importacion';
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
run('npx', ['tsx', 'scripts/importacion/importar.mts', '--angelo', `${F}/angelo.md`, '--javier', `${F}/javier.md`, '--karen', `${F}/javier.md`, '--carpeta-tabuladores', `${F}/tabuladores`, '--decisiones', `${F}/decisiones.json`, '--alias', `${F}/alias.json`]);
run('node', ['scripts/capturas/datos-demo.mjs']);
let fallo = null;
try {
  run('npx', ['playwright', 'test', '--config', 'playwright.capturas.config.ts', 'test/capturas/f1.spec.ts']);
} catch (e) {
  fallo = e;
}
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
if (process.argv.includes('--restaurar-real')) run('npx', ['tsx', 'scripts/importacion/importar.mts']);
if (fallo) process.exit(1);
