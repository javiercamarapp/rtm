import { conDb, DOMINIO, limpiarBuzon } from './ayudas';

// Estado limpio para cada corrida: sin usuarios de prueba, sin contadores de intentos, buzon vacio.
export default async function globalSetup() {
  await conDb(async (c) => {
    await c.query('delete from seguridad.limite_intento');
    await c.query(`delete from seguridad.usuario where id in (select id from auth.users where email like $1)`, [`%${DOMINIO}`]);
    await c.query(`delete from auth.users where email like $1`, [`%${DOMINIO}`]);
    await c.query(`delete from seguridad.correo_permitido where correo like $1`, [`%${DOMINIO}`]);
  });
  await limpiarBuzon();
}
