import type { Explicacion } from '@/dominio/catalogo/tipos';
import type { ActaDetalle, HistorialSocio, PeriodoSugerido, ReinversionSugerida } from '@/dominio/historial/tipos';

/** Lecturas del historial personal y del acta (solo socios). Cada una es una funcion de la base; la interfaz no calcula dinero. */
export interface LectorHistorial {
  historial(socio: string, hasta: string | null): Promise<HistorialSocio>;
  acta(cierreId: number): Promise<ActaDetalle | null>;
  periodoSugerido(): Promise<PeriodoSugerido>;
  /** Disponible por socio de un periodo (la resta la hace la base). */
  disponibleActa(ini: string, fin: string): Promise<Record<string, { disponible_cent: bigint }>>;
  /** Reinversion IGUAL sugerida para un acta (la misma para los dos socios): el valor por omision del formulario. La calcula api.acta_reinversion_sugerida. */
  reinversionSugerida(ini: string, fin: string): Promise<ReinversionSugerida>;
  explicar(cifra: string): Promise<Explicacion>;
}
