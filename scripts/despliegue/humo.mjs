// Pruebas de humo EN VIVO sobre la URL de produccion. Un navegador a la vez. No inicia sesion con correos reales ni lee cuerpos de correo.
//   node scripts/despliegue/humo.mjs https://rtm-nu.vercel.app [--con-correo-real]
// Sale con codigo 1 si algo falla. Imprime solo resultados (nunca llaves ni correos).
import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https:\/\//.test(base)) { console.error('Uso: humo.mjs https://url [--con-correo-real]'); process.exit(2); }
const conReal = process.argv.includes('--con-correo-real');
const aqui = new URL('.', import.meta.url).pathname;
const secretos = join(homedir(), '.bodega-secrets');
const ref = readFileSync(join(aqui, '../../supabase/.temp/project-ref'), 'utf8').trim();
const resendKey = readFileSync(join(secretos, 'resend.key'), 'utf8').trim();
const pimienta = readFileSync(join(secretos, 'rtm-limite-pimienta.key'), 'utf8').trim();
const resultados = [];
const ok = (n, c, d = '') => { resultados.push({ n, c: !!c }); console.log(`${c ? 'OK   ' : 'FALLO'} ${n}${d ? ` (${d})` : ''}`); };

async function resend() {
  const r = await fetch('https://api.resend.com/emails?limit=100', { headers: { authorization: `Bearer ${resendKey}` } });
  const j = await r.json();
  return (j.data ?? []).map((e) => ({ id: e.id, t: Date.parse(e.created_at.replace(' ', 'T').replace(/\+00$/, 'Z')), asunto: e.subject, estado: e.last_event }));
}
function sql(texto) {
  const d = mkdtempSync(join(tmpdir(), 'rtm-humo-')); chmodSync(d, 0o700);
  const f = join(d, 'q.sql'); writeFileSync(f, texto, { mode: 0o600 });
  try {
    const s = execFileSync('supabase', ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)).rows;
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const clave = (tipo, valor) => `${tipo}:${createHmac('sha256', pimienta).update(`${tipo}:${valor}`, 'utf8').digest('hex').slice(0, 32)}`;
const asuntoRtm = /entrar a RTM/i;
const inicio = Date.now() - 2000;

const navegador = await chromium.launch();
try {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pag = await ctx.newPage();
  const consola = [];
  pag.on('console', (m) => { if (['error', 'warning'].includes(m.type())) consola.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
  pag.on('pageerror', (e) => consola.push(`pageerror: ${String(e).slice(0, 160)}`));

  // 1. Pagina de acceso, particulas y consola.
  const r1 = await pag.goto(`${base}/login`, { waitUntil: 'networkidle' });
  ok('Pagina de acceso responde 200', r1.status() === 200, String(r1.status()));
  await pag.waitForTimeout(1500);
  const lienzo = await pag.evaluate(() => { const c = document.querySelector('.login-artwork canvas'); return c ? { w: c.width, h: c.height, listo: document.querySelector('.login-artwork')?.getAttribute('data-listo') } : null; });
  ok('Particulas (canvas) presentes y pintando', lienzo && lienzo.w > 0 && lienzo.listo === '1', lienzo ? `${lienzo.w}x${lienzo.h}` : 'sin canvas');
  ok('Sin errores ni avisos de consola (incluye violaciones de CSP)', consola.length === 0, consola.join(' | '));

  // 2. Encabezados de seguridad.
  const h = r1.headers();
  const csp = h['content-security-policy'] ?? '';
  ok('CSP con default-src, frame-ancestors y object-src cerrados', /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp));
  ok('Encabezados X-Frame-Options, nosniff, Referrer-Policy, HSTS, Permissions-Policy', h['x-frame-options'] === 'DENY' && h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer' && /max-age=\d{7,}/.test(h['strict-transport-security'] ?? '') && !!h['permissions-policy']);
  ok('Sin cabecera X-Powered-By', !h['x-powered-by']);

  // 3. Rutas protegidas sin sesion.
  for (const ruta of ['/', '/pedidos', '/clientes', '/catalogo', '/inventario', '/cuentas-por-cobrar', '/avisos', '/socios']) {
    const c = await ctx.request.get(`${base}${ruta}`, { maxRedirects: 0 });
    const loc = c.headers().location ?? '';
    ok(`Ruta protegida ${ruta} redirige al acceso`, [301, 302, 303, 307, 308].includes(c.status()) && /\/login/.test(loc), String(c.status()));
  }
  ok('/api/health publico', (await ctx.request.get(`${base}/api/health`)).status() === 200);
  ok('/api/salud publico (alias)', (await ctx.request.get(`${base}/api/salud`)).status() === 200);

  async function pedir(correo) {
    await pag.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await pag.fill('input[name="email"]', correo);
    await Promise.all([pag.waitForURL(/\/login\?/, { timeout: 15000 }), pag.click('button[type="submit"]')]);
    await pag.waitForLoadState('networkidle');
    return { url: new URL(pag.url()), texto: (await pag.locator('main').innerText()).replace(/\S+@\S+/g, 'X').toLowerCase() };
  }

  // 4. Correo NO permitido: respuesta generica y sin envio.
  const falso = `humo-${randomBytes(4).toString('hex')}@rtm-humo.test`;
  const antes = (await resend()).filter((e) => e.t >= inicio && asuntoRtm.test(e.asunto)).length;
  const a = await pedir(falso);
  ok('Correo no permitido: respuesta generica de enviado (sin error)', a.url.searchParams.get('enviado') === '1' && !a.url.searchParams.get('error'), a.url.search.replace(/enviado=1/, 'enviado=1'));
  // 5. Limite de intentos por correo: el 4.o cuenta 4 y excede el tope de 3.
  await pedir(falso); await pedir(falso); const cuarto = await pedir(falso);
  const filas = sql(`select count(*)::int n from seguridad.limite_intento_evento where clave = '${clave('correo', falso)}'`);
  ok('Limite por correo: 4 intentos contados (el 4.o excede el tope de 3)', filas[0]?.n === 4, `n=${filas[0]?.n}`);
  ok('El 4.o intento responde igual que los demas (sin senal)', cuarto.url.searchParams.get('enviado') === '1' && a.texto === cuarto.texto);
  await new Promise((r) => setTimeout(r, 4000));
  const despuesFalso = (await resend()).filter((e) => e.t >= inicio && asuntoRtm.test(e.asunto)).length;
  ok('Resend: ningun correo enviado para direcciones no permitidas', despuesFalso === antes, `${antes} -> ${despuesFalso}`);

  // 6. Correo permitido (opcional): misma respuesta y Resend registra el envio.
  if (conReal) {
    const lista = readFileSync(join(secretos, 'allowlist-correos.txt'), 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'));
    const javier = lista.find((c) => c.split('@')[0].includes('javier'));
    const b = await pedir(javier);
    ok('Correo permitido: misma respuesta que el no permitido', b.url.searchParams.get('enviado') === '1' && !b.url.searchParams.get('error') && b.texto === a.texto);
    let enviado = null;
    for (let i = 0; i < 8 && !enviado; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      enviado = (await resend()).find((e) => e.t >= inicio && asuntoRtm.test(e.asunto));
    }
    ok('Resend registra el envio del enlace (estado sin leer el cuerpo)', !!enviado && ['sent', 'delivered', 'delivery_delayed'].includes(enviado.estado), enviado ? enviado.estado : 'sin registro');
  }
} finally {
  await navegador.close();
}

// 7. Llave anon: ninguna funcion sensible ni tabla.
const llaves = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const anon = llaves.find((k) => k.name === 'anon').api_key;
const API = `https://${ref}.supabase.co`;
const cab = { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' };
const fns = [['api', 'catalogo_modelos', {}], ['api', 'registrar_intento_login', { p_clave: 'ip:humo00000', p_ventana_seg: 60 }], ['public', 'registrar_intento_login', { p_clave: 'ip:humo00000', p_ventana_seg: 60 }]];
for (const [esq, fn, cuerpo] of fns) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...cab, 'content-profile': esq }, body: JSON.stringify(cuerpo) });
  ok(`Llave anon no ejecuta ${esq}.${fn}`, [401, 403, 404, 406].includes(r.status), String(r.status));
}
for (const [esq, tabla] of [['seguridad', 'correo_permitido'], ['seguridad', 'usuario'], ['catalogo', 'cliente'], ['omar', 'v_mercancia'], ['public', 'correo_permitido']]) {
  const r = await fetch(`${API}/rest/v1/${tabla}?select=*&limit=1`, { headers: { ...cab, 'accept-profile': esq } });
  const t = await r.text();
  ok(`Llave anon no lee ${esq}.${tabla}`, r.status >= 400 && !t.startsWith('[{'), String(r.status));
}
const reg = await fetch(`${API}/auth/v1/signup`, { method: 'POST', headers: cab, body: JSON.stringify({ email: `humo-${randomBytes(3).toString('hex')}@rtm-humo.test`, password: randomBytes(12).toString('hex') }) });
ok('Registro abierto cerrado (signup rechazado)', reg.status >= 400, String(reg.status));
const sup = await fetch(`${API}/auth/v1/otp`, { method: 'POST', headers: cab, body: JSON.stringify({ email: `humo-${randomBytes(3).toString('hex')}@rtm-humo.test`, create_user: true }) });
ok('OTP directo con create_user no crea usuario', sup.status >= 400, String(sup.status));
// Auth debe tener exactamente las personas de la lista de permitidos (socios, Omar y las cuentas de bodega dadas de alta): ninguna de mas.
const usuarios = sql(`select (select count(*) from auth.users)::int a, (select count(*) from seguridad.correo_permitido)::int c`)[0];
ok('Auth tiene exactamente las personas de la lista de permitidos (ninguna de mas)', usuarios.a === usuarios.c, `auth=${usuarios.a} lista=${usuarios.c}`);

// 8. Bundle publico sin secretos ni correos.
const cli = await fetch(`${base}/login`).then((r) => r.text());
const rutas = [...new Set([...cli.matchAll(/\/_next\/static\/[^"')\s\\]+\.js/g)].map((m) => m[0]))];
let todo = cli;
for (const ruta of rutas) todo += await fetch(`${base}${ruta}`).then((r) => r.text());
const correos = readFileSync(join(secretos, 'allowlist-correos.txt'), 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l.includes('@'));
const serv = llaves.find((k) => k.name === 'service_role').api_key;
const prohibidos = [
  ['correos permitidos', correos.some((c) => todo.toLowerCase().includes(c))],
  ['llave de servicio', todo.includes(serv)],
  ['llave de Resend', todo.includes(resendKey) || /re_[A-Za-z0-9]{20,}/.test(todo)],
  ['pimienta', todo.includes(pimienta)],
  ['cadena de conexion', /postgres(ql)?:\/\/[^"'\s]+:[^"'\s]+@/.test(todo) || todo.includes('supabase-rtm-servidor')],
  ['JWT de servicio', /"role":"service_role"/.test(Buffer.from((todo.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g) ?? []).map((t) => Buffer.from(t.split('.')[1], 'base64url').toString()).join(' ')).toString()) || /service_role/.test((todo.match(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})/g) ?? []).map((t) => Buffer.from(t.split('.')[1], 'base64url').toString()).join(' '))],
];
for (const [n, hay] of prohibidos) ok(`Bundle publico sin ${n}`, !hay);
ok('Bundle revisado', rutas.length > 0, `${rutas.length} archivos JS`);

const fallos = resultados.filter((r) => !r.c);
console.log(`\nHUMO: ${resultados.length - fallos.length}/${resultados.length} OK${fallos.length ? ` | FALLAN: ${fallos.map((f) => f.n).join('; ')}` : ''}`);
process.exit(fallos.length ? 1 : 0);
