// Spike del rol `servidor` a traves del pooler (Supavisor, modo transaccion). Reproduce el resultado de docs/F1-informe.md.
// Requisito: Supabase local levantado CON pooler:  [db.pooler] enabled = true  y  supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector
// Uso: node scripts/entorno/spike-pooler.mjs   (lee la contrasena local del rol desde .env.local; no imprime nada secreto)
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
const u = new URL(/^SERVIDOR_DATABASE_URL=(.+)$/m.exec(env)[1]);
const destinos = [
  ['directo (5432)', u.toString()],
  ['pooler, modo transaccion (55329)', `postgresql://servidor.pooler-dev:${u.password}@127.0.0.1:55329/postgres`],
];
let ok = true;
for (const [nombre, url] of destinos) {
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    const r1 = await c.query('select seguridad.registrar_intento_login($1::text, $2::int) as n', ['ip:spikepooler000001', 300]);
    const r2 = await c.query('select seguridad.registrar_intento_login($1::text, $2::int) as n', ['ip:spikepooler000001', 300]);
    const w = await c.query("select current_user, (select rolbypassrls or rolsuper from pg_roles where rolname = current_user) as peligro");
    let lee = 'denegado';
    try { await c.query('select 1 from seguridad.usuario'); lee = 'LEYO'; } catch { /* esperado */ }
    const bien = Number(r2.rows[0].n) === Number(r1.rows[0].n) + 1 && w.rows[0].peligro === false && lee === 'denegado';
    ok &&= bien;
    console.log(`${bien ? 'OK   ' : 'FALLO'} ${nombre}: usuario=${w.rows[0].current_user}, contador ${r1.rows[0].n}->${r2.rows[0].n}, sin BYPASSRLS, lectura de tablas ${lee}`);
  } catch (e) {
    ok = false;
    console.log(`FALLO ${nombre}: ${e.message}`);
  } finally {
    await c.end().catch(() => {});
  }
}
process.exit(ok ? 0 : 1);
