// Carga el escenario ILUSTRATIVO de capital por mes (scripts/capturas/capital-escenario.sql) en la base local del proyecto. Una sola vez: si ya hay capital declarado, no hace nada.
// Uso: node scripts/capturas/datos-demo-capital.mjs        NUNCA datos reales.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const hay = await c.query('select count(*)::int as n from operacion.aportacion_socio');
  if (hay.rows[0].n > 0) {
    console.log('La base ya tiene aportaciones: no se siembra nada.');
  } else {
    await c.query(readFileSync(new URL('./capital-escenario.sql', import.meta.url), 'utf8'));
    console.log('Escenario de capital por mes sembrado (octubre y noviembre de 2026).');
  }
} finally {
  await c.end();
}
