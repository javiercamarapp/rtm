// Presentacion de marcas, modelos y sabores: la palabra va en MAYUSCULAS siempre (decision del dueno, 14-nov).
// Es presentacion: nombre_canonico y nombre_norm no cambian y la busqueda sigue siendo insensible a mayusculas y acentos.
// Conserva numeros, la 'K' de puffs y los acentos (toLocaleUpperCase no los pierde); no inventa siglas ni toca cifras.
// Solo para texto que se MUESTRA o se exporta: nunca para identificadores, folios, correos ni nombres de personas o clientes.
const LOCALE = 'es-MX';

type Texto = string | null | undefined;

/** Mayusculas de un nombre de producto. Conserva null/undefined; recorta espacios de los extremos. */
function mayus<T extends Texto>(t: T): T {
  if (t === null || t === undefined) return t;
  return t.trim().toLocaleUpperCase(LOCALE) as T;
}

/** Modelo: 'Waka 15K' -> 'WAKA 15K'; 'iPlay Box Pro' -> 'IPLAY BOX PRO'. */
export const nombreVape = <T extends Texto>(modelo: T): T => mayus(modelo);
/** Marca: 'Geek Bar' -> 'GEEK BAR'. */
export const marcaMayus = <T extends Texto>(marca: T): T => mayus(marca);
/** Sabor: 'Piña Colada' -> 'PIÑA COLADA'. */
export const saborMayus = <T extends Texto>(sabor: T): T => mayus(sabor);

/** Marca y modelo juntos sin repetir la marca si el modelo ya la trae ('Waka' + 'Waka Blade 33K' -> 'WAKA BLADE 33K'). 'Sin marca' no se antepone. */
export function nombreVapeCompleto(modelo: string, marca?: Texto): string {
  const quita = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = mayus(modelo);
  if (!marca || quita(marca) === 'sin marca' || quita(modelo).startsWith(quita(marca))) return m;
  return `${mayus(marca)} ${m}`;
}
