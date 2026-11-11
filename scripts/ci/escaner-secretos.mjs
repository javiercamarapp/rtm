// Escaner de secretos y correos. Falla si el repo (archivos versionados o por versionar, y su historial) contiene:
//  - un correo que no sea ficticio (@example.test, @prueba.invalid)
//  - una llave o token con forma de secreto (JWT, sb_secret_, sk-..., claves privadas, AWS)
//  - una variable NEXT_PUBLIC_ que nombre un secreto
//  - un archivo .env* o de llaves versionado
//  - cualquiera de los correos de la lista privada local (~/.bodega-secrets/allowlist-correos.txt), en archivos o en historial.
// NUNCA imprime el contenido del hallazgo: solo archivo, linea y tipo.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const OMITIR = [/(^|\/)package-lock\.json$/, /\.(woff2?|png|jpe?g|webp|ico|pdf)$/, /^docs\/capturas\//, /^test\/fixtures\//];
const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DOMINIOS_FICTICIOS = new Set(['example.test', 'prueba.invalid', 'email.com']);
const DIRECCIONES_DE_EJEMPLO = new Set(['tu@correo.com']); // texto de ayuda del campo de correo, no una persona
const SECRETOS = [
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/sb_(secret|publishable)_[A-Za-z0-9_-]{16,}/, 'llave de Supabase'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'llave sk-'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'llave privada'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'llave AWS'],
  [/(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PIMIENTA)\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{24,}['"]/i, 'asignacion de secreto'],
  [/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|PIMIENTA)/, 'secreto expuesto como NEXT_PUBLIC_'],
];

const hallazgos = [];
const archivos = git('ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean);

for (const rel of archivos) {
  if (/(^|\/)\.env(\.|$)/.test(rel) && rel !== '.env.example') hallazgos.push(`${rel}  archivo .env versionable`);
  if (/\.(pem|key)$/.test(rel) || /(^|\/)secretos?\//.test(rel)) hallazgos.push(`${rel}  archivo de llaves versionable`);
  if (OMITIR.some((r) => r.test(rel))) continue;
  let txt;
  try {
    txt = readFileSync(join(raiz, rel), 'utf8');
  } catch {
    continue;
  }
  txt.split('\n').forEach((linea, i) => {
    for (const m of linea.matchAll(CORREO)) {
      const dominio = m[0].split('@')[1].toLowerCase();
      if (!DOMINIOS_FICTICIOS.has(dominio) && !DIRECCIONES_DE_EJEMPLO.has(m[0].toLowerCase())) hallazgos.push(`${rel}:${i + 1}  correo no ficticio`);
    }
    for (const [re, tipo] of SECRETOS) if (re.test(linea)) hallazgos.push(`${rel}:${i + 1}  ${tipo}`);
  });
}

// Lista privada local: ninguno de sus correos puede aparecer en el repo ni en su historial.
const lista = `${homedir()}/.bodega-secrets/allowlist-correos.txt`;
let revisadaLista = false;
if (existsSync(lista)) {
  const correos = [...new Set(readFileSync(lista, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l.includes('@')))];
  const dir = mkdtempSync(join(tmpdir(), 'rtm-escaner-'));
  const patrones = join(dir, 'p.txt');
  try {
    writeFileSync(patrones, `${correos.join('\n')}\n`, { mode: 0o600 });
    revisadaLista = correos.length > 0;
    // Archivos del arbol de trabajo (versionados o no).
    try {
      const out = execFileSync('git', ['grep', '-I', '-i', '-l', '-F', '--untracked', '-f', patrones], { cwd: raiz, encoding: 'utf8' });
      for (const f of out.split('\n').filter(Boolean)) hallazgos.push(`${f}  contiene un correo de la lista privada`);
    } catch (e) {
      if (e.status !== 1) throw e; // 1 = sin coincidencias
    }
    // Historial completo.
    const commits = git('rev-list', '--all').split('\n').filter(Boolean);
    if (commits.length) {
      try {
        const out = execFileSync('git', ['grep', '-I', '-i', '-l', '-F', '-f', patrones, ...commits], { cwd: raiz, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
        const n = out.split('\n').filter(Boolean).length;
        if (n) hallazgos.push(`(historial)  ${n} coincidencias con la lista privada`);
      } catch (e) {
        if (e.status !== 1) throw e;
      }
      // Mensajes de commit (el correo del autor es la identidad Git configurada por su dueno y no se revisa).
      const mensajes = git('log', '--all', '--format=%B').toLowerCase();
      for (const c of correos) if (mensajes.includes(c)) hallazgos.push('(mensajes de commit)  contiene un correo de la lista privada');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (hallazgos.length) {
  console.error(`Escaner de secretos: ${hallazgos.length} hallazgos (contenido omitido a proposito)\n${[...new Set(hallazgos)].join('\n')}`);
  process.exit(1);
}
console.log(`Escaner de secretos: 0 hallazgos en ${archivos.length} archivos${revisadaLista ? ' y en el historial (lista privada local comprobada)' : ' (sin lista privada local que comprobar)'}.`);
