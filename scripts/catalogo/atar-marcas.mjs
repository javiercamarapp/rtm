#!/usr/bin/env node
// Ata la marca de los modelos que hoy salen como 'Sin marca', SOLO los de confianza 'exacto' de scripts/catalogo/marcas-modelos.json (decision del dueno, 14-nov).
// Usa la funcion oficial catalogo.asignar_marca_modelo (migracion 20261115800000): idempotente por clave, auditada, solo reasigna modelos que siguen en 'Sin marca'.
// Debe correrse DESPUES de aplicar esa migracion. No toca precios, costos, kardex ni asientos.
//
//   node scripts/catalogo/atar-marcas.mjs --verificar              solo lectura: estado actual de cada modelo del mapa y lo que se haria (incluye las 8 marcas Waka confirmadas por el dueno el 14-nov).
//   node scripts/catalogo/atar-marcas.mjs --aplicar                aplica los 'exacto' en UNA transaccion; si la huella de lo inmutable cambia hace ROLLBACK. Segunda corrida: sin cambios.
//   node scripts/catalogo/atar-marcas.mjs --sql-salida <archivo>   no se conecta: escribe el mismo SQL (para `supabase db query --linked -f <archivo>`).
// Conexion: RTM_DB_URL o la base local de `supabase status`. La URL nunca se imprime. Actua como el primer socio activo de seguridad.usuario (claim local de la transaccion).
import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MAPA = JSON.parse(readFileSync(new URL('./marcas-modelos.json', import.meta.url), 'utf8'));
export const EXACTOS = MAPA.modelos.filter((m) => m.confianza === 'exacto');
const lit = (v) => pg.escapeLiteral(String(v));

/** SQL de UNA transaccion idempotente. Las claves de idempotencia son fijas por modelo. */
export function sqlAplicar(modelos = EXACTOS) {
  const bloques = modelos.map((m) => `
  select id into mid from catalogo.modelo where id = ${Number(m.id)} and nombre_canonico = ${lit(m.nombre)};
  if mid is null then raise exception 'el modelo ${Number(m.id)} (${m.nombre.replace(/'/g, "''")}) no coincide con el mapa: se cancela todo'; end if;
  r := catalogo.asignar_marca_modelo(${lit('atar-marca:' + m.id + ':' + m.marca)}, mid, ${lit(m.marca)});
  raise notice '% -> %: %', ${lit(m.nombre)}, ${lit(m.marca)}, r ->> 'estado';`).join('\n');
  return `begin;
select set_config('rtm.canal', 'importacion', true);
select set_config('request.jwt.claim.sub', (select id::text from seguridad.usuario where rol = 'socio' and activo order by id limit 1), true);
do $atar$
declare mid bigint; r jsonb; h0 jsonb := catalogo.huella_inmutables(); h1 jsonb;
begin${bloques}
  h1 := catalogo.huella_inmutables();
  if h1 is distinct from h0 then raise exception 'la huella de lo inmutable cambio: se cancela todo. antes=% despues=%', h0, h1; end if;
end
$atar$;
commit;
`;
}

function urlConexion() {
  if (process.env.RTM_DB_URL) return process.env.RTM_DB_URL;
  return JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).DB_URL;
}

async function verificar(c) {
  let pendientes = 0;
  for (const m of MAPA.modelos) {
    const { rows } = await c.query('select m.nombre_canonico, b.nombre as marca from catalogo.modelo m join catalogo.marca b on b.id = m.marca_id where m.id = $1', [m.id]);
    const r = rows[0];
    if (!r) { console.log(`${m.id} ${m.nombre}: NO existe`); process.exitCode = 1; continue; }
    if (r.nombre_canonico !== m.nombre) { console.log(`${m.id}: el nombre cambio (${r.nombre_canonico}); revisar el mapa`); process.exitCode = 1; continue; }
    const accion = m.confianza !== 'exacto' ? `queda por confirmar (propuesta ${m.marca})` : r.marca === m.marca ? 'ya esta atado' : r.marca === 'Sin marca' ? `PENDIENTE: pasaria a ${m.marca}` : `tiene otra marca (${r.marca}): no se toca`;
    if (m.confianza === 'exacto' && r.marca === 'Sin marca') pendientes++;
    console.log(`${m.nombre} [${m.confirmado_por ? 'confirmado' : m.confianza}]: hoy ${r.marca}; ${accion}`);
  }
  console.log(pendientes === 0 ? 'VERIFICACION OK: nada pendiente.' : `VERIFICACION OK: ${pendientes} modelo(s) listo(s) para --aplicar.`);
}

const args = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = args.indexOf('--sql-salida');
  if (i >= 0) {
    const archivo = args[i + 1];
    if (!archivo) { console.error('falta el archivo de --sql-salida'); process.exit(2); }
    writeFileSync(archivo, sqlAplicar());
    chmodSync(archivo, 0o600);
    console.log(`SQL escrito en ${archivo} (una transaccion, idempotente). Ejecutalo con: supabase db query --linked -f ${archivo}`);
  } else if (args.includes('--verificar') || args.includes('--aplicar')) {
    const c = new pg.Client({ connectionString: urlConexion() });
    await c.connect();
    try {
      if (args.includes('--aplicar')) {
        c.on('notice', (n) => console.log(n.message));
        try { await c.query(sqlAplicar()); console.log('APLICADO (idempotente: una segunda corrida no cambia nada).'); }
        catch (e) { await c.query('rollback').catch(() => {}); console.error(`FALLO (todo cancelado): ${e.message}`); process.exitCode = 1; }
      } else await verificar(c);
    } finally { await c.end(); }
  } else {
    console.error('Uso: atar-marcas.mjs --verificar | --aplicar | --sql-salida <archivo>');
    process.exit(2);
  }
}
