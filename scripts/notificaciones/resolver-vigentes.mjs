// Revisa los avisos abiertos y cierra los que ya no tienen causa (la misma regla que los genero, sobre el estado de hoy).
//   node scripts/notificaciones/resolver-vigentes.mjs --verificar   lista lo que se resolveria (solo lectura; es la opcion por omision)
//   node scripts/notificaciones/resolver-vigentes.mjs --aplicar     lo resuelve (soft-resolve: nada se borra, queda motivo, referencia y fecha)
// Conexion: RTM_DB_URL (cadena de conexion con un rol que ejecute notificacion.depurar) o, sin ella, la base local de `supabase status`.
// Nunca imprime la cadena de conexion. Es idempotente: una segunda corrida no cambia nada.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { informe, parsearArgs } from './formato.mjs';

async function principal() {
  const args = parsearArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(2);
  }
  const url = process.env.RTM_DB_URL ?? JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    const res = (await c.query('select notificacion.depurar($1::boolean) as j', [args.aplicar])).rows[0].j;
    await c.query(args.aplicar ? 'commit' : 'rollback');
    for (const l of informe(res)) console.log(l);
  } catch (err) {
    await c.query('rollback').catch(() => {});
    console.error(`No se pudo revisar los avisos: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
