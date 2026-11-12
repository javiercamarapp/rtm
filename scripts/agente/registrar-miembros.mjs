// Carga los ids de Telegram de los socios, de Omar y de los chats desde la variable de entorno PRIVADA TELEGRAM_MIEMBROS (JSON). Los ids no estan en el repo.
//   TELEGRAM_MIEMBROS='{"angelo":0,"javier":0,"omar":0,"grupo_socios":0,"privado_omar":0}' node scripts/agente/registrar-miembros.mjs [--dry-run]
// Omar queda registrado pero sin permisos de socio: sus mensajes solo pueden crear tomas pendientes de autorizacion. No imprime ningun id.
import pg from 'pg';

const dry = process.argv.includes('--dry-run');
const crudo = process.env.TELEGRAM_MIEMBROS;
const url = process.env.SERVIDOR_DATABASE_URL;
if (!crudo) { console.error('Falta TELEGRAM_MIEMBROS (JSON privado).'); process.exit(2); }
let m;
try { m = JSON.parse(crudo); } catch { console.error('TELEGRAM_MIEMBROS no es un JSON valido.'); process.exit(2); }
const entero = (v) => Number.isSafeInteger(v) && v !== 0;
const personas = ['angelo', 'javier', 'omar'].filter((p) => m[p] !== undefined);
for (const p of personas) if (!entero(m[p])) { console.error(`El id de ${p} debe ser un entero distinto de cero.`); process.exit(2); }
for (const d of ['grupo_socios', 'privado_omar']) if (m[d] !== undefined && !entero(m[d])) { console.error(`El chat ${d} debe ser un entero distinto de cero.`); process.exit(2); }
if (dry) { console.log(`Validado: ${personas.length} miembros y ${['grupo_socios', 'privado_omar'].filter((d) => m[d] !== undefined).length} chats. No se escribio nada.`); process.exit(0); }
if (!url) { console.error('Falta SERVIDOR_DATABASE_URL (ver node scripts/entorno/generar-env-local.mjs).'); process.exit(2); }
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('begin');
  for (const p of personas) await c.query('select agente.registrar_miembro($1::bigint, $2::text, true)', [m[p], p]);
  for (const d of ['grupo_socios', 'privado_omar']) if (m[d] !== undefined) await c.query('select agente.registrar_chat($1::text, $2::bigint)', [d, m[d]]);
  await c.query('commit');
  console.log(`Registrados ${personas.length} miembros y los chats indicados.`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(`No se pudo registrar: ${e.code ?? 'error'}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
