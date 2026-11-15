// Vaciado seguro de la cola historica de notificaciones, ANTES de dejar `telegram_envio` encendido.
// Las entregas pendientes o "enviando" anteriores al corte (por ejemplo las de la carga del 13-nov) se marcan `omitida` con el motivo `vaciado_historico`: nunca se envian.
// Uso:
//   node scripts/notificaciones/vaciar-pendientes.mjs --verificar   (solo lectura; sale con codigo 1 si queda algo por vaciar)
//   node scripts/notificaciones/vaciar-pendientes.mjs --aplicar     (marca como omitidas; idempotente)
// Base: DATABASE_URL del entorno o, sin ella, la del Supabase LOCAL (supabase status). Este script NO se ejecuta contra produccion desde aqui: el dueno lo corre en el flujo de despliegue.
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const args = new Set(process.argv.slice(2));
if (args.has('--verificar') === args.has('--aplicar')) {
  console.error('Usa exactamente una opcion: --verificar o --aplicar');
  process.exit(2);
}
const aplicar = args.has('--aplicar');
const url = process.env.DATABASE_URL ?? JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('begin');
  const r = (await c.query('select notificacion.vaciar_pendientes($1::boolean) as j', [aplicar])).rows[0].j;
  // --verificar jamas deja cambios; --aplicar confirma.
  await c.query(aplicar ? 'commit' : 'rollback');
  console.log(JSON.stringify(r));
  if (!aplicar && r.por_vaciar > 0) {
    console.error(`Quedan ${r.por_vaciar} entregas por vaciar${r.telegram_envio ? ' y telegram_envio esta ENCENDIDO: vaciar ya' : ''}. Corre --aplicar antes de encender el envio.`);
    process.exitCode = 1;
  }
} catch (err) {
  await c.query('rollback').catch(() => {});
  console.error(`El vaciado fallo: ${err.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
