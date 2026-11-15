#!/usr/bin/env node
// Baja la foto de producto de los modelos que NO tienen foto, desde las URL candidatas que se revisaron a mano (scripts/proveedores/fotos-web-candidatas.json).
//
//   node scripts/proveedores/fotos-web.mjs --verificar   baja a memoria, valida y dice que haria; NO escribe nada.
//   node scripts/proveedores/fotos-web.mjs --aplicar     guarda public/modelos/<slug>.webp, actualiza src/dominio/catalogo/fotos-modelos.ts y agrega la procedencia a docs/fotos-modelos.md.
//
// Reglas: respeta robots.txt de cada servidor, pausa >= 1.1 s entre peticiones, agente de usuario generico sin datos personales, sin cuenta ni cookies.
// Valida: tipo image/*, lado menor >= 300 px, no mas de 3:1 de proporcion (descarta banners y logos), >= 8 KB. Optimiza a webp de 800 px y menos de 150 KB sin metadatos.
// Un candidato con confianza 'dudoso' (otro sabor, otro modelo parecido o dos candidatos plausibles) NO se baja: queda en la cola 'por confirmar' del informe.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTE_USUARIO, PAUSA_MS, optimizar, reglasRobots } from './bajar-fotos.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIN_LADO = 300;

export const slugDe = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Valida metadatos de la imagen ya decodificada. Devuelve null si sirve, o el motivo de rechazo. */
export function motivoDeRechazo({ tipo, bytes, ancho, alto }) {
  if (!/^image\/(jpeg|png|webp)/i.test(tipo ?? '')) return `tipo no valido (${tipo || 'desconocido'})`;
  if (bytes < 8 * 1024) return 'archivo demasiado pequeno (probable icono o logo)';
  if (Math.min(ancho, alto) < MIN_LADO) return `lado menor ${Math.min(ancho, alto)} px (< ${MIN_LADO})`;
  if (Math.max(ancho, alto) / Math.min(ancho, alto) > 3) return 'proporcion extrema (probable banner)';
  return null;
}

export function reemplazarFoto(tabla, id, ruta, confianza) {
  const re = new RegExp(`(\\{ id: ${Number(id)}, [^}]*?foto: )null(, confianza: )'sin_evidencia'( \\})`);
  return re.test(tabla) ? tabla.replace(re, `$1'${ruta}'$2'${confianza}'$3`) : null;
}

async function principal() {
  const av = process.argv.slice(2);
  const aplicar = av.includes('--aplicar');
  if (aplicar === av.includes('--verificar')) { console.error('Uso: fotos-web.mjs --verificar | --aplicar [--candidatas=ruta]'); return 2; }
  const archivo = av.find((a) => a.startsWith('--candidatas='))?.slice(13) ?? join(RAIZ, 'scripts', 'proveedores', 'fotos-web-candidatas.json');
  const cands = JSON.parse(readFileSync(archivo, 'utf8')).candidatas;
  const { default: sharp } = await import('sharp');
  const tablaRuta = join(RAIZ, 'src', 'dominio', 'catalogo', 'fotos-modelos.ts');
  let tabla = readFileSync(tablaRuta, 'utf8');
  let doc = readFileSync(join(RAIZ, 'docs', 'fotos-modelos.md'), 'utf8');
  const hoy = new Date().toISOString().slice(0, 10);
  const robots = new Map();
  let ultima = 0;
  const pedir = async (url, aceptar) => {
    const espera = PAUSA_MS - (Date.now() - ultima);
    if (ultima && espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultima = Date.now();
    return fetch(url, { headers: { 'User-Agent': AGENTE_USUARIO, Accept: aceptar }, redirect: 'follow', signal: globalThis.AbortSignal.timeout(25_000) });
  };
  const resumen = { con_foto: [], por_confirmar: [], sin_foto: [] };
  for (const c of cands) {
    const nota = (m) => { resumen[m.l].push(`${c.nombre} (id ${c.id}): ${m.t}`); console.log(`${m.l === 'con_foto' ? 'OK ' : m.l === 'por_confirmar' ? 'COLA' : 'SIN '} ${c.nombre}: ${m.t}`); };
    if (!c.imagen) { nota({ l: 'sin_foto', t: c.nota ?? 'sin candidato' }); continue; }
    if (c.confianza === 'dudoso') { nota({ l: 'por_confirmar', t: `${c.nota ?? 'candidato dudoso'} (${c.imagen})` }); continue; }
    try {
      const u = new URL(c.imagen);
      if (!robots.has(u.origin)) {
        let regla = () => true;
        try { const r = await pedir(`${u.origin}/robots.txt`, 'text/plain'); if (r.status === 200) regla = reglasRobots(await r.text()); } catch { /* sin robots legible */ }
        robots.set(u.origin, regla);
      }
      if (!robots.get(u.origin)(u.pathname + u.search)) { nota({ l: 'sin_foto', t: 'robots.txt no permite la imagen' }); continue; }
      const r = await pedir(c.imagen, 'image/*');
      if (r.status !== 200) { nota({ l: 'sin_foto', t: `http ${r.status}` }); continue; }
      const bytes = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      const rechazo = motivoDeRechazo({ tipo: r.headers.get('content-type'), bytes: bytes.length, ancho: meta.width ?? 0, alto: meta.height ?? 0 });
      if (rechazo) { nota({ l: 'sin_foto', t: rechazo }); continue; }
      const slug = slugDe(c.nombre);
      const ruta = `/modelos/${slug}.webp`;
      const nueva = reemplazarFoto(tabla, c.id, ruta, c.confianza === 'exacto' ? 'exacto' : 'probable');
      if (nueva === null) { nota({ l: 'sin_foto', t: 'el modelo ya tiene foto o no existe en la tabla' }); continue; }
      const salida = await optimizar(sharp, bytes);
      if (aplicar) {
        writeFileSync(join(RAIZ, 'public', 'modelos', `${slug}.webp`), salida);
        tabla = nueva;
        const linea = `- ${c.nombre} (${c.marca}, id ${c.id}, ${c.confianza === 'exacto' ? 'exacto' : 'probable'}): \`${slug}.webp\` - origen ${c.imagen} (pagina ${c.pagina ?? 'sin pagina'}; descargada el ${hoy})`;
        doc = doc.replace(/(## Fotos de la tienda del proveedor)/, `${linea}\n\n$1`);
      }
      nota({ l: 'con_foto', t: `${meta.width}x${meta.height} -> ${Math.round(salida.length / 1024)} KB ${aplicar ? 'guardada' : '(verificada, no se guarda)'}` });
    } catch (e) { nota({ l: 'sin_foto', t: String(e instanceof Error ? e.message : e).slice(0, 120) }); }
  }
  if (aplicar) { writeFileSync(tablaRuta, tabla); writeFileSync(join(RAIZ, 'docs', 'fotos-modelos.md'), doc); }
  console.log(`\nCon foto: ${resumen.con_foto.length}; por confirmar: ${resumen.por_confirmar.length}; sin foto: ${resumen.sin_foto.length}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await principal());
