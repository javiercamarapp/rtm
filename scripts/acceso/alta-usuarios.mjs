// Alta local de usuarios desde la lista de permitidos. SOLO LOCAL: lee el archivo privado, inserta en seguridad.correo_permitido
// y crea los usuarios con la API de administracion del Supabase LOCAL. No imprime ni escribe ningun correo: solo roles y conteos.
//
//   node scripts/acceso/alta-usuarios.mjs            alta real contra el Supabase local
//   node scripts/acceso/alta-usuarios.mjs --dry-run  solo valida y cuenta
//   RTM_ALLOWLIST=/ruta/otra.txt node ...            otro archivo (para pruebas con correos ficticios)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { clasificar } from './clasificar.mjs';

const archivo = process.env.RTM_ALLOWLIST ?? `${homedir()}/.bodega-secrets/allowlist-correos.txt`;
const seco = process.argv.includes('--dry-run');

let lista;
try {
  lista = clasificar(readFileSync(archivo, 'utf8'));
} catch (e) {
  console.error(`No se pudo leer o clasificar la lista de permitidos: ${e.message}`);
  process.exit(1);
}
console.log(`Lista valida: ${lista.length} personas (${lista.map((p) => `${p.persona}:${p.rol}${p.activo ? '' : ':desactivado'}`).join(', ')}).`);
if (seco) {
  console.log('--dry-run: no se escribio nada.');
  process.exit(0);
}

const estado = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(estado.API_URL)) {
  console.error('Este script solo corre contra el Supabase local.');
  process.exit(1);
}
const { default: pg } = await import('pg');
const db = new pg.Client({ connectionString: estado.DB_URL });
await db.connect();
try {
  for (const p of lista) {
    await db.query(
      'insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ($1,$2,$3,$4) on conflict (correo) do update set rol = excluded.rol, socio_nombre = excluded.socio_nombre, activo = excluded.activo',
      [p.correo, p.rol, p.socio, p.activo],
    );
    const existe = await db.query('select 1 from auth.users where email = $1', [p.correo]);
    if (existe.rowCount === 0) {
      const r = await fetch(`${estado.API_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: estado.SERVICE_ROLE_KEY, authorization: `Bearer ${estado.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: p.correo, email_confirm: true }),
      });
      if (!r.ok) throw new Error(`alta de ${p.persona} fallo (${r.status})`);
      console.log(`Alta: ${p.persona} (${p.rol}${p.activo ? '' : ', desactivado'}).`);
    } else {
      await db.query('update seguridad.usuario set rol = $2, socio_nombre = $3, activo = $4 where id = (select id from auth.users where email = $1)', [p.correo, p.rol, p.socio, p.activo]);
      console.log(`Ya existia: ${p.persona}; rol y estado sincronizados.`);
    }
  }
} finally {
  await db.end();
}
