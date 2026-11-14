// Imprime los valores de un campo por ruta JSON (solo para campos NO personales). Uso: node valor.mjs <correo> <fn> <ruta.js>
import { execFileSync } from 'node:child_process';
const [quien, fn, expr] = process.argv.slice(2);
const e = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const g = await (await fetch(`${e.API_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: quien }) })).json();
const v = await (await fetch(`${e.API_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: e.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token ?? g.properties?.hashed_token }) })).json();
const r = await fetch(`${e.API_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: e.ANON_KEY, authorization: `Bearer ${v.access_token}`, 'content-type': 'application/json', 'accept-profile': 'api', 'content-profile': 'api' }, body: '{}' });
const j = await r.json();
console.log(JSON.stringify(new Function('j', `return ${expr}`)(j)));
