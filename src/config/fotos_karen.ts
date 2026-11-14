// Mapa modelo -> foto local. Lo escribe `scripts/proveedores/bajar-fotos.mjs` (no editar a mano). La clave es el identificador corto del modelo (su "handle");
// el valor es una ruta dentro de `public/`. Sin entrada, la tarjeta muestra un marcador neutro con la marca. Nunca se enlaza una imagen del sitio de Karen.
export const FOTOS_KAREN: Readonly<Record<string, string>> = {};

/** Mismo criterio que el script: minusculas, solo letras, numeros y guiones. */
export function claveFoto(handle: string): string {
  return handle.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function fotoDeModelo(handle: string, mapa: Readonly<Record<string, string>> = FOTOS_KAREN): string | null {
  return mapa[claveFoto(handle)] ?? null;
}
