// Anonimos y extranos: login sin enumeracion, limite de intentos, rutas protegidas, y el bundle publico sin secretos. Uso: node anonimo.mjs <puerto>
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const puerto = process.argv[2];
const base = `http://127.0.0.1:${puerto}`;
const e = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const b = await chromium.launch();
async function intento(correo, ip) {
  const ctx = await b.newContext({ baseURL: base, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const p = await ctx.newPage();
  await p.goto('/login');
  await p.getByLabel('Tu correo').fill(correo);
  await p.getByRole('button', { name: 'Continuar con correo' }).click();
  await p.waitForFunction(() => !document.body.innerText.includes('Solicitando'), null, { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(300);
  const t = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  await ctx.close();
  return t;
}
const ip = () => `10.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const buzon0 = (await (await fetch(`${e.MAILPIT_URL}/api/v1/messages`)).json()).total;
const noPerm = await intento('nadie.noexiste@example.test', ip());
const perm = await intento('maestro.omar@example.test', ip());
const norm = (t) => t.replace(/maestro\.omar@example\.test|nadie\.noexiste@example\.test/g, '<correo>');
console.log('login: texto permitido == texto no permitido:', norm(noPerm) === norm(perm), '| respuesta:', norm(perm).slice(0, 140));
const buzon1 = (await (await fetch(`${e.MAILPIT_URL}/api/v1/messages`)).json()).total;
console.log('correos nuevos en Mailpit tras 1 permitido + 1 no permitido:', buzon1 - buzon0, '(esperado 1)');
// limite: muchos intentos desde una IP
const ipFija = ip();
const tt = [];
for (let i = 0; i < 12; i += 1) tt.push(norm(await intento(`flood${i}@example.test`, ipFija)).slice(0, 110));
console.log('limite por IP: textos distintos en 12 intentos:', new Set(tt).size, '|', [...new Set(tt)].map((x) => x.slice(0, 90)).join(' || '));
// mismo correo
const mismo = [];
const ip2 = ip();
for (let i = 0; i < 8; i += 1) mismo.push(norm(await intento('maestro.omar@example.test', i < 4 ? ip2 : ip())).slice(0, 110));
console.log('limite por correo: textos distintos en 8 intentos:', new Set(mismo).size);
const buzon2 = (await (await fetch(`${e.MAILPIT_URL}/api/v1/messages`)).json()).total;
console.log('correos enviados en la prueba de limites:', buzon2 - buzon1, '(8 al mismo correo + 12 no permitidos: deben ser muchos menos que 20)');
// rutas protegidas
const ctx = await b.newContext({ baseURL: base });
const p = await ctx.newPage();
for (const r of ['/', '/pedidos', '/contabilidad', '/socios', '/bodega', '/mi-bodega', '/cuentas', '/pago-renta', '/inventario/csv', '/socios/actas/1/pdf', '/api/tareas/x', '/notas/1/pdf']) {
  const res = await p.goto(r, { waitUntil: 'domcontentloaded' });
  console.log(`anon ${r} -> ${new URL(p.url()).pathname} (${res?.status()})`);
}
const api = await ctx.request.post('/api/telegram/webhook', { data: {} });
console.log('webhook sin secreto:', api.status());
const tar = await ctx.request.post('/api/tareas/latido', { data: {} });
console.log('tareas sin secreto:', tar.status());
// bundle publico: buscar secretos
const js = new Set();
await p.goto('/login');
p.on('response', async (r) => { if (/\.js(\?|$)/.test(r.url())) js.add(r.url()); });
await p.reload({ waitUntil: 'networkidle' });
let texto = await p.content();
for (const u of js) texto += await (await ctx.request.get(u)).text();
const patrones = { 'service_role (JWT con role service_role)': /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, sb_secret: /sb_secret_[A-Za-z0-9_-]+/, 'postgres url': /postgres(ql)?:\/\/[^"'\s]+/, 'telegram token': /\d{8,10}:[A-Za-z0-9_-]{35}/, openrouter: /sk-or-[A-Za-z0-9-]+/, 'LIMITE_PIMIENTA/SERVIDOR': /LIMITE_PIMIENTA|SERVIDOR_DATABASE_URL|TELEGRAM_BOT_TOKEN|DS_LLAVE/ };
for (const [k, re] of Object.entries(patrones)) {
  const m = texto.match(re) ?? [];
  let det = m.length;
  if (k.startsWith('service_role')) det = m.filter((x) => { try { return JSON.parse(Buffer.from(x.split('.')[1], 'base64url').toString()).role !== 'anon'; } catch { return false; } }).length;
  console.log(`bundle (${js.size} scripts, ${texto.length} chars) ${k}: ${det}`);
}
await b.close();
