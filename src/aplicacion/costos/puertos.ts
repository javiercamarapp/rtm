// Puertos del modulo de costos. La implementacion real (Postgres) llega con las tablas de docs/lanes/costos-sistema-necesita-db.md.

import type { TipoCambioFechado } from '@/dominio/costos/cargo';
import type { LineaAsiento } from '@/dominio/costos/eventos';
import type { CargoCosto, ReembolsoCosto } from '@/dominio/costos/tipos';

export interface EventoRegistrado {
  readonly folio: string;
  readonly tipo: string;
  readonly refId: string;
  readonly lineas: readonly LineaAsiento[];
}

/** Repositorio de solo insercion: no existe operacion para editar ni borrar un cargo. */
export interface PuertoRepositorioCostos {
  siguienteFolio(prefijo: 'K' | 'R'): Promise<string>;
  insertarCargo(cargo: CargoCosto, evento: Omit<EventoRegistrado, 'folio'>): Promise<EventoRegistrado>;
  insertarReembolso(r: ReembolsoCosto, evento: Omit<EventoRegistrado, 'folio'>): Promise<EventoRegistrado>;
  cargoPorId(id: string): Promise<CargoCosto | null>;
  cargoPorClave(claveIdem: string): Promise<CargoCosto | null>;
  cargoPorEvidencia(servicioSlug: string, mes: string, sha256: string): Promise<CargoCosto | null>;
  reversaDe(cargoId: string): Promise<CargoCosto | null>;
  reembolsoPorClave(claveIdem: string): Promise<ReembolsoCosto | null>;
  listarCargos(): Promise<readonly CargoCosto[]>;
  listarReembolsos(): Promise<readonly ReembolsoCosto[]>;
}

/** Tipo de cambio fechado. Devuelve el FIX de la fecha o el ultimo publicado anterior; null si no hay ninguno. */
export interface PuertoTipoCambio {
  delDia(fechaNeg: string): Promise<TipoCambioFechado | null>;
}

export interface PuertoIds {
  nuevoId(): string;
}
