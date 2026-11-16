// Orden de compra desde el stock del proveedor: arma, por modelo, la lista de sabores que se pueden pedir (los del catalogo de compra del proveedor, con su costo vigente) y marca cuales
// estan disponibles segun la lectura del proveedor (Karen). Sin lectura (Isaac), la disponibilidad es null: "por confirmar". Puro: no calcula dinero, solo agrupa y empata nombres.
import { normalizar } from '../catalogo/normalizar';

export interface SkuCompra { sku_id: number; modelo: string; marca: string; sabor: string; costo_cent: bigint | null }
export interface SaborOrden { skuId: number; sabor: string; /** true/false segun la lectura del proveedor; null si no hay lectura. */ disponible: boolean | null; costoCent: bigint | null }
export interface ModeloOrden { clave: string; marca: string; modelo: string; sabores: SaborOrden[]; disponibles: number }

/** `disponibilidad`: modelo canonico normalizado -> sabores disponibles normalizados (null si el proveedor no tiene lectura). */
export function armarModelosOrden(skus: readonly SkuCompra[], disponibilidad: ReadonlyMap<string, ReadonlySet<string>> | null): ModeloOrden[] {
  const porModelo = new Map<string, ModeloOrden>();
  for (const s of skus) {
    const clave = normalizar(s.modelo);
    let m = porModelo.get(clave);
    if (!m) { m = { clave, marca: s.marca, modelo: s.modelo, sabores: [], disponibles: 0 }; porModelo.set(clave, m); }
    const vistos = disponibilidad?.get(clave);
    const disponible = disponibilidad === null ? null : vistos ? vistos.has(normalizar(s.sabor)) : false;
    m.sabores.push({ skuId: s.sku_id, sabor: s.sabor, disponible, costoCent: s.costo_cent });
    if (disponible === true) m.disponibles += 1;
  }
  const lista = [...porModelo.values()];
  for (const m of lista) m.sabores.sort((a, b) => Number(b.disponible === true) - Number(a.disponible === true) || a.sabor.localeCompare(b.sabor, 'es'));
  // Con lectura, primero los modelos con sabores disponibles; luego por marca y nombre.
  return lista.sort((a, b) => (disponibilidad === null ? 0 : Number(b.disponibles > 0) - Number(a.disponibles > 0)) || a.marca.localeCompare(b.marca, 'es') || a.modelo.localeCompare(b.modelo, 'es'));
}

export interface LineaOrden { sku_id: number; pagadas: number }

/** Renglones de la orden: solo cantidades enteras positivas; ordenados por sku para que la misma captura de la misma orden. */
export function lineasDeOrden(cantidades: ReadonlyMap<number, number>): LineaOrden[] {
  return [...cantidades.entries()].filter(([, n]) => Number.isInteger(n) && n > 0).sort((a, b) => a[0] - b[0]).map(([sku_id, pagadas]) => ({ sku_id, pagadas }));
}
