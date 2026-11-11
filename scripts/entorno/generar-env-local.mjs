// Genera .env.local desde `supabase status` (solo local). No imprime ninguna llave.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const raiz = new URL('..', new URL('.', import.meta.url)).pathname.replace(/\/scripts\/$/, '');
const destino = `${raiz}/.env.local`;
const estado = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
let pimienta = randomBytes(24).toString('hex');
if (existsSync(destino)) {
  const previa = /^LIMITE_PIMIENTA=(.+)$/m.exec(readFileSync(destino, 'utf8'));
  if (previa?.[1]) pimienta = previa[1];
}
const lineas = [
  'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100',
  `NEXT_PUBLIC_SUPABASE_URL=${estado.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${estado.ANON_KEY}`,
  `LIMITE_PIMIENTA=${pimienta}`,
  '',
];
writeFileSync(destino, lineas.join('\n'));
chmodSync(destino, 0o600);
console.log('.env.local generado (permisos 600).');
