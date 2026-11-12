// Respaldo logico CIFRADO de la base de la nube (esquema + datos de los esquemas de RTM) a ~/.bodega-backups (carpeta 700, archivos 600).
//   node scripts/despliegue/respaldo.mjs [etiqueta]          etiqueta: diario | semanal | previo-a-despliegue (por omision: diario)
//   node scripts/despliegue/respaldo.mjs --descifrar <archivo.enc> <salida.sql>   para restaurar
// Cifrado: openssl aes-256-cbc -pbkdf2 con la clave ~/.bodega-secrets/rtm-respaldo.key. Retencion: 14 diarios, 8 semanales, 10 previos.
// Requiere Docker activo (la CLI de Supabase corre pg_dump en un contenedor) y el proyecto ligado. Los usuarios de Auth NO van en el
// volcado de datos: se vuelven a crear con scripts/acceso/alta-usuarios-nube.mjs (lee la lista privada de permitidos).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), '.bodega-backups');
const clave = join(homedir(), '.bodega-secrets/rtm-respaldo.key');
const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
if (!existsSync(clave)) { console.error('Falta ~/.bodega-secrets/rtm-respaldo.key (python3 -c "import secrets;print(secrets.token_hex(32),end=\'\')" > ... ; chmod 600).'); process.exit(1); }

if (process.argv[2] === '--descifrar') {
  execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-pass', `file:${clave}`, '-in', process.argv[3], '-out', process.argv[4]]);
  chmodSync(process.argv[4], 0o600);
  console.log('Descifrado.');
  process.exit(0);
}
const etiqueta = process.argv[2] ?? 'diario';
if (!/^[a-z-]+$/.test(etiqueta)) { console.error('etiqueta invalida'); process.exit(2); }
const sello = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const tmp = mkdtempSync(join(tmpdir(), 'rtm-resp-'));
chmodSync(tmp, 0o700);
try {
  const partes = [['esquema', []], ['datos', ['--data-only', '--use-copy']]];
  for (const [nombre, extra] of partes) {
    const plano = join(tmp, `${nombre}.sql`);
    execFileSync('supabase', ['db', 'dump', '--linked', ...extra, '-f', plano], { cwd: raiz, stdio: ['ignore', 'ignore', 'ignore'] });
    const dest = join(dir, `rtm-${etiqueta}-${sello}-${nombre}.sql.enc`);
    execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-pass', `file:${clave}`, '-in', plano, '-out', dest]);
    chmodSync(dest, 0o600);
    console.log(`Respaldo ${nombre}: ${dest} (${statSync(dest).size} bytes, cifrado)`);
  }
  appendFileSync(join(dir, 'despliegues.log'), `${new Date().toISOString()} respaldo etiqueta=${etiqueta}\n`, { mode: 0o600 });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
// Retencion por etiqueta.
const tope = { diario: 14, semanal: 8, 'previo-a-despliegue': 10 }[etiqueta] ?? 10;
const mios = readdirSync(dir).filter((f) => f.startsWith(`rtm-${etiqueta}-`) && f.endsWith('-esquema.sql.enc')).sort();
for (const viejo of mios.slice(0, Math.max(0, mios.length - tope))) {
  for (const parte of ['esquema', 'datos']) { const f = join(dir, viejo.replace('-esquema.', `-${parte}.`)); if (existsSync(f)) unlinkSync(f); }
}
