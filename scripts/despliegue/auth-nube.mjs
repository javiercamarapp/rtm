// Aplica la configuracion de API y Auth de la NUBE con `supabase config push` desde una carpeta temporal (no toca el config.toml local).
//   node scripts/despliegue/auth-nube.mjs https://rtm-nu.vercel.app [--solo-diferencia]
// La llave de Resend se lee de ~/.bodega-secrets/resend.key y se pasa solo por el entorno del proceso hijo.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
if (!url || !/^https:\/\/[a-z0-9.-]+$/.test(url)) { console.error('Uso: auth-nube.mjs https://dominio-de-produccion [--solo-diferencia]'); process.exit(2); }
const aqui = new URL('.', import.meta.url).pathname;
const ref = readFileSync(join(aqui, '../../supabase/.temp/project-ref'), 'utf8').trim();
const dir = mkdtempSync(join(tmpdir(), 'rtm-auth-'));
try {
  mkdirSync(join(dir, 'supabase/templates'), { recursive: true });
  writeFileSync(join(dir, 'supabase/config.toml'), readFileSync(join(aqui, 'config-nube.toml'), 'utf8').replaceAll('__SITE_URL__', url).replaceAll('__REMITENTE__', readFileSync(join(homedir(), '.bodega-secrets/rtm-remitente.txt'), 'utf8').trim()));
  copyFileSync(join(aqui, 'plantillas/magic_link.html'), join(dir, 'supabase/templates/magic_link.html'));
  const env = { ...process.env, RESEND_API_KEY: readFileSync(join(homedir(), '.bodega-secrets/resend.key'), 'utf8').trim() };
  const sal = execFileSync('supabase', ['config', 'push', '--project-ref', ref, ...(process.argv.includes('--solo-diferencia') ? [] : ['--yes'])], { cwd: dir, env, encoding: 'utf8', input: process.argv.includes('--solo-diferencia') ? 'n\n' : undefined, stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(sal.replace(/re_[A-Za-z0-9_]+/g, '<oculto>'));
} catch (e) {
  console.log(String(e.stdout ?? '').replace(/re_[A-Za-z0-9_]+/g, '<oculto>'));
  console.error(String(e.stderr ?? '').replace(/re_[A-Za-z0-9_]+/g, '<oculto>').split('\n').filter((l) => !/new version|recommend/i.test(l)).join('\n'));
  if (!process.argv.includes('--solo-diferencia')) process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
