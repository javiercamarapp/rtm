// Reglas puras de captura de devoluciones y de recepcion parcial. El dinero NO se calcula aqui: la base calcula credito, costo y asientos;
// esto solo valida que lo que se manda sea coherente (enteros, tope de piezas) y arma el JSON de la accion.
import type { PedidoDevoluciones, RecepcionCompra } from './tipos';

export type DestinoDevolucion = 'inventario' | 'merma';
export interface CapturaDevolucion { sku_id: number; linea_id: number; piezas: string; destino: DestinoDevolucion }
export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

function entero(texto: string): number | null {
  const t = texto.trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** Arma los renglones de una devolucion de cliente. Rechaza texto no entero, pasarse de lo disponible a devolver y devolucion vacia. */
export function armarDevolucionCliente(origen: PedidoDevoluciones['renglones'], capturas: CapturaDevolucion[]): Resultado<{ linea_id: number; sku_id: number; piezas: number; destino: DestinoDevolucion }[]> {
  const salida: { linea_id: number; sku_id: number; piezas: number; destino: DestinoDevolucion }[] = [];
  for (const c of capturas) {
    const n = entero(c.piezas);
    if (n === null) return { ok: false, error: 'Las piezas deben ser números enteros.' };
    if (n === 0) continue;
    const r = origen.find((x) => x.linea_id === c.linea_id && x.sku_id === c.sku_id);
    if (!r) return { ok: false, error: 'Un renglón no pertenece al pedido.' };
    if (n > r.disponibles_devolver) return { ok: false, error: `De ${r.modelo} ${r.sabor} solo se pueden devolver ${r.disponibles_devolver} piezas (surtidas ${r.surtidas}, ya devueltas ${r.devueltas}).` };
    salida.push({ linea_id: c.linea_id, sku_id: c.sku_id, piezas: n, destino: c.destino });
  }
  if (salida.length === 0) return { ok: false, error: 'Escribe cuántas piezas se devuelven.' };
  return { ok: true, valor: salida };
}

export interface CapturaProveedor { sku_id: number; piezas: string }
/** Renglones de una devolucion a proveedor: no se devuelve mas de lo disponible (lo apartado no sale). */
export function armarDevolucionProveedor(disponibles: { sku_id: number; modelo: string; sabor: string; disponible: number }[], capturas: CapturaProveedor[]): Resultado<{ sku_id: number; piezas: number }[]> {
  const salida: { sku_id: number; piezas: number }[] = [];
  for (const c of capturas) {
    const n = entero(c.piezas);
    if (n === null) return { ok: false, error: 'Las piezas deben ser números enteros.' };
    if (n === 0) continue;
    const s = disponibles.find((x) => x.sku_id === c.sku_id);
    if (!s) return { ok: false, error: 'Ese sabor no tiene disponible.' };
    if (n > s.disponible) return { ok: false, error: `De ${s.modelo} ${s.sabor} solo hay ${s.disponible} disponibles.` };
    salida.push({ sku_id: c.sku_id, piezas: n });
  }
  if (salida.length === 0) return { ok: false, error: 'Escribe cuántas piezas se devuelven.' };
  return { ok: true, valor: salida };
}

export interface CapturaLlegada { linea_id: number; sku_id: number; piezas: string }
/** Llegada parcial: piezas enteras por sabor; un renglon puede traer varios sabores. Avisa (sin bloquear) si se pasa de lo pendiente. */
export function armarLlegada(lineas: RecepcionCompra['lineas'], capturas: CapturaLlegada[]): Resultado<{ linea_id: number; sku_id: number; piezas: number }[]> & { avisos?: string[] } {
  const salida: { linea_id: number; sku_id: number; piezas: number }[] = [];
  const porLinea = new Map<number, number>();
  for (const c of capturas) {
    const n = entero(c.piezas);
    if (n === null) return { ok: false, error: 'Las piezas deben ser números enteros.' };
    if (n === 0) continue;
    if (!lineas.some((l) => l.linea_id === c.linea_id)) return { ok: false, error: 'Un renglón no pertenece a la orden.' };
    salida.push({ linea_id: c.linea_id, sku_id: c.sku_id, piezas: n });
    porLinea.set(c.linea_id, (porLinea.get(c.linea_id) ?? 0) + n);
  }
  if (salida.length === 0) return { ok: false, error: 'Escribe las piezas que llegaron.' };
  const avisos: string[] = [];
  for (const [id, n] of porLinea) {
    const l = lineas.find((x) => x.linea_id === id)!;
    if (n > l.pendientes) avisos.push(`${l.modelo}: llegan ${n} y faltaban ${l.pendientes}; el excedente quedará como sobrante al cerrar la recepción.`);
  }
  return { ok: true, valor: salida, avisos };
}

/** Progreso de una recepcion, en porcentaje entero de lo facturado (sin pasar de 100). */
export function progresoRecepcion(lineas: RecepcionCompra['lineas']): number {
  const f = lineas.reduce((a, l) => a + l.facturadas, 0);
  if (f === 0) return 0;
  const r = lineas.reduce((a, l) => a + Math.min(l.recibidas, l.facturadas), 0);
  return Math.min(100, Math.floor((r * 100) / f));
}
