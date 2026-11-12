import type { CajaResumen, DetalleInventario, FiltroLibro, KardexConsolidado, LibroDinero, Mermas, ResumenMarcas, ValuacionDetalle, ValuacionSerie } from '@/dominio/datos/tipos';

export interface FiltroKardex { marca: string | null; modelo: number | null; sku: number | null; ini: string | null; fin: string | null; tipo: string | null; q: string | null; limite: number; desplazamiento: number }

/** Lecturas enterprise (solo lectura, solo socios). Cada una es una funcion de la base; la interfaz no calcula dinero. */
export interface LectorDatos {
  kardexConsolidado(f: FiltroKardex): Promise<KardexConsolidado>;
  detalleInventario(ini: string | null, fin: string | null): Promise<DetalleInventario>;
  resumenMarcas(ini: string | null, fin: string | null): Promise<ResumenMarcas>;
  mermas(ini: string | null, fin: string | null, limite: number, desplazamiento: number): Promise<Mermas>;
  valuacionDetalle(hasta: string | null): Promise<ValuacionDetalle>;
  valuacionSerie(desde: string | null, hasta: string | null, paso: 'mes' | 'semana'): Promise<ValuacionSerie>;
  caja(ini: string | null, fin: string | null): Promise<CajaResumen>;
  libro(f: FiltroLibro): Promise<LibroDinero>;
}
