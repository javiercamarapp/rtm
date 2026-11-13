import type { Explicacion } from '@/dominio/catalogo/tipos';
import type { ActaDetalle, HistorialSocio, PeriodoSugerido } from '@/dominio/historial/tipos';

/** Lecturas del historial personal y del acta (solo socios). Cada una es una funcion de la base; la interfaz no calcula dinero. */
export interface LectorHistorial {
  historial(socio: string, hasta: string | null): Promise<HistorialSocio>;
  acta(cierreId: number): Promise<ActaDetalle | null>;
  periodoSugerido(): Promise<PeriodoSugerido>;
  /** Disponible por socio de un periodo (la resta la hace la base). */
  disponibleActa(ini: string, fin: string): Promise<Record<string, { disponible_cent: bigint }>>;
  explicar(cifra: string): Promise<Explicacion>;
}
