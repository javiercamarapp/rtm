// Guardas estaticas (baseline 0). Falla si el codigo viola una regla de la especificacion:
//  - sin hex literal fuera de los tokens; sin style={{}}; sin window.confirm; sin <table> crudo; sin tamanos de fuente < 11 px
//  - sin formato regional (toLocaleString, Intl.NumberFormat) fuera de src/dominio/formato
//  - sin Date.now / new Date() / Math.random / process.env en el dominio
//  - sin Google, Redis ni Upstash en el acceso
// Exencion por HASH para los archivos copiados del login (scripts/ci/exenciones-login.json): si el archivo cambia, la exencion cae.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const raiz = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const exenciones = JSON.parse(readFileSync(join(raiz, 'scripts/ci/exenciones-login.json'), 'utf8'));
const sha = (txt) => createHash('sha256').update(txt).digest('hex');

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}

const fallos = [];
const falla = (archivo, linea, regla) => fallos.push(`${relative(raiz, archivo)}:${linea}  ${regla}`);

const TOKENS = join(raiz, 'src/ui/estilos/tokens.css');
const esPrueba = (f) => /\.test\.(ts|tsx)$/.test(f);

for (const f of archivos(join(raiz, 'src'))) {
  if (!/\.(ts|tsx|css|js)$/.test(f) || esPrueba(f)) continue;
  const rel = relative(raiz, f);
  const txt = readFileSync(f, 'utf8');
  const exento = exenciones[rel] === sha(txt);
  const lineas = txt.split('\n');
  const enDominio = rel.startsWith('src/dominio/');
  const enFormato = rel.startsWith('src/dominio/formato/');

  lineas.forEach((l, i) => {
    const n = i + 1;
    const codigo = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (!exento && f !== TOKENS && /(^|[^&\w/])#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(codigo) && /\.(css|tsx|ts)$/.test(f)) falla(f, n, 'hex literal fuera de los tokens');
    if (!exento && /\bstyle=\{\{/.test(codigo)) falla(f, n, 'style={{}} prohibido');
    if (!exento && /window\.confirm|\bconfirm\(/.test(codigo) && /\.(tsx|ts)$/.test(f)) falla(f, n, 'window.confirm prohibido (usar ConfirmDialog propio)');
    if (!exento && /<table[\s>]/.test(codigo) && f.endsWith('.tsx')) falla(f, n, '<table> crudo prohibido (usar DataTable)');
    if (!exento) {
      for (const m of codigo.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < 11) falla(f, n, `font-size ${m[1]}px < 11px`);
      for (const m of codigo.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\b/g)) if (Number(m[1]) < 11) falla(f, n, `fontSize ${m[1]} < 11`);
    }
    if (!enFormato && /\.toLocale(String|DateString|TimeString)\(|Intl\.NumberFormat/.test(codigo) && !exento) falla(f, n, 'formato regional fuera de src/dominio/formato');
    if (enDominio && /Date\.now\(|new Date\(\)|Math\.random\(|process\.env/.test(codigo)) falla(f, n, 'dominio impuro (reloj, azar o entorno)');
    if (!exento && /next\/font\/google|fonts\.googleapis|fonts\.gstatic/.test(codigo)) falla(f, n, 'fuente por red prohibida (usar archivos locales)');
    if (/upstash|ioredis|from 'redis'|signInWithOAuth|provider:\s*'google'/i.test(codigo) && !exento) falla(f, n, 'Redis/Upstash/Google fuera del alcance de RTM');
  });
}

// Las exenciones por hash deben seguir vigentes: si un archivo exento cambio, hay que revisarlo y actualizar su huella a conciencia.
for (const [rel, h] of Object.entries(exenciones)) {
  try {
    if (sha(readFileSync(join(raiz, rel), 'utf8')) !== h) fallos.push(`${rel}  exencion caducada: el archivo cambio (revisar y actualizar scripts/ci/exenciones-login.json)`);
  } catch {
    fallos.push(`${rel}  exencion apunta a un archivo inexistente`);
  }
}

if (fallos.length) {
  console.error(`Guardas estaticas: ${fallos.length} violaciones\n${fallos.join('\n')}`);
  process.exit(1);
}
console.log('Guardas estaticas: 0 violaciones (baseline 0).');
