// Prepara las fotos de modelos: recorta el equipo de la imagen oficial, la lleva a 4:5, ancho maximo 800 px, webp < 150 KB.
// Uso: node scripts/modelos/preparar-fotos.mjs <carpeta-con-originales>
// Las imagenes originales se descargan UNA vez de la pagina oficial de la marca (ver docs/fotos-modelos.md) y no se versionan.
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
];

for (const f of FOTOS) {
  const base = sharp(join(origen, f.archivo));
  const { width, height } = await base.metadata();
  const c = { ...f.caja, width: Math.min(f.caja.width, width - f.caja.left), height: Math.min(f.caja.height, height - f.caja.top) };
  let calidad = 82;
  let salida;
  do {
    salida = await sharp(join(origen, f.archivo)).extract(c).resize({ width: 640, height: 800, fit: 'cover' }).webp({ quality: calidad }).toBuffer();
    calidad -= 8;
  } while (salida.length > 140 * 1024 && calidad > 30);
  await sharp(salida).toFile(join(destino, `${f.slug}.webp`));
  console.log(f.slug, (await stat(join(destino, `${f.slug}.webp`))).size, 'bytes');
}
