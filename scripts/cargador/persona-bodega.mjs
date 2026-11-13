// Fija la PERSONA DE BODEGA con un cliente interno (por omision "Bodega Merida (socios)": la bodega la operan los socios por ahora).
// Idempotente (misma clave) y con la identidad del socio, igual que el resto del cargador. NO imprime datos personales.
// Uso: DATABASE_URL=... node scripts/cargador/persona-bodega.mjs [--nombre "Bodega Merida (socios)"] [--actor Javier] [--dry-run]
import { parseArgs } from 'node:util';
import { conectar, uuidsSocios } from './db.mjs';

const { values: a } = parseArgs({ options: { nombre: { type: 'string', default: 'Bodega Merida (socios)' }, actor: { type: 'string', default: 'Javier' }, 'dry-run': { type: 'boolean', default: false } } });
const url = process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL (rol propietario).'); process.exit(2); }
const client = await conectar(url);
try {
  const actual = (await client.query('select nombre from catalogo.persona_bodega order by id limit 1')).rows[0];
  if (actual) { console.log(`Ya hay persona de bodega configurada (${actual.nombre}). Nada que hacer.`); process.exit(0); }
  if (a['dry-run']) { console.log(`DRY-RUN: crearia el cliente interno "${a.nombre}" y lo fijaria como persona de bodega (no se puede deshacer).`); process.exit(0); }
  const uuid = (await uuidsSocios(client)).get(a.actor);
  if (!uuid) throw new Error(`no hay un usuario socio activo para ${a.actor}`);
  await client.query('begin');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uuid]);
  const id = (await client.query('select catalogo.asegurar_cliente($1, $2)::bigint as id', [a.nombre, a.actor])).rows[0].id;
  await client.query("select api.registrar_persona_bodega('carga:persona-bodega:v1', $1::bigint)", [id]);
  await client.query('set constraints all immediate');
  await client.query('commit');
  console.log(`Persona de bodega fijada: ${a.nombre}.`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`ERROR: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
