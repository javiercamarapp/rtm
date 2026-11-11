// Latido LOCAL de notificaciones (reloj inyectado). Una pasada: caduca lo vencido, evalua comprobaciones, cuenta con el proveedor y posicion entre socios, y revisa
// el respaldo por correo. Muestra cuantas entregas esperan. NO envia nada: Telegram y correo se conectan en M2 (los interruptores nacen apagados).
// Uso: node scripts/latido-local.mjs [--hoy 2026-11-16]   (--hoy fija la fecha de negocio de la pasada; sin ella se usa la de Merida)
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const i = process.argv.indexOf('--hoy');
const hoy = i > 0 ? process.argv[i + 1] : null;
if (hoy !== null && !/^\d{4}-\d{2}-\d{2}$/.test(hoy ?? '')) {
  console.error('--hoy debe ser AAAA-MM-DD');
  process.exit(2);
}
const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('begin');
  const r = (await c.query('select notificacion.latido($1::date) as j', [hoy])).rows[0].j;
  const e = (await c.query("select estado, count(*)::int as n from notificacion.entrega group by estado order by estado")).rows;
  await c.query('commit');
  console.log(JSON.stringify({ latido: r, entregas: Object.fromEntries(e.map((x) => [x.estado, x.n])) }));
} catch (err) {
  await c.query('rollback').catch(() => {});
  console.error(`El latido fallo: ${err.message}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
