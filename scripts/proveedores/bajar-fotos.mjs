#!/usr/bin/env node
// Baja UNA VEZ la foto de cada modelo de la pagina publica del proveedor, la optimiza y la guarda dentro del repo.
//
//   node scripts/proveedores/bajar-fotos.mjs [--seco] [--limite=N] [--env-file=ruta]
//
// Reglas (decision del dueno): respeta robots.txt, agente de usuario generico SIN datos personales, maximo 1 solicitud por segundo, sin iniciar sesion ni cookies,
// cada imagen se baja una sola vez (si ya existe el archivo no se vuelve a pedir). La direccion vive SOLO en la variable privada INVENTARIO_PROVEEDORES_FUENTE:
// este script nunca la imprime, no la guarda y no la escribe en el mapa. Del catalogo solo lee titulo, identificador corto e imagenes: descarta todo lo demas (precios incluidos).
// Salida: public/proveedores/karen/<clave>.webp (maximo 800 px, menos de 150 KB, sin metadatos) y src/config/fotos_karen.ts (mapa tipado modelo -> ruta).
// Cuenta como 2 peticiones del tope diario (robots + catalogo) mas las imagenes: correrlo una sola vez, fuera de la lectura horaria.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENTE_USUARIO = 'RTM-inventario/1.0 (catalogo publico, lectura unica de imagenes)';
export const PAUSA_MS = 1100;
export const MAX_LADO = 800;
export const MAX_BYTES = 150 * 1024;

/** Misma regla que `claveFoto` de src/config/fotos_karen.ts. */
export function claveFoto(handle) {
  return String(handle).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Lee las reglas de robots.txt que aplican a "*" (y a nuestro agente). Devuelve una funcion `permite(ruta)`. Sin archivo o ilegible: se permite lo publico. */
export function reglasRobots(texto) {
  const grupos = [];
  let actual = null;
  let anteriorEsAgente = false;
  for (const crudo of String(texto ?? '').split(/\r?\n/)) {
    const linea = crudo.replace(/#.*$/, '').trim();
    if (!linea) continue;
    const i = linea.indexOf(':');
    if (i < 0) continue;
    const campo = linea.slice(0, i).trim().toLowerCase();
    const valor = linea.slice(i + 1).trim();
    if (campo === 'user-agent') {
      if (!anteriorEsAgente) { actual = { agentes: [], reglas: [] }; grupos.push(actual); }
      actual.agentes.push(valor.toLowerCase());
      anteriorEsAgente = true;
    } else if ((campo === 'allow' || campo === 'disallow') && actual) {
      actual.reglas.push({ permite: campo === 'allow', ruta: valor });
      anteriorEsAgente = false;
    } else anteriorEsAgente = false;
  }
  const propio = grupos.filter((g) => g.agentes.some((a) => a !== '*' && AGENTE_USUARIO.toLowerCase().startsWith(a)));
  const elegidos = propio.length ? propio : grupos.filter((g) => g.agentes.includes('*'));
  const reglas = elegidos.flatMap((g) => g.reglas).filter((r) => r.ruta !== '');
  return (ruta) => {
    let mejor = null;
    for (const r of reglas) {
      const patron = new RegExp('^' + r.ruta.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
      if (patron.test(ruta) && (mejor === null || r.ruta.length > mejor.ruta.length || (r.ruta.length === mejor.ruta.length && r.permite))) mejor = r;
    }
    return mejor === null ? true : mejor.permite;
  };
}

/** Del JSON del catalogo conserva SOLO identificador corto, titulo y la primera imagen. Nada de precios ni variantes. */
export function extraerModelos(json) {
  const lista = Array.isArray(json?.products) ? json.products : [];
  const vistos = new Set();
  const salida = [];
  for (const p of lista) {
    const handle = typeof p?.handle === 'string' ? p.handle : '';
    const clave = claveFoto(handle);
    const src = Array.isArray(p?.images) && typeof p.images[0]?.src === 'string' ? p.images[0].src : null;
    if (!clave || !src || vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ clave, titulo: typeof p.title === 'string' ? p.title : clave, src });
  }
  return salida;
}

/** Texto de src/config/fotos_karen.ts con el mapa ordenado. */
export function renderMapa(mapa) {
  const filas = Object.keys(mapa).sort().map((k) => `  '${k}': '${mapa[k]}',`).join('\n');
  return `// Mapa modelo -> foto local. Lo escribe \`scripts/proveedores/bajar-fotos.mjs\` (no editar a mano). La clave es el identificador corto del modelo (su "handle");
// el valor es una ruta dentro de \`public/\`. Sin entrada, la tarjeta muestra un marcador neutro con la marca. Nunca se enlaza una imagen del sitio de Karen.
export const FOTOS_KAREN: Readonly<Record<string, string>> = {${filas ? `\n${filas}\n` : ''}};

/** Mismo criterio que el script: minusculas, solo letras, numeros y guiones. */
export function claveFoto(handle: string): string {
  return handle.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function fotoDeModelo(handle: string, mapa: Readonly<Record<string, string>> = FOTOS_KAREN): string | null {
  return mapa[claveFoto(handle)] ?? null;
}
`;
}

/** Optimiza: lado mayor <= 800 px, webp, sin metadatos, menos de 150 KB (baja la calidad por pasos). Devuelve el buffer o lanza si no cabe. */
export async function optimizar(sharp, bytes) {
  const base = sharp(bytes, { failOn: 'error' }).rotate().resize({ width: MAX_LADO, height: MAX_LADO, fit: 'inside', withoutEnlargement: true });
  for (const calidad of [82, 74, 66, 58, 50, 40]) {
    const salida = await base.clone().webp({ quality: calidad, effort: 5 }).toBuffer(); // sin .withMetadata(): se descartan EXIF, ICC y XMP
    if (salida.length < MAX_BYTES) return salida;
  }
  throw new Error('la imagen no cabe en 150 KB');
}

/**
 * Corre el proceso. `fetchFn`, `sharp` y `dormir` se inyectan para las pruebas; `log` nunca recibe la direccion de la fuente.
 */
export async function ejecutar({ base, fetchFn = fetch, sharp, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), dirFotos, archivoMapa, seco = false, limite = Infinity, log = console.log, modelosPrecargados = null, escribirMapa = true }) {
  const origen = new URL(base);
  let ultima = 0;
  let peticiones = 0;
  const pedir = async (url, aceptar) => {
    const espera = PAUSA_MS - (Date.now() - ultima);
    if (ultima && espera > 0) await dormir(espera);
    ultima = Date.now();
    peticiones += 1;
    return fetchFn(url, { method: 'GET', headers: { 'User-Agent': AGENTE_USUARIO, Accept: aceptar }, credentials: 'omit', redirect: 'follow', signal: globalThis.AbortSignal.timeout(20_000) });
  };
  const robotsPorOrigen = new Map();
  const permite = async (url) => {
    const u = new URL(url);
    if (!robotsPorOrigen.has(u.origin)) {
      let regla = () => true;
      try {
        const r = await pedir(`${u.origin}/robots.txt`, 'text/plain');
        if (r.status === 200) regla = reglasRobots(await r.text());
      } catch { /* sin robots legible: solo se pide lo publico, una vez */ }
      robotsPorOrigen.set(u.origin, regla);
    }
    return robotsPorOrigen.get(u.origin)(u.pathname + u.search);
  };

  let modelos;
  if (modelosPrecargados) modelos = modelosPrecargados; // el vigilante ya leyo el catalogo en su pasada: no se pide otra vez
  else {
    const rutaCatalogo = new URL('/products.json?limit=250', origen).toString();
    if (!(await permite(rutaCatalogo))) { log('robots.txt no permite leer el catalogo: no se baja nada.'); return { estado: 'robots', descargadas: 0, peticiones }; }
    const r = await pedir(rutaCatalogo, 'application/json');
    if (r.status !== 200) { log(`El catalogo respondio ${r.status}: se detiene (sin reintentos).`); return { estado: `http_${r.status}`, descargadas: 0, peticiones }; }
    modelos = extraerModelos(await r.json());
  }
  log(`Modelos con imagen: ${modelos.length}.`);
  if (seco) return { estado: 'seco', descargadas: 0, peticiones, modelos: modelos.length };

  mkdirSync(dirFotos, { recursive: true });
  const mapa = {};
  for (const f of readdirSync(dirFotos)) if (f.endsWith('.webp')) mapa[f.slice(0, -5)] = `/proveedores/karen/${f}`;
  let descargadas = 0;
  const fallos = [];
  const nuevas = [];
  for (const m of modelos) {
    if (mapa[m.clave]) continue; // ya esta: una sola vez
    if (descargadas >= limite) break;
    try {
      if (!(await permite(m.src))) { fallos.push(`${m.clave}: robots`); continue; }
      const img = await pedir(m.src, 'image/*');
      if (img.status === 403 || img.status === 429) { log(`La imagen respondio ${img.status}: se detiene.`); fallos.push(`${m.clave}: http ${img.status}`); break; }
      if (img.status !== 200) { fallos.push(`${m.clave}: http ${img.status}`); continue; }
      const salida = await optimizar(sharp, Buffer.from(await img.arrayBuffer()));
      writeFileSync(join(dirFotos, `${m.clave}.webp`), salida);
      mapa[m.clave] = `/proveedores/karen/${m.clave}.webp`;
      nuevas.push(m.clave);
      descargadas += 1;
    } catch (e) {
      fallos.push(`${m.clave}: ${e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, '[direccion]') : 'error'}`);
    }
  }
  if (escribirMapa) writeFileSync(archivoMapa, renderMapa(mapa));
  log(`Descargadas ${descargadas}; en el mapa ${Object.keys(mapa).length}; fallos ${fallos.length}. Peticiones hechas: ${peticiones}.`);
  for (const f of fallos) log(`  - ${f}`);
  log('REVISION MANUAL OBLIGATORIA antes de confirmar los archivos: abrir cada .webp y comprobar que no muestra precios, telefonos, direcciones ni rostros.');
  return { estado: 'ok', descargadas, peticiones, fallos, nuevas };
}

function leerVariable(archivo) {
  if (!archivo) return process.env.INVENTARIO_PROVEEDORES_FUENTE?.trim();
  const m = readFileSync(archivo, 'utf8').split(/\r?\n/).map((l) => l.match(/^INVENTARIO_PROVEEDORES_FUENTE=(.*)$/)).find(Boolean);
  return m?.[1]?.trim().replace(/^["']|["']$/g, '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
  const base = leerVariable(arg('env-file'));
  if (!base) { console.error('Falta la variable privada INVENTARIO_PROVEEDORES_FUENTE (entorno o --env-file=ruta). No se hizo ninguna peticion.'); process.exit(2); }
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { default: sharp } = await import('sharp');
  const r = await ejecutar({
    base, sharp, seco: process.argv.includes('--seco'), limite: arg('limite') ? Number(arg('limite')) : Infinity,
    dirFotos: join(raiz, 'public', 'proveedores', 'karen'), archivoMapa: join(raiz, 'src', 'config', 'fotos_karen.ts'),
  });
  process.exit(r.estado === 'ok' || r.estado === 'seco' ? 0 : 1);
}
