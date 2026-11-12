// Capturas de la integracion con base de datos. Cada navegador corre sobre una base reiniciada (se generan reportes durante la corrida): reinicia, carga fixtures y los datos ilustrativos
// de esta integracion, corre Playwright en UN navegador y al final deja la base como estaba.
// Uso: node scripts/capturas/capturas-integracion-db.mjs [--restaurar-real]
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
let fallo = null;
for (const proyecto of ['chromium', 'webkit']) {
  run('node', ['scripts/capturas/preparar-demo.mjs']);
  run('node', ['scripts/capturas/datos-demo-integracion.mjs']);
  try {
    run('npx', ['playwright', 'test', '--config', 'playwright.capturas.config.ts', `--project=${proyecto}`, 'test/capturas/integracion-db.spec.ts']);
  } catch (e) {
    fallo = e;
    break;
  }
}
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
if (process.argv.includes('--restaurar-real')) run('npx', ['tsx', 'scripts/importacion/importar.mts']);
if (fallo) process.exit(1);
