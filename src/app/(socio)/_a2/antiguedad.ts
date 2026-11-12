// Tramos de antiguedad por ultima entrada (el costo es promedio movil, no por lotes: no es PEPS). Solo agrupa lo que la base entrega.
import type { Cent } from '@/dominio/inventario/tipos';

export const TRAMOS = [
  { id: '0-30', etiqueta: '0 a 30 d', max: 30 }, { id: '31-60', etiqueta: '31 a 60 d', max: 60 }, { id: '61-90', etiqueta: '61 a 90 d', max: 90 }, { id: '90+', etiqueta: 'Más de 90 d', max: Infinity },
] as const;

export const tramoDe = (dias: number): (typeof TRAMOS)[number] => TRAMOS.find((t) => dias <= t.max) ?? TRAMOS[3];

export interface Acum { piezas: number; valor: Cent; sabores: number }
export function acumularPorTramo(filas: { dias: number | null; piezas: number; valor: Cent }[]): { tramos: Map<string, Acum>; sinDato: Acum } {
  const tramos = new Map<string, Acum>(TRAMOS.map((t) => [t.id, { piezas: 0, valor: 0n, sabores: 0 }]));
  const sinDato: Acum = { piezas: 0, valor: 0n, sabores: 0 };
  for (const f of filas) {
    const a = f.dias === null ? sinDato : tramos.get(tramoDe(f.dias).id)!;
    a.piezas += f.piezas; a.valor += f.valor; a.sabores += 1;
  }
  return { tramos, sinDato };
}
