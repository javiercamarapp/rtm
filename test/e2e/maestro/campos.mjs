// Lista los NOMBRES de campos (claves) que un rol recibe de las lecturas permitidas, recursivamente, sin valores. Uso: node campos.mjs <correo> fn1,fn2 vista1,vista2
import { execFileSync } from 'node:child_process';
const [quien, fns = '', vistas = ''] = process.argv.slice(2);
const e = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const g = await (await fetch(`${e.API_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: quien }) })).json();
const v = await (await fetch(`${e.API_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: e.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token ?? g.properties?.hashed_token }) })).json();
const H = (s) => ({ apikey: e.ANON_KEY, authorization: `Bearer ${v.access_token}`, 'content-type': 'application/json', 'accept-profile': s, 'content-profile': s });
const claves = (x, p = '', out = new Set()) => { if (Array.isArray(x)) x.slice(0, 50).forEach((i) => claves(i, p + '[]', out)); else if (x && typeof x === 'object') for (const [k, val] of Object.entries(x)) { out.add(`${p}.${k}`); claves(val, `${p}.${k}`, out); } return out; };
for (const f of fns.split(',').filter(Boolean)) {
  const [s, n] = f.split('.');
  const r = await fetch(`${e.API_URL}/rest/v1/rpc/${n}`, { method: 'POST', headers: H(s), body: '{}' });
  console.log(`## ${f} ${r.status}`); try { console.log([...claves(await r.json())].join(' ')); } catch { console.log('(sin json)'); }
}
for (const t of vistas.split(',').filter(Boolean)) {
  const r = await fetch(`${e.API_URL}/rest/v1/${t}?limit=20`, { headers: H('omar') });
  console.log(`## ${t} ${r.status}`); try { console.log([...claves(await r.json())].join(' ')); } catch { console.log('(sin json)'); }
}
