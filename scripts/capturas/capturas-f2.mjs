// Capturas de F2 con datos ILUSTRATIVOS. Orquesta:
//   1) reinicia la base local  2) fixtures + datos de demostracion de F1 y F2  3) Playwright (Chromium y WebKit)
//   4) reinicia otra vez y, con --restaurar-real, vuelve a importar las listas reales (solo en esta Mac) para dejar la base como estaba.
// Las capturas del repo nunca llevan datos reales. Uso: node scripts/capturas/capturas-f2.mjs [--restaurar-real]
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
run('node', ['scripts/capturas/preparar-demo.mjs']);
let fallo = null;
try {
  run('npx', ['playwright', 'test', '--config', 'playwright.capturas.config.ts', 'test/capturas/f2.spec.ts']);
} catch (e) {
  fallo = e;
}
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
if (process.argv.includes('--restaurar-real')) run('npx', ['tsx', 'scripts/importacion/importar.mts']);
if (fallo) process.exit(1);
