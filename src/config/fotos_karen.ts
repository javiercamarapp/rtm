// Mapa modelo -> foto local. Lo escribe `scripts/proveedores/bajar-fotos.mjs` (no editar a mano). La clave es el identificador corto del modelo (su "handle");
// el valor es una ruta dentro de `public/`. Sin entrada, la tarjeta muestra un marcador neutro con la marca. Nunca se enlaza una imagen del sitio de Karen.
export const FOTOS_KAREN: Readonly<Record<string, string>> = {
  'big-max': '/proveedores/karen/big-max.webp',
  'bot-it': '/proveedores/karen/bot-it.webp',
  'death-row-dr5000': '/proveedores/karen/death-row-dr5000.webp',
  'death-row-dr7000': '/proveedores/karen/death-row-dr7000.webp',
  'elfbar-bc-pro-40k': '/proveedores/karen/elfbar-bc-pro-40k.webp',
  'elfbar-te6000': '/proveedores/karen/elfbar-te6000.webp',
  'fasta-37-000': '/proveedores/karen/fasta-37-000.webp',
  'fifty-bar': '/proveedores/karen/fifty-bar.webp',
  'fire-xl': '/proveedores/karen/fire-xl.webp',
  'hyper-bar': '/proveedores/karen/hyper-bar.webp',
  'ijoy-uranus-mate': '/proveedores/karen/ijoy-uranus-mate.webp',
  'instabar-be-70-000': '/proveedores/karen/instabar-be-70-000.webp',
  'instabar-mega-80-hits': '/proveedores/karen/instabar-mega-80-hits.webp',
  'iplay-burst-45-000': '/proveedores/karen/iplay-burst-45-000.webp',
  'iplay-x-box-pro-max-50-000': '/proveedores/karen/iplay-x-box-pro-max-50-000.webp',
  'kross-unlimited-6-000': '/proveedores/karen/kross-unlimited-6-000.webp',
  'lightrise-18-000': '/proveedores/karen/lightrise-18-000.webp',
  'lost-mary-ultra-sonic-35k': '/proveedores/karen/lost-mary-ultra-sonic-35k.webp',
  'naked': '/proveedores/karen/naked.webp',
  'nexa-pix-35-000': '/proveedores/karen/nexa-pix-35-000.webp',
  'nexa-ultra-40-000': '/proveedores/karen/nexa-ultra-40-000.webp',
  'nitro': '/proveedores/karen/nitro.webp',
  'orion-bar-7500': '/proveedores/karen/orion-bar-7500.webp',
  'pillow-talk-40k': '/proveedores/karen/pillow-talk-40k.webp',
  'snowwolf': '/proveedores/karen/snowwolf.webp',
  'tyson-heavy-weight': '/proveedores/karen/tyson-heavy-weight.webp',
  'tyson-lightweight': '/proveedores/karen/tyson-lightweight.webp',
  'tyson-round-2': '/proveedores/karen/tyson-round-2.webp',
  'vape-bugatti-b6000': '/proveedores/karen/vape-bugatti-b6000.webp',
  'vape-geek-bar-pulse': '/proveedores/karen/vape-geek-bar-pulse.webp',
  'vape-geekbar-pulse-x': '/proveedores/karen/vape-geekbar-pulse-x.webp',
  'vape-iplay-max': '/proveedores/karen/vape-iplay-max.webp',
  'vape-iplay-x-box': '/proveedores/karen/vape-iplay-x-box.webp',
  'vape-iplay-x-box-pro': '/proveedores/karen/vape-iplay-x-box-pro.webp',
  'vape-v-play': '/proveedores/karen/vape-v-play.webp',
  'vape-waka-sopro-15-000': '/proveedores/karen/vape-waka-sopro-15-000.webp',
  'vape-wonder-g4': '/proveedores/karen/vape-wonder-g4.webp',
  'vfly-zero-cloud-50-000': '/proveedores/karen/vfly-zero-cloud-50-000.webp',
  'waka-blade-33-000': '/proveedores/karen/waka-blade-33-000.webp',
  'waka-burst-36-000': '/proveedores/karen/waka-burst-36-000.webp',
  'waka-elite-40k': '/proveedores/karen/waka-elite-40k.webp',
  'waka-go-10-000': '/proveedores/karen/waka-go-10-000.webp',
  'waka-icon-50-000': '/proveedores/karen/waka-icon-50-000.webp',
  'waka-icon-slim': '/proveedores/karen/waka-icon-slim.webp',
  'waka-jupiter-50k': '/proveedores/karen/waka-jupiter-50k.webp',
  'waka-optimus': '/proveedores/karen/waka-optimus.webp',
  'waka-pro-30k': '/proveedores/karen/waka-pro-30k.webp',
  'waka-slim-12-000': '/proveedores/karen/waka-slim-12-000.webp',
  'waka-steel': '/proveedores/karen/waka-steel.webp',
};

/** Mismo criterio que el script: minusculas, solo letras, numeros y guiones. */
export function claveFoto(handle: string): string {
  return handle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function fotoDeModelo(handle: string, mapa: Readonly<Record<string, string>> = FOTOS_KAREN): string | null {
  return mapa[claveFoto(handle)] ?? null;
}
