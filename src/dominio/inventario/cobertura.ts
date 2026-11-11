// Palabras del semaforo de cobertura (doc 18, 2.2): ordenadas por urgencia, no por color. El estado siempre va en palabra.
import type { EstadoCoberturaCodigo } from './tipos';

export const PALABRA_COBERTURA: Record<EstadoCoberturaCodigo, string> = {
  urge: 'Urge pedir',
  brevedad: 'Pedir a la brevedad',
  siguiente: 'Pedir siguiente pedido',
  buena: 'Buena cantidad',
  excelente: 'Excelente',
  sobrestock: 'Sobrestock',
  sin_movimiento: 'Sin movimiento',
  sin_historia: 'Sin historia',
};

export type TonoCobertura = 'ok' | 'atencion' | 'malo' | 'neutro';
export const TONO_COBERTURA: Record<EstadoCoberturaCodigo, TonoCobertura> = {
  urge: 'malo', brevedad: 'atencion', siguiente: 'atencion', buena: 'ok', excelente: 'ok', sobrestock: 'atencion', sin_movimiento: 'neutro', sin_historia: 'neutro',
};

/** Orden de urgencia para ordenar la lista de reposicion: lo que se acaba primero. */
export const URGENCIA_COBERTURA: Record<EstadoCoberturaCodigo, number> = {
  urge: 0, brevedad: 1, siguiente: 2, buena: 3, excelente: 4, sobrestock: 5, sin_movimiento: 6, sin_historia: 7,
};

export function textoDias(dias: number | null): string {
  if (dias === null) return 'Sin dato';
  const redondeado = Math.round(dias * 10) / 10;
  return `${Number.isInteger(redondeado) ? redondeado : redondeado.toFixed(1)} d`;
}
