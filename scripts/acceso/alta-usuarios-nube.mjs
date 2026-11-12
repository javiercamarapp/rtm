// Alta de las personas permitidas en el Supabase de la NUBE (proyecto ligado con `supabase link`). No imprime correos ni llaves.
//   node scripts/acceso/alta-usuarios-nube.mjs [--dry-run]
// Pasos: (1) fila en seguridad.correo_permitido por SQL (CLI ligada), (2) usuario en Auth por la API de administracion
// (la llave de servicio se obtiene de la CLI en memoria y no se escribe en ningun lado), (3) sincroniza rol y estado en seguridad.usuario.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { clasificar } from './clasificar.mjs';

const archivo = process.env.RTM_ALLOWLIST ?? `${homedir()}/.bodega-secrets/allowlist-correos.txt`;
const seco = process.argv.includes('--dry-run');
const lista = clasificar(readFileSync(archivo, 'utf8'));
console.log(`Lista valida: ${lista.length} personas (${lista.map((p) => `${p.persona}:${p.rol}${p.activo ? '' : ':desactivado'}`).join(', ')}).`);
if (seco) { console.log('--dry-run: no se escribio nada.'); process.exit(0); }

const ref = readFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
const lit = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const dir = mkdtempSync(join(tmpdir(), 'rtm-alta-'));
chmodSync(dir, 0o700);
const sql = (texto) => {
  const f = join(dir, 'q.sql');
  writeFileSync(f, texto, { mode: 0o600 });
  return execFileSync('supabase', ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
};
try {
  sql(lista.map((p) => `insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values (${lit(p.correo)},${lit(p.rol)},${lit(p.socio)},${p.activo}) on conflict (correo) do update set rol = excluded.rol, socio_nombre = excluded.socio_nombre, activo = excluded.activo;`).join('\n'));
  const llaves = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const servicio = llaves.find((k) => k.name === 'service_role')?.api_key;
  if (!servicio) throw new Error('no se obtuvo la llave de servicio');
  const base = `https://${ref}.supabase.co`;
  for (const p of lista) {
    const r = await fetch(`${base}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: servicio, authorization: `Bearer ${servicio}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: p.correo, email_confirm: true }),
    });
    if (r.ok) console.log(`Alta: ${p.persona} (${p.rol}${p.activo ? '' : ', desactivado'}).`);
    else if (r.status === 422) console.log(`Ya existia: ${p.persona}.`);
    else throw new Error(`alta de ${p.persona} fallo (${r.status})`);
  }
  sql(lista.map((p) => `update seguridad.usuario set rol = ${lit(p.rol)}, socio_nombre = ${lit(p.socio)}, activo = ${p.activo} where id = (select id from auth.users where email = ${lit(p.correo)});`).join('\n'));
  console.log('Roles y estado sincronizados.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
