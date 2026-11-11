// Capturas de la apertura y de Movimientos con datos ILUSTRATIVOS. La apertura se firma y publica durante la corrida, asi que cada navegador corre sobre una base
// reiniciada: reinicia, carga fixtures y demos de F1 a F3b y de apertura, corre Playwright en UN navegador, y al final deja la base como estaba.
// Uso: node scripts/capturas/capturas-apertura.mjs [--restaurar-real]
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
let fallo = null;
for (const proyecto of ['chromium', 'webkit']) {
  run('node', ['scripts/capturas/preparar-demo.mjs']);
  run('node', ['scripts/capturas/datos-demo-f3a.mjs']);
  run('node', ['scripts/capturas/datos-demo-f3b.mjs']);
  run('node', ['scripts/capturas/datos-demo-f3b-inventario.mjs']);
  run('node', ['scripts/capturas/datos-demo-apertura.mjs']);
  try {
    run('npx', ['playwright', 'test', '--config', 'playwright.capturas.config.ts', `--project=${proyecto}`, 'test/capturas/apertura.spec.ts']);
  } catch (e) {
    fallo = e;
    break;
  }
}
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
if (process.argv.includes('--restaurar-real')) run('npx', ['tsx', 'scripts/importacion/importar.mts']);
if (fallo) process.exit(1);
