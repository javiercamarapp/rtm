import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conDb, DOMINIO, limpiarBuzon } from './ayudas';

// El limitador de login FALLA CERRADO: si el rol `servidor` no puede entrar, ningun acceso envia correo. Tras un `supabase db reset` el rol queda
// `nologin`, asi que el entorno de prueba lo deja con login y con la contrasena que ya usa el servidor de la prueba (SERVIDOR_DATABASE_URL de .env.local o del entorno).
async function asegurarLoginDelRolServidor(): Promise<void> {
  let url = process.env.SERVIDOR_DATABASE_URL;
  if (!url) {
    try {
      url = /^SERVIDOR_DATABASE_URL=(.+)$/m.exec(readFileSync(join(process.cwd(), '.env.local'), 'utf8'))?.[1];
    } catch {
      /* sin .env.local */
    }
  }
  if (!url) throw new Error('Falta SERVIDOR_DATABASE_URL (node scripts/entorno/generar-env-local.mjs): el limitador falla cerrado y las pruebas de acceso necesitan que conecte.');
  const clave = decodeURIComponent(new URL(url).password);
  if (!/^[A-Za-z0-9]{8,64}$/.test(clave)) throw new Error('SERVIDOR_DATABASE_URL local con contrasena inesperada; regenerar con generar-env-local.mjs.');
  await conDb((c) => c.query(`alter role servidor login password '${clave}'`));
}

// Estado limpio para cada corrida: sin usuarios de prueba, sin contadores de intentos, buzon vacio.
export default async function globalSetup() {
  await asegurarLoginDelRolServidor();
  await conDb(async (c) => {
    await c.query('delete from seguridad.limite_intento');
    await c.query('delete from seguridad.limite_intento_evento');
    await c.query(`delete from seguridad.usuario where id in (select id from auth.users where email like $1)`, [`%${DOMINIO}`]);
    await c.query(`delete from auth.users where email like $1`, [`%${DOMINIO}`]);
    await c.query(`delete from seguridad.correo_permitido where correo like $1`, [`%${DOMINIO}`]);
  });
  await limpiarBuzon();
}
