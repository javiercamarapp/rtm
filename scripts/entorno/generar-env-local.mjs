// Genera .env.local desde `supabase status` (solo local). No imprime ninguna llave ni contrasena.
// Tambien le pone contrasena local al rol de base `servidor` (el rol sin BYPASSRLS que usa el limite de intentos del login).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const raiz = new URL('..', new URL('.', import.meta.url)).pathname.replace(/\/scripts\/$/, '');
const destino = `${raiz}/.env.local`;
const estado = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const previo = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
const leer = (k) => new RegExp(`^${k}=(.+)$`, 'm').exec(previo)?.[1];
const pimienta = leer('LIMITE_PIMIENTA') ?? randomBytes(24).toString('hex');
const clave = randomBytes(18).toString('hex');
const u = new URL(estado.DB_URL);

const c = new pg.Client({ connectionString: estado.DB_URL });
await c.connect();
await c.query(`alter role servidor login password '${clave}'`);
await c.end();
u.username = 'servidor';
u.password = clave;

const lineas = [
  'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100',
  `NEXT_PUBLIC_SUPABASE_URL=${estado.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${estado.ANON_KEY}`,
  `LIMITE_PIMIENTA=${pimienta}`,
  `SERVIDOR_DATABASE_URL=${u.toString()}`,
  '',
];
writeFileSync(destino, lineas.join('\n'));
chmodSync(destino, 0o600);
console.log('.env.local generado (permisos 600).');
