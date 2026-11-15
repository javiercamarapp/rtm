// Folio automatico de pedido (decision del dueno, 14-nov): iniciales del cliente + consecutivo de 3 digitos por clave de iniciales.
// ESPEJO de operacion.iniciales_cliente / operacion.siguiente_folio_pedido (supabase/migrations/20261116200100_folio_pedido_iniciales.sql). El folio real lo genera SQL;
// este modulo solo sirve para pruebas y para los simulados (nunca para asignar folios en produccion).

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'di', 'van', 'von']);

/** Dos letras mayusculas: nombre y apellido (primeras dos palabras utiles); una palabra = sus dos primeras letras; sin letras = XX. */
export function inicialesCliente(nombre: string): string {
  const t = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  const palabras = t === '' ? [] : t.split(' ');
  const utiles = palabras.filter((p) => !PARTICULAS.has(p));
  const base = utiles.length > 0 ? utiles : palabras;
  if (base.length === 0) return 'XX';
  if (base.length === 1) return base[0]!.slice(0, 2).padEnd(2, 'x').toUpperCase();
  return (base[0]!.slice(0, 1) + base[1]!.slice(0, 1)).toUpperCase();
}

export function formatearFolioPedido(iniciales: string, consecutivo: number): string {
  return `${iniciales}-${String(consecutivo).padStart(3, '0')}`;
}

/** Folios nuevos (MG-001) y viejos (P-0012). */
export function esFolioPedido(texto: string): boolean {
  return /^(?:[A-Z]{2}-\d{3,}|P-\d{4})$/.test(texto.trim().toUpperCase());
}
