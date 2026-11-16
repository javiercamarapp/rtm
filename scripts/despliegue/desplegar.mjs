// `npm run desplegar`: lleva el codigo y las migraciones ADITIVAS de esta carpeta a produccion, sin builds de Vercel (se compila en la Mac).
// Orden: compuerta local -> comparar migraciones locales contra la nube (aborta si la nube trae algo que aqui no existe o si una pendiente es destructiva)
//        -> respaldo cifrado previo -> aplicar migraciones -> registrar a que despliegue apunta hoy el alias -> vercel build --prod
//        -> vercel deploy --prebuilt --prod -> humo contra la URL UNICA del despliegue nuevo -> vercel alias set <URL unica> <alias>
//        -> verificar que el alias sirve el despliegue nuevo (inspect + marcador del build en /login) -> humo contra el alias
//        -> si algo falla despues del alias, se restaura el alias anterior y se sale con error. (`deploy --prod` NO mueve el alias en este proyecto.)
// Opciones:
//   --probar              solo la compuerta y el analisis de migraciones; no respalda, no aplica, no despliega
//   --completo            compuerta completa (`npm run verificar`: reinicia y usa la base LOCAL; no correr mientras otra sesion la use)
//   --si-hay-cambios      no hace nada si el commit actual ya es el ultimo desplegado con exito (para el reloj de cada hora)
//   --permitir-sucio      permite arbol de trabajo con cambios sin confirmar (por omision se rechaza)
//   --incluir-todo        pasa --include-all a db push (migraciones locales con fecha anterior a la ultima de la nube)
//   --permitir-destructivas   permite migraciones destructivas (solo con orden expresa del dueno)
//   --solo-alias <url>    sin compuerta, migraciones ni build: humo contra la URL unica <url>, asigna el alias, verifica y corre el humo contra el alias
//                         (con restauracion del alias anterior si falla). Sirve para publicar un despliegue que quedo READY sin servirse.
//   --dry-run             imprime el plan y sale; no ejecuta nada ni escribe el registro (combinable con las demas opciones)
//   --permitir-sin-previo permite desplegar aunque no se pueda leer a que despliegue apunta hoy el alias (sin esto se aborta: no habria a donde restaurar)
//   --con-correo-real     la prueba de humo pide un enlace al correo de Javier y confirma el envio en Resend
// Registro: ~/.bodega-backups/despliegues.log (hora, commit, resultado `desplegado`/`revertido`/`humo-fallo`/`abortado`, URL anterior y nueva del alias). Nunca escribe secretos ni correos.
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { extraerUrlDespliegue, hostDe, leerArgumentos, parsearInspect, planDeDespliegue, publicarConAlias } from './alias.mjs';

const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { banderas: args, valores, errores } = leerArgumentos(process.argv.slice(2));
const SCOPE = 'likida';
const URL_PROD = process.env.RTM_URL_PRODUCCION ?? 'https://rtm-nu.vercel.app';
if (errores.length) { console.error(`Uso incorrecto: ${errores.join('; ')}`); process.exit(2); }
if (args.has('--dry-run')) { console.log(planDeDespliegue({ banderas: args, valores, urlProd: URL_PROD, scope: SCOPE }).map((l, i) => (i ? `  ${i}. ${l}` : l)).join('\n')); process.exit(0); }
const dirResp = join(homedir(), '.bodega-backups');
const logPath = join(dirResp, 'despliegues.log');
mkdirSync(dirResp, { recursive: true, mode: 0o700 });
chmodSync(dirResp, 0o700);

const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { cwd: raiz, encoding: 'utf8', ...o });
const git = (...a) => sh('git', a).stdout.trim();
const commit = git('rev-parse', '--short', 'HEAD');
const rama = git('rev-parse', '--abbrev-ref', 'HEAD');
const limpio = (t) => String(t ?? '').replace(/re_[A-Za-z0-9_]{10,}/g, '<oculto>').replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<jwt>').replace(/postgres(ql)?:\/\/\S+/g, '<url-bd>');
const hora = () => new Date().toISOString();
function registrar(resultado, detalle = '') {
  appendFileSync(logPath, `${hora()} commit=${commit} rama=${rama} resultado=${resultado} builds_vercel=0${detalle ? ` ${limpio(detalle).replace(/\s+/g, ' ').slice(0, 500)}` : ''}\n`, { mode: 0o600 });
  console.log(`\nRegistro: ${resultado}${detalle ? ` (${limpio(detalle).slice(0, 200)})` : ''}`);
}
function abortar(motivo, codigo = 1) { console.error(`\nABORTADO: ${motivo}`); registrar('abortado', motivo); process.exit(codigo); }
function paso(nombre, cmd, a, o = {}) {
  console.log(`\n== ${nombre}`);
  const r = sh(cmd, a, { stdio: 'inherit', ...o });
  if (r.status !== 0) abortar(`fallo: ${nombre}`);
}

// Publicacion bajo el alias (compartida por el flujo completo y --solo-alias).
const registroAlias = (previo, nuevoHost) => `alias=${hostDe(URL_PROD)} alias_anterior=${previo?.host ?? 'desconocido'} alias_nuevo=${nuevoHost}`;
const consultarAlias = () => parsearInspect(sh('vercel', ['inspect', hostDe(URL_PROD), '--json', '--scope', SCOPE]).stdout);
async function publicar(nuevo, previo, extra = '') {
  const r = await publicarConAlias({
    nuevo, urlProd: URL_PROD, scope: SCOPE, previo,
    run: (cmd, a) => sh(cmd, a),
    pedirPagina: async (u) => { const x = await fetch(u, { redirect: 'manual', cache: 'no-store' }); return { status: x.status, html: await x.text() }; },
    humo: (u) => sh('node', [join(raiz, 'scripts/despliegue/humo.mjs'), u, ...(args.has('--con-correo-real') ? ['--con-correo-real'] : [])], { stdio: 'inherit' }).status === 0,
    dormir: (ms) => new Promise((res) => setTimeout(res, ms)),
    log: (t) => console.log(`\n== ${t}`),
  });
  const base = `${registroAlias(previo, hostDe(nuevo))} ${extra}`.trim();
  if (r.ok) { registrar('desplegado', `${nuevo} ${base}`); process.exit(0); }
  console.error(`\nERROR (${r.etapa}): ${r.detalle}`);
  registrar(r.etapa === 'alias' ? 'revertido' : 'humo-fallo', `${nuevo} ${base} ${r.detalle}`);
  process.exit(1);
}

// --solo-alias: no compila ni migra; solo publica un despliegue ya existente.
if (valores['--solo-alias']) {
  const previo = consultarAlias();
  if (!previo && !args.has('--permitir-sin-previo')) abortar(`no se pudo leer a que despliegue apunta hoy ${hostDe(URL_PROD)}; sin eso no hay a donde restaurar (--permitir-sin-previo para continuar)`);
  await publicar(valores['--solo-alias'], previo, 'modo=solo-alias');
}

// 0. Condiciones.
if (git('status', '--porcelain') && !args.has('--permitir-sucio')) abortar('hay cambios sin confirmar en el arbol de trabajo');
if (!existsSync(join(raiz, '.vercel/project.json'))) abortar('esta carpeta no esta ligada a Vercel (vercel link --yes --project rtm --scope likida)');
if (!existsSync(join(raiz, 'supabase/.temp/project-ref'))) abortar('esta carpeta no esta ligada a Supabase (supabase link --project-ref <ref de rtm>)');
const ultimoOk = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter((l) => /resultado=desplegado /.test(l)).pop() : null;
if (args.has('--si-hay-cambios') && ultimoOk?.includes(`commit=${commit} `)) { console.log(`Sin cambios: ${commit} ya esta desplegado.`); process.exit(0); }

// 1. Compuerta local.
paso('Tipos', 'npm', ['run', '-s', 'typecheck']);
paso('Lint y fronteras', 'npm', ['run', '-s', 'lint']);
paso('Guardas', 'npm', ['run', '-s', 'guardas']);
paso('Escaner de secretos', 'npm', ['run', '-s', 'secretos']);
paso('Pruebas unitarias y de contratos', 'npm', ['test', '--silent']);
if (args.has('--completo')) paso('Verificacion completa (pgTAP y pantallas, sobre la base LOCAL)', 'npm', ['run', '-s', 'verificar']);

// 2. Migraciones: local contra nube.
console.log('\n== Migraciones locales contra la nube');
const lista = sh('supabase', ['migration', 'list', '--linked']);
let migs;
try { migs = JSON.parse(lista.stdout.slice(lista.stdout.indexOf('{'), lista.stdout.lastIndexOf('}') + 1)).migrations; } catch { abortar('no se pudo leer la lista de migraciones de la nube'); }
const soloNube = migs.filter((m) => m.remote && !m.local);
if (soloNube.length) abortar(`la nube tiene ${soloNube.length} migracion(es) que no existen en esta carpeta; sincroniza antes de desplegar`);
const pendientes = migs.filter((m) => m.local && !m.remote).map((m) => m.local);
const archivos = readdirSync(join(raiz, 'supabase/migrations')).filter((f) => pendientes.some((v) => f.startsWith(v)));
const DESTRUCTIVO = [
  [/\bdrop\s+table\b/i, 'DROP TABLE'], [/\bdrop\s+schema\b/i, 'DROP SCHEMA'], [/\btruncate\b/i, 'TRUNCATE'],
  [/\balter\s+table\b[^;]*\bdrop\s+column\b/i, 'DROP COLUMN'], [/\balter\s+table\b[^;]*\balter\s+column\b[^;]*\btype\b/i, 'ALTER COLUMN TYPE'],
  [/\balter\s+table\b[^;]*\brename\b/i, 'RENAME'], [/\bdrop\s+type\b/i, 'DROP TYPE'], [/\bdelete\s+from\b/i, 'DELETE FROM'], [/\bdrop\s+(database|extension|role)\b/i, 'DROP DATABASE/EXTENSION/ROLE'],
  [/\bdisable\s+row\s+level\s+security\b/i, 'DISABLE RLS'], [/\bgrant\b[^;]*\bto\s+(anon|authenticated|public)\b/i, 'GRANT a anon/authenticated/public (revisar a mano)'],
];
const hallazgos = [];
for (const f of archivos) {
  const sinComentarios = readFileSync(join(raiz, 'supabase/migrations', f), 'utf8').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [re, nombre] of DESTRUCTIVO) if (re.test(sinComentarios)) hallazgos.push(`${f}: ${nombre}`);
}
console.log(pendientes.length ? `Pendientes (${pendientes.length}): ${archivos.join(', ')}` : 'La nube ya tiene todas las migraciones.');
if (hallazgos.length && !args.has('--permitir-destructivas')) abortar(`migracion(es) destructiva(s) o de privilegios: ${hallazgos.join('; ')}. Requiere orden expresa del dueno (--permitir-destructivas)`);
if (args.has('--probar')) { console.log('\n--probar: compuerta y analisis OK; no se respalda, aplica ni despliega.'); process.exit(0); }

// 3. Respaldo cifrado previo (solo si hay migraciones por aplicar; el diario/semanal lo hace scripts/despliegue/respaldo.mjs).
if (pendientes.length) {
  const r = sh('node', [join(raiz, 'scripts/despliegue/respaldo.mjs'), 'previo-a-despliegue'], { stdio: 'inherit' });
  if (r.status !== 0) abortar('no se pudo hacer el respaldo previo');
  paso('Aplicar migraciones aditivas', 'supabase', ['db', 'push', '--linked', '--yes', ...(args.has('--incluir-todo') ? ['--include-all'] : [])]);
}

// 4. Despliegue al que apunta hoy el alias (para restaurarlo si algo falla despues de moverlo).
const previo = consultarAlias();
if (!previo && !args.has('--permitir-sin-previo')) abortar(`no se pudo leer a que despliegue apunta hoy ${hostDe(URL_PROD)}; sin eso no hay a donde restaurar (--permitir-sin-previo para continuar)`);
console.log(`\nAlias actual: ${hostDe(URL_PROD)} -> ${previo?.host ?? 'desconocido'}`);

// 5. Build local y despliegue sin Git (0 builds de Vercel).
paso('Traer ajustes de produccion', 'vercel', ['pull', '--yes', '--environment', 'production', '--scope', SCOPE], { stdio: ['ignore', 'ignore', 'inherit'] });
// El ~/.npmrc del usuario puede traer `allow-scripts`, que npm 11 rechaza en instalaciones de proyecto (EALLOWSCRIPTS) y rompe `vercel build`: el build ignora la config de usuario.
paso('Build local (vercel build --prod)', 'vercel', ['build', '--prod', '--scope', SCOPE], { env: { ...process.env, NPM_CONFIG_USERCONFIG: '/dev/null' } });
console.log('\n== Despliegue prebuilt');
const dep = sh('vercel', ['deploy', '--prebuilt', '--prod', '--scope', SCOPE]);
const nuevo = extraerUrlDespliegue(dep.stdout, dep.stderr);
if (dep.status !== 0 || !nuevo) abortar(`fallo el despliegue: ${limpio(dep.stderr).slice(-200)}`);
console.log(`Desplegado (aun sin alias): ${nuevo}`);

// 6. Humo contra la URL unica, alias, verificacion y humo contra el alias; si falla despues del alias, se restaura el anterior.
await new Promise((r) => setTimeout(r, 4000));
await publicar(nuevo, previo, `migraciones=${pendientes.length}`);
