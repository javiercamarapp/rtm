// Levanta y apaga SOLO lo necesario del Supabase local: base, Auth, API y buzon Mailpit.
// Sin Studio, Realtime, Storage, imagenes, funciones de borde, analitica ni pooler. Un solo contenedor de base de datos por proyecto.
//   node scripts/entorno/supabase.mjs iniciar | detener | estado
import { execFileSync, spawnSync } from 'node:child_process';

const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
export const EXCLUIDOS = 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';

export function corriendo() {
  const r = spawnSync('supabase', ['status', '-o', 'json'], { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0) return false;
  try {
    return !!JSON.parse(r.stdout).API_URL;
  } catch {
    return false;
  }
}

export function iniciar() {
  if (corriendo()) return false;
  execFileSync('supabase', ['start', '-x', EXCLUIDOS], { cwd: raiz, stdio: ['ignore', 'inherit', 'inherit'] });
  return true;
}

export function detener() {
  execFileSync('supabase', ['stop'], { cwd: raiz, stdio: ['ignore', 'inherit', 'inherit'] });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const accion = process.argv[2];
  if (accion === 'iniciar') console.log(iniciar() ? 'Supabase local iniciado.' : 'Supabase local ya estaba corriendo.');
  else if (accion === 'detener') {
    detener();
    console.log('Supabase local detenido.');
  } else if (accion === 'estado') console.log(corriendo() ? 'corriendo' : 'detenido');
  else {
    console.error('Uso: node scripts/entorno/supabase.mjs iniciar|detener|estado');
    process.exit(2);
  }
}
