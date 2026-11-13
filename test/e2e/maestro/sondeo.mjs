// Sondeo auto-descubriente por REST: para cada funcion api.* / omar.* y cada vista expuesta, llama con la identidad de un rol (JWT real por enlace magico local)
// y clasifica la respuesta SIN imprimir datos (solo nombres de funcion y codigos). Uso: node sondeo.mjs <correo|anon> <permitidas separadas por coma>
import { execFileSync } from 'node:child_process';
import pg from 'pg';
const [quien, permitidasArg = ''] = process.argv.slice(2);
const permitidas = new Set(permitidasArg.split(',').filter(Boolean));
const e = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
let jwt = e.ANON_KEY;
if (quien !== 'anon') {
  const g = await (await fetch(`${e.API_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email: quien }) })).json();
  const v = await (await fetch(`${e.API_URL}/auth/v1/verify`, { method: 'POST', headers: { apikey: e.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token ?? g.properties?.hashed_token }) })).json();
  jwt = v.access_token;
  if (!jwt) { console.log('sin sesion', JSON.stringify(v).slice(0, 120)); process.exit(1); }
}
const c = new pg.Client({ connectionString: e.DB_URL });
await c.connect();
const fns = (await c.query(`select n.nspname s, p.proname f, p.proargnames an, p.pronargs na, p.pronargdefaults nd, pg_get_function_identity_arguments(p.oid) ia from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('api','omar') and p.prokind = 'f' order by 1,2`)).rows;
const vistas = (await c.query(`select table_schema s, table_name t from information_schema.tables where table_schema in ('api','omar')`)).rows;
await c.end();
const H = (s) => ({ apikey: e.ANON_KEY, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', 'accept-profile': s, 'content-profile': s });
const res = { permitida_ok: [], permitida_fallo: [], bloqueada_ok_FUGA: [], bloqueada: [], ambigua: [] };
const bloqueo = /permission denied|42501|no autorizad|rol|forbidden|JWT|not allowed|acceso|permiso|denegad/i;
for (const f of fns) {
  const args = {};
  for (const n of f.an ?? []) args[n] = null;
  const r = await fetch(`${e.API_URL}/rest/v1/rpc/${f.f}`, { method: 'POST', headers: H(f.s), body: JSON.stringify(args) });
  const t = await r.text();
  const nombre = `${f.s}.${f.f}`;
  const ok = r.status < 300;
  const esPerm = permitidas.has(nombre) || permitidas.has(f.f);
  if (esPerm) (ok ? res.permitida_ok : res.permitida_fallo).push(`${nombre}(${r.status})`);
  else if (ok) res.bloqueada_ok_FUGA.push(`${nombre}(${r.status} ${t.length}b)`);
  else if (r.status === 401 || r.status === 403 || bloqueo.test(t)) res.bloqueada.push(nombre);
  else res.ambigua.push(`${nombre}(${r.status}: ${t.replace(/\s+/g, ' ').slice(0, 70)})`);
}
const vistasRes = [];
for (const v of vistas) {
  const r = await fetch(`${e.API_URL}/rest/v1/${v.t}?limit=1`, { headers: H(v.s) });
  const t = await r.text();
  vistasRes.push(`${v.s}.${v.t}:${r.status}${r.status < 300 ? ' filas=' + (JSON.parse(t).length ?? '?') : ''}`);
}
console.log(JSON.stringify({ quien: quien === 'anon' ? 'anon' : 'rol', total: fns.length, permitida_ok: res.permitida_ok, permitida_fallo: res.permitida_fallo, FUGAS: res.bloqueada_ok_FUGA, bloqueadas: res.bloqueada.length, ambiguas: res.ambigua, vistas: vistasRes }, null, 1));
