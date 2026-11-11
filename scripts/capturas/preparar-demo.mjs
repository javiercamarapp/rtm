// Deja la base local con el catalogo de los fixtures ILUSTRATIVOS y los datos de demostracion de F1 y F2 (reinicia la base). Nunca datos reales.
//   node scripts/capturas/preparar-demo.mjs
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const F = 'test/fixtures/importacion';
run('supabase', ['db', 'reset']);
run('node', ['scripts/entorno/generar-env-local.mjs']);
run('npx', ['tsx', 'scripts/importacion/importar.mts', '--angelo', `${F}/angelo.md`, '--javier', `${F}/javier.md`, '--karen', `${F}/javier.md`, '--carpeta-tabuladores', `${F}/tabuladores`, '--decisiones', `${F}/decisiones.json`, '--alias', `${F}/alias.json`]);
run('node', ['scripts/capturas/datos-demo.mjs']);
run('node', ['scripts/capturas/datos-demo-f2.mjs']);
