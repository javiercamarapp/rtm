import type { Candidata, ReferenciasMovimientos, DesgloseFila, DimensionMovimientos, GrupoMovimientos, ListaMovimientos, ResumenMovimientos, UtilidadMovimientos } from '@/dominio/movimientos/tipos';

/** Lo que la web lee de la zona Movimientos. Clasificar, conciliar e importar van por la lista cerrada de acciones (mov_*). */
export interface LectorMovimientos {
  resumen(): Promise<ResumenMovimientos>;
  lista(estado: string | null, limite: number, desplazamiento: number): Promise<ListaMovimientos>;
  agrupado(dim: DimensionMovimientos): Promise<GrupoMovimientos[]>;
  desglose(dim: DimensionMovimientos, id: number): Promise<DesgloseFila[]>;
  utilidad(): Promise<UtilidadMovimientos>;
  referencias(): Promise<ReferenciasMovimientos>;
  candidatas(tipo: 'pago' | 'gasto' | 'aportacion', montoCent: bigint): Promise<Candidata[]>;
}
