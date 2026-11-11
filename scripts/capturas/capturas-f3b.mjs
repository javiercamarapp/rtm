// Capturas de F3b con datos ILUSTRATIVOS: reinicia la base, carga fixtures y demos de F1, F2, F3a y F3b, corre Playwright (Chromium y WebKit) y deja la base como estaba.
// Uso: node scripts/capturas/capturas-f3b.mjs [--restaurar-real]
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
run('node', ['scripts/capturas/preparar-demo.mjs']);
run('node', ['scripts/capturas/datos-demo-f3a.mjs']);
run('node', ['scripts/capturas/datos-demo-f3b.mjs']);
let fallo = null;
try {
  run('npx', ['playwright', 'test', '--config', 'playwright.capturas.config.ts', 'test/capturas/f3b.spec.ts']);
} catch (e) {
  fallo = e;
}
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
if (process.argv.includes('--restaurar-real')) run('npx', ['tsx', 'scripts/importacion/importar.mts']);
if (fallo) process.exit(1);
