#!/usr/bin/env node
// Reinicia la base del Supabase LOCAL (borra TODO lo que tenga) y vuelve a sembrar el demo. Comando: npm run demo:reiniciar -- --confirmar
// Solo contra el Supabase local de este repositorio (`supabase db reset` no toca la nube). Rehusa si no ve un Supabase local o si la URL de la base no es local.
import { execFileSync, spawnSync } from 'node:child_process';
import { evaluarDestino, ErrorGuarda } from './guardas.mjs';

const args = process.argv.slice(2);
if (!args.includes('--confirmar')) {
  console.error('Esto BORRA la base del Supabase local y la vuelve a sembrar con datos demo. Repite con --confirmar para continuar.');
  process.exit(2);
}
try {
  const st = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  evaluarDestino(st.DB_URL);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(st.API_URL)) throw new ErrorGuarda('El Supabase que responde no es local.');
  execFileSync('supabase', ['db', 'reset'], { stdio: 'inherit' });
  const resto = args.filter((x) => x !== '--confirmar');
  const r = spawnSync('node', ['scripts/demo/cargar.mjs', ...resto], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: st.DB_URL } });
  process.exit(r.status ?? 1);
} catch (e) {
  console.error(e instanceof ErrorGuarda ? `REHUSADO: ${e.message}` : `No se pudo reiniciar: ${String(e.message).split('\n')[0]} (corre supabase start primero).`);
  process.exit(e instanceof ErrorGuarda ? 2 : 1);
}
