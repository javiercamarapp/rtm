// Prepara las fotos de modelos: recorta el equipo de la imagen oficial, la lleva a 4:5, ancho maximo 800 px, webp < 150 KB.
// Uso: node scripts/modelos/preparar-fotos.mjs <carpeta-con-originales>
// Las imagenes originales se descargan UNA vez de la pagina oficial de la marca (ver docs/fotos-modelos.md) y no se versionan.
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const [, , origen] = process.argv;
if (!origen) throw new Error('Falta la carpeta de originales.');
const destino = new URL('../../public/modelos/', import.meta.url).pathname;
await mkdir(destino, { recursive: true });

// slug -> archivo original y caja de recorte {left, top, width, height} sobre el original.
const FOTOS = [
  { slug: 'geek-bar-somax-80k', archivo: 'somax-80k.jpg', caja: { left: 165, top: 270, width: 420, height: 525 } },
  { slug: 'geek-bar-2go-50k', archivo: '2go.jpg', caja: { left: 40, top: 138, width: 610, height: 762 } },
  { slug: 'lost-mary-ultrasonic', archivo: 'ultrasonic-35k.jpg', caja: { left: 70, top: 110, width: 400, height: 500 } },
  // 14-nov, segunda tanda. Sin `caja`: la imagen ya es el equipo sobre fondo transparente o blanco y entra completa (contain) en 4:5 sobre blanco.
  { slug: 'flavor-beast-50k', archivo: 'flavorbeast-xbm50.png', caja: { left: 1330, top: 565, width: 1040, height: 1715 }, ajuste: 'contain' },
  { slug: 'waka-blast-50k', archivo: 'waka-blast-50k.png' },
  { slug: 'waka-duo', archivo: 'waka-duo.png' },
  { slug: 'waka-go-mundialista', archivo: 'waka-go-mundialista.png' },
  { slug: 'maskking-extre-100k', archivo: 'maskking-extre-100k.png' },
  { slug: 'equator-30k', archivo: 'equator-30000.png' },
  { slug: 'fasta-burst-35k', archivo: 'fasta-35k.png' },
  { slug: 'south-3k', archivo: 'south-3000.png' },
];

const MAX_BYTES = 140 * 1024;
const BLANCO = { r: 255, g: 255, b: 255, alpha: 1 };

/** Con caja recorta y llena el 4:5; sin caja, el equipo entra completo con margen. Siempre sin metadatos (no se usa withMetadata). */
async function render(origenArchivo, f, calidad) {
  let tuberia = sharp(origenArchivo).flatten({ background: BLANCO });
  if (f.caja) {
    const { width, height } = await sharp(origenArchivo).metadata();
    tuberia = tuberia.extract({ ...f.caja, width: Math.min(f.caja.width, width - f.caja.left), height: Math.min(f.caja.height, height - f.caja.top) }).resize({ width: 640, height: 800, fit: f.ajuste === 'contain' ? 'contain' : 'cover', background: BLANCO });
  } else {
    tuberia = tuberia.trim({ background: BLANCO, threshold: 8 }).resize({ width: 560, height: 720, fit: 'inside' }).extend({ top: 40, bottom: 40, left: 40, right: 40, background: BLANCO }).resize({ width: 640, height: 800, fit: 'contain', background: BLANCO });
  }
  return tuberia.webp({ quality: calidad }).toBuffer();
}

for (const f of FOTOS) {
  const archivo = join(origen, f.archivo);
  if (!existsSync(archivo)) { console.log(f.slug, 'sin original en la carpeta: se conserva el webp existente'); continue; }
  let calidad = 82;
  let salida;
  do {
    salida = await render(archivo, f, calidad);
    calidad -= 8;
  } while (salida.length > MAX_BYTES && calidad > 30);
  await sharp(salida).toFile(join(destino, `${f.slug}.webp`));
  console.log(f.slug, (await stat(join(destino, `${f.slug}.webp`))).size, 'bytes');
}
