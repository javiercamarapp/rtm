#!/usr/bin/env node
// Enlace magico de DESARROLLO para entrar a la web local con una cuenta demo (sin correo, sin contrasena). SOLO Supabase LOCAL.
//   npm run demo:enlace -- socio_a | socio_b | omar | bodega
// Genera el enlace con la API de administracion del Supabase local (llave de servicio leida en memoria, nunca impresa) y lo imprime. Abrelo en el navegador con `npm run dev` corriendo.
import { execFileSync } from 'node:child_process';
import { USUARIOS } from './datos-base.mjs';

const clave = process.argv[2];
const u = USUARIOS.find((x) => x.clave === clave);
if (!u) {
  console.error(`Uso: demo:enlace -- ${USUARIOS.map((x) => x.clave).join(' | ')}`);
  process.exit(2);
}
let st;
try {
  st = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  console.error('No hay Supabase local en ejecucion (supabase start).');
  process.exit(1);
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) {
  console.error('El enlace de desarrollo solo se genera contra el Supabase LOCAL.');
  process.exit(1);
}
const r = await fetch(`${st.API_URL}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: st.SERVICE_ROLE_KEY, authorization: `Bearer ${st.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: u.correo, options: { redirect_to: 'http://127.0.0.1:3100/auth/callback' } }),
});
if (!r.ok) {
  console.error(`No se pudo generar el enlace (${r.status}). Corre antes npm run demo:cargar.`);
  process.exit(1);
}
const j = await r.json();
console.log(`${u.nombre} (${u.rol}). Abre este enlace en el navegador (vale una vez y caduca pronto):`);
console.log(j.action_link);
