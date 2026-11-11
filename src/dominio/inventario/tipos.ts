// Tipos de lo que devuelven las funciones de inventario de la base. Los importes `*_cent` ya llegan como bigint (ver dominio/operacion/json).
export type Cent = bigint;

export type EstadoCoberturaCodigo = 'urge' | 'brevedad' | 'siguiente' | 'buena' | 'excelente' | 'sobrestock' | 'sin_movimiento' | 'sin_historia';

export interface SaborInventario {
  sku_id: number; sabor: string; piezas: number; reservado: number; disponible: number; valor_cent: Cent;
  cobertura_dias: number | null; demanda_diaria: number | null; estado: EstadoCoberturaCodigo | null;
}

export interface ModeloInventario {
  modelo_id: number; marca: string; modelo: string; puffs: number | null; estado_catalogo: 'disponible' | 'sin_disponibilidad';
  /** null = sin movimientos registrados (Sin dato). */
  piezas: number | null; valor_cent: Cent | null; costo_prom_cent: Cent | null;
  reservado: number | null; disponible: number | null; cobertura_dias: number | null; demanda_diaria: number | null; estado: EstadoCoberturaCodigo | null;
  lt_dias: number | null; dias_historia: number | null; socios_venden: boolean; ultimo_movimiento: string | null; sabores: SaborInventario[];
}

export interface CompraReciente {
  compra_id: number; folio: string; proveedor: string; pagadas: number; facturadas: number; recibidas: number | null;
  puente_piezas: number; puente_valor_cent: Cent; fuera_sociedad_cent: Cent;
}

export interface InventarioCompleto {
  corte: string; hoy: string;
  parametros: { objetivo_dias: number; sobrestock_x: number; ciclo_dias: number; historia_minima_dias: number; ventana_dias: number; lt_dias: Record<string, number> };
  modelos: ModeloInventario[];
  totales: { piezas: number; valor_cent: Cent; reservado: number; modelos_con_existencia: number };
  comprobacion: { valor_modelos_cent: Cent; valor_sabores_cent: Cent; piezas_modelos: number; piezas_sabores: number };
  compras_recientes: CompraReciente[];
}

export interface MovimientoKardex {
  id: number; hora: string; fecha_neg: string; tipo: string; sabor: string; sku_id: number; ubicacion: string; referencia: string;
  entra_piezas: number | null; entra_unit_cent: Cent | null; entra_total_cent: Cent | null;
  sale_piezas: number | null; sale_unit_cent: Cent | null; sale_total_cent: Cent | null;
  saldo_piezas: number; saldo_valor_cent: Cent; costo_prom_cent: Cent | null; saldo_sabor_piezas: number;
  evento: string; canal: string; mensaje_origen: string | null; autor: string | null; reversa_de: number | null; es_reversa: boolean; nota: string | null;
}

export interface Kardex {
  modelo: { id: number; marca: string; nombre: string };
  apertura: { piezas: number; valor_cent: Cent; costo_prom_cent: Cent | null } | null;
  movimientos: MovimientoKardex[]; total: number; truncado: boolean;
  sabores: { sku_id: number; sabor: string }[];
  modelos: { id: number; marca: string; nombre: string }[];
  comprobacion: { via1: string; via1_valor_cent: Cent; via2: string; via2_valor_cent: Cent; cuadra: boolean };
}

export interface HojaConteoSku { sku_id: number; marca: string; modelo: string; sabor: string }
export interface LineaDiferenciaConteo {
  sku_id: number; marca: string; modelo: string; sabor: string; esperado: number; vendido_por_recoger: number; disponible_sistema: number; contado: number; diferencia: number;
}
export interface PrevisualizacionConteo { lineas: LineaDiferenciaConteo[]; con_diferencia: number; piezas_diferencia: number; piezas_esperadas: number; exactitud_bp: number | null }

export const EXPLICACIONES_CONTEO = ['venta_no_registrada', 'toma_no_registrada', 'error_de_sabor', 'reclamo_proveedor', 'merma', 'error_de_conteo'] as const;
export type ExplicacionConteo = (typeof EXPLICACIONES_CONTEO)[number];

export interface ResumenConteo {
  id: number; tipo: string; ubicacion: string; estado: 'abierto' | 'cerrado'; contado_at: string; lineas: number; con_diferencia: number; sin_explicar: number; exactitud_bp: number | null;
}
export interface DetalleConteo {
  id: number; tipo: string; ubicacion: string; estado: string; contado_at: string;
  lineas: { sku_id: number; marca: string; modelo: string; sabor: string; esperado: number; contado: number; diferencia: number; explicacion_tipo: ExplicacionConteo | null; explicacion_ref: string | null; ajuste_valor_cent: Cent | null }[];
}

export type VersionInventario = 'clientes' | 'interna';
export interface ParametrosInventario {
  marca: string | null; modelo: string | null; solo_socios_venden: boolean; solo_disponibles: boolean; mostrar_cantidades: boolean; con_caladas: boolean; cliente_id: number | null;
}

export interface SaborDocumento { sabor: string; disponible: boolean; cantidad?: number | null; piezas?: number; valor_cent?: Cent; estado?: EstadoCoberturaCodigo | null }
export interface ModeloDocumento {
  marca: string; modelo: string; puffs: number | null; disponible: boolean | number; cantidad?: number | null; precio_cent?: Cent | null;
  piezas?: number; reservado?: number; valor_cent?: Cent; costo_prom_cent?: Cent | null; estado?: EstadoCoberturaCodigo | null; cobertura_dias?: number | null;
  sabores: SaborDocumento[];
}
export interface SnapshotInventario {
  version: VersionInventario; corte: string; hoy: string; parametros: ParametrosInventario; modelos: ModeloDocumento[];
  totales?: { piezas: number; valor_cent: Cent; reservado: number; modelos_con_existencia: number };
}
export interface DocumentoReservado { id: number; folio: string; version: VersionInventario; corte: string; huella: string; snapshot: SnapshotInventario }
export interface DocumentoGuardado { id: number; folio: string; version: VersionInventario; corte: string; huella: string; sha256: string | null; snapshot: SnapshotInventario; base64: string | null; creado_at: string }
export interface ResumenDocumento { id: number; folio: string; version: VersionInventario; corte: string; sha256: string; creado_at: string }
