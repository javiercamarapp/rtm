export type Cent = bigint;
export type EstadoMovimiento = 'sin_clasificar' | 'clasificado' | 'conciliado' | 'duplicado' | 'descartado';
export const TIPOS_MOVIMIENTO = ['cobro_cliente', 'pago_proveedor', 'aportacion', 'retiro', 'gasto', 'fondos_en_poder_socio', 'transferencia_entre_socios', 'otro'] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export const ETIQUETA_TIPO: Record<TipoMovimiento, string> = {
  cobro_cliente: 'Cobro de cliente', pago_proveedor: 'Pago a proveedor', aportacion: 'Aportación', retiro: 'Retiro', gasto: 'Gasto',
  fondos_en_poder_socio: 'Fondos en poder de un socio', transferencia_entre_socios: 'Transferencia entre socios', otro: 'Otro',
};
export const ETIQUETA_ESTADO: Record<EstadoMovimiento, string> = {
  sin_clasificar: 'Sin clasificar', clasificado: 'Clasificado', conciliado: 'Conciliado', duplicado: 'Duplicado', descartado: 'Descartado',
};

export interface ResumenEstado { estado: EstadoMovimiento; n: number; entradas_cent: Cent; salidas_cent: Cent }
export interface ImportacionResumen { id: number; fuente: 'pegado' | 'archivo'; nombre_archivo: string | null; filas_total: number; filas_nuevas: number; filas_duplicadas: number; creada_at: string }
export interface ResumenMovimientos { estados: ResumenEstado[]; total: number; importaciones: ImportacionResumen[] }

export interface FilaMovimiento {
  id: number;
  fecha_neg: string;
  monto_cent: Cent;
  cuenta: string | null;
  origen: string | null;
  mensaje: string | null;
  estado: EstadoMovimiento;
  tipo: TipoMovimiento | null;
  cliente: string | null;
  pedido: string | null;
  socio: string | null;
  proveedor: string | null;
  contraparte_tipo: 'pago' | 'gasto' | 'aportacion' | null;
  contraparte_id: number | null;
  motivo: string | null;
}
export interface ListaMovimientos { total: number; filas: FilaMovimiento[] }

export type DimensionMovimientos = 'pedido' | 'cliente' | 'socio' | 'proveedor';
export const DIMENSIONES: readonly { id: DimensionMovimientos; etiqueta: string }[] = [
  { id: 'pedido', etiqueta: 'Por pedido' }, { id: 'cliente', etiqueta: 'Por cliente' }, { id: 'socio', etiqueta: 'Por socio' }, { id: 'proveedor', etiqueta: 'Por proveedor' },
];
export interface GrupoMovimientos { id: number; etiqueta: string; n: number; entradas_cent: Cent; salidas_cent: Cent; neto_cent: Cent; conciliados: number; primera: string; ultima: string }
export interface DesgloseFila { id: number; fecha_neg: string; monto_cent: Cent; tipo: TipoMovimiento | null; estado: EstadoMovimiento; cuenta: string | null; origen: string | null; mensaje: string | null }

export interface UtilidadPedido { pedido_id: number; folio: string; cliente: string; fecha_envio: string; utilidad_cent: Cent; provisional: boolean; cobrado_cent: Cent }
export interface UtilidadSocio { socio: string; mitad_cent: Cent; retirado_cent: Cent; retenido_cent: Cent }
export interface UtilidadMovimientos {
  pedidos: UtilidadPedido[];
  utilidad_pedidos_cent: Cent;
  utilidad_total_cent: Cent;
  provisional: boolean;
  socios: UtilidadSocio[];
  /** Posicion de cada socio con la sociedad (+ la sociedad le debe): la misma cifra del encabezado de la app. */
  posicion_angelo_cent: Cent;
  posicion_javier_cent: Cent;
  posicion_mayor: 'Angelo' | 'Javier';
  /** Brecha entre las dos posiciones (la del encabezado). No es lo que un socio le debe al otro: eso es la mitad (deuda_entre_socios_cent). */
  posicion_diferencia_cent: Cent;
  /** Quien debe a quien: (AportadoNeto(A) - AportadoNeto(J)) / 2, la cifra de cuenta_socios() cuando la compra la pusieron los socios. */
  deudor: 'Angelo' | 'Javier' | null;
  acreedor: 'Angelo' | 'Javier' | null;
  deuda_entre_socios_cent: Cent;
  javier_debe_a_angelo_cent: Cent;
  cuadra: boolean;
  costo_cent: Cent;
}

export type TipoContraparte = 'pago' | 'gasto' | 'aportacion';
/** El hecho con que se concilia cada clasificacion (la misma regla que operacion.mov_tipo_contraparte). Sin entrada: ese tipo no se concilia. */
export const CONTRAPARTE_DE_TIPO: Partial<Record<TipoMovimiento, TipoContraparte>> = {
  cobro_cliente: 'pago', fondos_en_poder_socio: 'pago', aportacion: 'aportacion', gasto: 'gasto',
};
export interface Candidata { tipo: TipoContraparte; id: number; texto: string; monto_cent: Cent }

export interface ReferenciasMovimientos { clientes: { id: number; nombre: string }[]; proveedores: { id: number; nombre: string }[]; pedidos: { id: number; folio: string; cliente: string }[] }
