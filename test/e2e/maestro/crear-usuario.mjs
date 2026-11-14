// Crea (o confirma que existe) un usuario de Auth LOCAL confirmado, sin correo. Uso: node crear-usuario.mjs <correo>
import { execFileSync } from 'node:child_process';
const e = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (!/127\.0\.0\.1|localhost/.test(e.API_URL)) process.exit(2);
const r = await fetch(`${e.API_URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ email: process.argv[2], email_confirm: true }) });
console.log(r.ok ? 'usuario creado' : `estado ${r.status}`);
