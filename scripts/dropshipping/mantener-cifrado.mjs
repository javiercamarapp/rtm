// Mantenimiento del cifrado de destinatarios (dropshipping). La llave NO se guarda: llega por variable de entorno y solo vive en esta sesion.
//   DATABASE_URL=<url con rol propietario> DS_LLAVE_DESTINATARIO=<llave>  node scripts/dropshipping/mantener-cifrado.mjs cifrar
//   ... DS_LLAVE_DESTINATARIO_ANTERIOR=<llave vieja> DS_LLAVE_DESTINATARIO_VERSION=2  node scripts/dropshipping/mantener-cifrado.mjs rotar
// cifrar: cifra las filas que aun estan en claro (idempotente). rotar: vuelve a cifrar con la llave vigente lo cifrado con la anterior (idempotente).
import pg from 'pg';

const accion = process.argv[2];
if (!['cifrar', 'rotar'].includes(accion ?? '')) { console.error('Uso: mantener-cifrado.mjs cifrar|rotar'); process.exit(2); }
const url = process.env.DATABASE_URL;
const llave = process.env.DS_LLAVE_DESTINATARIO;
if (!url || !llave || llave.length < 32) { console.error('Faltan DATABASE_URL y DS_LLAVE_DESTINATARIO (minimo 32 caracteres).'); process.exit(2); }
const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query('begin');
  await c.query("select set_config('rtm.llave_destinatario', $1, true)", [llave]);
  if (process.env.DS_LLAVE_DESTINATARIO_ANTERIOR) await c.query("select set_config('rtm.llave_destinatario_anterior', $1, true)", [process.env.DS_LLAVE_DESTINATARIO_ANTERIOR]);
  if (process.env.DS_LLAVE_DESTINATARIO_VERSION) await c.query("select set_config('rtm.llave_destinatario_version', $1, true)", [process.env.DS_LLAVE_DESTINATARIO_VERSION]);
  const r = await c.query(accion === 'cifrar' ? 'select entrega.cifrar_pendientes() as n' : 'select entrega.recifrar() as n');
  await c.query('commit');
  console.log(`${accion === 'cifrar' ? 'Filas cifradas' : 'Filas vueltas a cifrar'}: ${r.rows[0].n}`);
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.error(`Fallo (sin cambios): ${e.code ?? ''} ${String(e.message).split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await c.end();
}
