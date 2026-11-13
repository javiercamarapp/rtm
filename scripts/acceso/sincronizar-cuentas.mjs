// Crea el acceso (usuario de Auth) de las cuentas que un socio dio de alta desde la pantalla Cuentas y aun no lo tienen.
// El alta en la web solo agrega el correo a la lista de permitidos; el enlace magico exige que el usuario exista (shouldCreateUser: false).
// NO manda correos (crea el usuario ya confirmado: la persona pide su enlace despues, en la pantalla de entrada) y no imprime correos ni llaves, solo tipos y conteos.
// Solo atiende tipos creables desde la web (hoy, bodega); los socios y Omar siguen con alta-usuarios.mjs.
//   node scripts/acceso/sincronizar-cuentas.mjs [--dry-run]           contra el Supabase LOCAL
//   node scripts/acceso/sincronizar-cuentas.mjs --nube [--dry-run]    contra el proyecto ligado (CLI ligada; la llave de servicio se obtiene en memoria)
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seco = process.argv.includes('--dry-run');
const nube = process.argv.includes('--nube');
const PENDIENTES = `select c.correo, c.rol from seguridad.correo_permitido c join seguridad.tipo_cuenta t on t.rol = c.rol
  where t.creable_web and c.activo and not exists (select 1 from auth.users u where lower(u.email) = c.correo) order by c.correo`;

/** `existe(correo)` consulta la base (no la respuesta de la API): un 422 solo cuenta como "ya existia" si el usuario de verdad esta en auth.users. */
async function crear(base, llave, pendientes, existe) {
  let creados = 0;
  const fallos = {};
  const falla = (rol, motivo) => { const k = `${rol}:${motivo}`; fallos[k] = (fallos[k] ?? 0) + 1; };
  for (const p of pendientes) {
    try {
      const r = await fetch(`${base}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: llave, authorization: `Bearer ${llave}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: p.correo, email_confirm: true }),
      });
      if (r.ok) { creados += 1; console.log(`Acceso creado (${p.rol}).`); }
      else if (r.status === 422 && (await existe(p.correo))) console.log(`Ya existia (${p.rol}).`);
      else falla(p.rol, `http_${r.status}`);
    } catch {
      falla(p.rol, 'red');
    }
  }
  console.log(`${creados} acceso(s) creado(s).`);
  const n = Object.values(fallos).reduce((a, b) => a + b, 0);
  if (n > 0) {
    console.error(`${n} cuenta(s) fallaron (sin correos en este informe): ${Object.entries(fallos).map(([k, v]) => `${k} x${v}`).join(', ')}.`);
    process.exitCode = 1;
  }
}

if (!nube) {
  const estado = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(estado.API_URL)) { console.error('Sin --nube este script solo corre contra el Supabase local.'); process.exit(1); }
  const { default: pg } = await import('pg');
  const db = new pg.Client({ connectionString: estado.DB_URL });
  await db.connect();
  try {
    const { rows } = await db.query(PENDIENTES);
    console.log(`${rows.length} cuenta(s) sin acceso creado.`);
    if (seco || rows.length === 0) { if (seco) console.log('--dry-run: no se escribio nada.'); process.exit(0); }
    await crear(estado.API_URL, estado.SERVICE_ROLE_KEY, rows, async (c) => (await db.query('select 1 from auth.users where lower(email) = $1', [c])).rowCount > 0);
  } finally {
    await db.end();
  }
} else {
  const ref = readFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
  const dir = mkdtempSync(join(tmpdir(), 'rtm-cuentas-'));
  chmodSync(dir, 0o700);
  try {
    const f = join(dir, 'q.sql');
    writeFileSync(f, PENDIENTES, { mode: 0o600 });
    const salida = execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const datos = JSON.parse(salida);
    const rows = Array.isArray(datos) ? datos : (datos.rows ?? datos.result ?? []);
    console.log(`${rows.length} cuenta(s) sin acceso creado.`);
    if (seco || rows.length === 0) { if (seco) console.log('--dry-run: no se escribio nada.'); process.exit(0); }
    const llaves = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const servicio = llaves.find((k) => k.name === 'service_role')?.api_key;
    if (!servicio) throw new Error('no se obtuvo la llave de servicio');
    const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
    const existe = async (c) => {
      writeFileSync(f, `select 1 as x from auth.users where lower(email) = ${lit(c)}`, { mode: 0o600 });
      const d = JSON.parse(execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      return (Array.isArray(d) ? d : (d.rows ?? d.result ?? [])).length > 0;
    };
    await crear(`https://${ref}.supabase.co`, servicio, rows, existe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
