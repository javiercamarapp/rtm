// Parte pura (sin E/S) de la correccion de precios por modelo de pedidos enviados (decision del dueno, 14-nov).
// Los datos REALES (folios, modelos, precios, totales) viven en un archivo JSON PRIVADO fuera del repo y entran con --datos <ruta>; aqui no hay ninguno.
// Formato (pesos enteros): { "<folio>": { "total_pesos": N, "precios": { "<modelo>": N }, "piezas": { "<modelo>": N } } }   ("piezas" es opcional y se compara contra la base).
// El total de cada pedido es el subtotal de mercancia (sin envio ni recargo) y debe cuadrar EXACTO con suma(precio x piezas).
import { z } from 'zod';

const entero = z.number().int().positive();
export const esquemaDatos = z.record(
  z.string().regex(/^P-\d+$/, 'folio con formato P-0000'),
  z.object({
    total_pesos: entero,
    precios: z.record(z.string().min(1), entero).refine((o) => Object.keys(o).length > 0, 'indica al menos un modelo'),
    piezas: z.record(z.string().min(1), entero).optional(),
  }).strict(),
).refine((o) => Object.keys(o).length > 0, 'indica al menos un pedido');

/** Valida el JSON de datos (zod) y devuelve el objeto; lanza con el detalle si el formato no es el esperado. */
export function leerDatos(json) {
  const r = esquemaDatos.safeParse(json);
  if (!r.success) throw new Error(`archivo de datos invalido: ${r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}`);
  return r.data;
}

/** Cuadre local: si trae piezas, suma(precio x piezas) debe ser el total; los modelos de piezas y precios deben ser los mismos. Devuelve la lista de errores. */
export function validarObjetivo(datos) {
  const errores = [];
  for (const [folio, p] of Object.entries(datos)) {
    if (!p.piezas) continue;
    const mp = Object.keys(p.precios).sort().join('|');
    const mq = Object.keys(p.piezas).sort().join('|');
    if (mp !== mq) { errores.push(`${folio}: los modelos de precios y de piezas no coinciden`); continue; }
    const suma = Object.entries(p.precios).reduce((s, [m, precio]) => s + precio * p.piezas[m], 0);
    if (suma !== p.total_pesos) errores.push(`${folio}: los precios suman ${suma} y el total es ${p.total_pesos}`);
  }
  return errores;
}

/** Precios por modelo en centavos, listos para la funcion oficial. */
export function preciosCentavos(datos, folio) {
  const p = datos[folio];
  if (!p) throw new Error(`pedido fuera del alcance: ${folio}`);
  return Object.fromEntries(Object.entries(p.precios).map(([m, precio]) => [m, precio * 100]));
}

/**
 * Renglones bajo costo (precio menor que costo unitario).
 * @param {{ modelo: string, piezas: number, precio_cent: number, costo_unit_cent: number | null }[]} lineas
 * @param {Record<string, number> | null} [precios] modelo -> centavos (para el "despues")
 */
export function renglonesBajoCosto(lineas, precios = null) {
  return lineas.filter((l) => (precios ? precios[l.modelo] : l.precio_cent) < l.costo_unit_cent).length;
}

/** Clave de idempotencia de la correccion de un pedido (sin datos personales). */
export const claveCorreccion = (folio) => `correccion-precios-por-modelo:${folio}:v1`;
