// Estados del reporte (spec 16, sec. 8): DEFINITIVO, PRELIMINAR, PARCIAL, y la regla de que el PDF no sale si falla una comprobacion bloqueante.
import { PARAMETROS } from './parametros';
import type { DecisionEstado, EtiquetaEstado, ResultadoComprobacion } from './tipos';

export interface EntradaEstado {
  readonly comprobaciones: readonly ResultadoComprobacion[];
  readonly periodoAprobado: boolean;
  readonly enCurso: boolean;
  readonly datosIncompletos: readonly string[];
  /** Por omision PARAMETROS.bloqueantes; el reporte de Omar usa C8 y C9. */
  readonly bloqueantes?: readonly string[];
}

/** Las internas (R.*) son siempre bloqueantes: un reporte nunca sale con una cifra no verificada. */
export function esBloqueante(id: string, bloqueantes: readonly string[] = PARAMETROS.bloqueantes): boolean {
  return id.startsWith('R.') || bloqueantes.includes(id);
}

export function decidirEstado(e: EntradaEstado): DecisionEstado {
  const lista = e.bloqueantes ?? PARAMETROS.bloqueantes;
  const falladas = e.comprobaciones.filter((c) => !c.ok);
  const bloqueantes = falladas.filter((c) => esBloqueante(c.id, lista)).map((c) => c.id);
  const fallas = falladas.filter((c) => !esBloqueante(c.id, lista)).map((c) => c.id);
  if (bloqueantes.length > 0) {
    return { sale: false, etiquetas: [], bloqueantes, fallas, motivo: `El reporte no salió: falla ${bloqueantes.join(', ')}. Corrijan y escriban 'reintentar reporte'.` };
  }
  const etiquetas: EtiquetaEstado[] = [];
  if (!e.periodoAprobado || fallas.length > 0) etiquetas.push('PRELIMINAR');
  if (e.enCurso || e.datosIncompletos.length > 0) etiquetas.push('PARCIAL');
  if (etiquetas.length === 0) etiquetas.push('DEFINITIVO');
  const partes: string[] = [];
  if (!e.periodoAprobado) partes.push('periodo sin aprobar');
  if (fallas.length > 0) partes.push(`falla ${fallas.join(', ')}`);
  if (e.enCurso) partes.push('periodo en curso');
  if (e.datosIncompletos.length > 0) partes.push(`datos incompletos: ${e.datosIncompletos.join(', ')}`);
  return { sale: true, etiquetas, bloqueantes: [], fallas, motivo: partes.length ? partes.join('; ') : 'periodo aprobado y todas las comprobaciones en verde' };
}

export const etiquetaEstadoTexto = (d: DecisionEstado): string => (d.etiquetas.length ? d.etiquetas.join(' · ') : 'NO SALE');

/** Cuenta de comprobaciones: "14 de 14". */
export function resumenComprobaciones(cs: readonly ResultadoComprobacion[]): { ok: number; total: number } {
  return { ok: cs.filter((c) => c.ok).length, total: cs.length };
}
