// Guarda un storageState por rol entrando con enlaces magicos locales (token_hash por la API de administracion; nada de correos reales).
// Uso: node sesiones.mjs <puerto> <carpeta-salida> rol=correo ...
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const [puerto, salida, ...pares] = process.argv.slice(2);
const e = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const destinos = { socio_a: '/', socio_b: '/', omar: '/mi-bodega', bodega: '/bodega' };
const b = await chromium.launch();
for (const par of pares) {
  const [rol, correo] = par.split('=');
  const r = await fetch(`${e.API_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: correo }) });
  const j = await r.json();
  const t = j.hashed_token ?? j.properties?.hashed_token;
  if (!t) { console.log(`${rol}: sin token (${r.status})`); continue; }
  const ctx = await b.newContext({ baseURL: `http://127.0.0.1:${puerto}` });
  const p = await ctx.newPage();
  const dest = destinos[rol] ?? '/';
  await p.goto(`/auth/confirm?token_hash=${encodeURIComponent(t)}&type=magiclink&next=${encodeURIComponent(dest)}`);
  await p.getByTestId('confirmar-acceso').click();
  await p.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 60000 });
  await ctx.storageState({ path: `${salida}/${rol}.json` });
  console.log(`${rol}: sesion guardada en ${new URL(p.url()).pathname}`);
  await ctx.close();
}
await b.close();
