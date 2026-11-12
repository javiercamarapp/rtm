// Tipos de las lecturas enterprise (kardex consolidado, detalle, marcas, mermas, valuacion, caja, libro). La base calcula; la interfaz solo formatea.
import type { Cent } from '@/dominio/inventario/tipos';

export type TipoMovimiento = 'entrada_compra' | 'salida_pedido' | 'salida_toma_omar' | 'devolucion' | 'merma' | 'ajuste_conteo' | 'traspaso_puente' | 'reversa' | 'apertura';

export interface FilaKardex {
  id: number; hora: string; fecha_neg: string; tipo: TipoMovimiento; marca: string; modelo: string; modelo_id: number; sabor: string; sku_id: number; referencia: string;
  entra_piezas: number | null; entra_unit_cent: Cent | null; entra_total_cent: Cent | null;
  sale_piezas: number | null; sale_unit_cent: Cent | null; sale_total_cent: Cent | null;
  saldo_piezas: number; saldo_valor_cent: Cent; costo_prom_cent: Cent | null;
  /** Piezas del sabor despues del movimiento y su valor a costo del modelo (la base solo guarda piezas por sabor). */
  saldo_sabor_piezas: number; saldo_sabor_valor_cent: Cent | null;
  evento: string; canal: string; mensaje_origen: string | null; autor: string | null; reversa_de: number | null; es_reversa: boolean; nota: string | null;
}
export interface SaldoKardex { piezas: number; valor_cent: Cent; costo_prom_cent: Cent | null }
export interface KardexConsolidado {
  inicial: SaldoKardex; final: SaldoKardex;
  totales: { n: number; entradas_piezas: number; entradas_valor_cent: Cent; salidas_piezas: number; salidas_valor_cent: Cent };
  por_tipo: { tipo: TipoMovimiento; n: number; piezas: number; valor_cent: Cent }[];
  semanas: { semana: string; entradas_piezas: number; salidas_piezas: number; entradas_valor_cent: Cent; salidas_valor_cent: Cent }[];
  entradas_costo: { fecha_neg: string; unit_cent: Cent; costo_prom_cent: Cent | null }[];
  movimientos: FilaKardex[]; total: number; limite: number; desplazamiento: number;
  sabor: { sku_id: number; sabor: string; modelo_id: number; modelo: string; marca: string; piezas: number; piezas_modelo: number; valor_modelo_cent: Cent; ultima_entrada: string | null; ultima_salida: string | null; cobertura_dias: number | null; estado: string | null } | null;
  modelos: { id: number; marca: string; nombre: string }[]; marcas: string[];
  comprobacion: { via1: string; via1_valor_cent: Cent; via2: string; via2_valor_cent: Cent; cuadra: boolean };
  cuadre_periodo: { esperado_piezas: number; final_piezas: number; aplica: boolean };
}

export interface DetalleInventarioFila {
  entradas: number; salidas: number; mermas: number; ajustes: number; ultima_entrada: string | null; ultima_salida: string | null; piezas_inicial: number | null;
}
export interface DetalleInventario {
  ini: string; fin: string; hoy: string;
  modelos: (DetalleInventarioFila & { modelo_id: number })[];
  sabores: (DetalleInventarioFila & { sku_id: number; modelo_id: number })[];
}

export interface ResumenMarcaFila {
  marca_id: number; marca: string; proveedor: string | null; modelos: number; modelos_catalogo: number; sabores: number; piezas: number; valor_cent: Cent; costo_prom_cent: Cent | null;
  cobertura_media_dias: number | null; entradas: number; salidas: number; rotacion: number | null; ultima_entrada: string | null;
}
export interface ResumenMarcas {
  ini: string; fin: string; marcas: ResumenMarcaFila[];
  cuentas_proveedor: { proveedor: string; saldo_cent: Cent; etiqueta: string }[];
  compras_semana: { semana: string; piezas: number; valor_cent: Cent }[];
}

export interface Mermas {
  totales: { merma_piezas: number; merma_valor_cent: Cent; faltante_piezas: number; faltante_valor_cent: Cent; sobrante_piezas: number; sobrante_valor_cent: Cent; n: number };
  meses: { mes: string; merma_piezas: number; ajuste_piezas: number; valor_cent: Cent; n: number }[];
  modelos: { modelo_id: number; marca: string; modelo: string; piezas: number; valor_cent: Cent; n: number }[];
  movimientos: { id: number; fecha_neg: string; tipo: TipoMovimiento; marca: string; modelo: string; modelo_id: number; sabor: string; piezas: number; valor_cent: Cent; motivo: string | null; evento: string; autor: string | null; mensaje_origen: string | null }[];
  total: number; limite: number; desplazamiento: number;
}

export interface ValuacionDetalle {
  hasta: string;
  valuacion: { con_movimientos: boolean; v01_valuacion_cent: Cent; v02_deudas_cent: Cent; v03_diferencia_cent: Cent; v04_utilidad_empresa_cent: Cent; v05_utilidades_retenidas_cent: Cent; v06_capital_aportado_cent: Cent;
    inventario_cent: Cent; clientes_cent: Cent; omar_cent: Cent; l01_liquidez_cent: Cent | null; l02_liquidez_total_cent: Cent | null; l03_pago_semana_cent: Cent | null; l04_despues_de_pago_cent: Cent | null;
    identidades: { i1: { cuadra: boolean }; i2: { cuadra: boolean } } };
  cuentas: { codigo: string; nombre: string; tipo: 'A' | 'P'; saldo_cent: Cent; activa: boolean }[];
  inventario_por_marca: { marca: string; piezas: number; valor_cent: Cent; modelos: number }[];
  clientes: { cliente_id: number; cliente: string; saldo_cent: Cent; ultimo: string | null }[];
}
export interface ValuacionSerie {
  desde: string; hasta: string; paso: 'mes' | 'semana';
  filas: { corte: string; parcial: boolean; con_movimientos: boolean; valuacion_cent: Cent; deudas_cent: Cent; diferencia_cent: Cent; utilidad_cent: Cent; capital_cent: Cent;
    inicial_cent: Cent | null; cambio_cent: Cent | null; crecimiento_bp: number | null }[];
}

export interface CajaResumen {
  ini: string; fin: string; con_movimientos: boolean; saldo_inicial_cent: Cent;
  cuentas: { codigo: string; nombre: string; activa: boolean; tipo: 'efectivo' | 'banco' | 'socio'; saldo_cent: Cent; entradas_cent: Cent; salidas_cent: Cent; ultimo: string | null }[];
  totales: { entradas_cent: Cent; salidas_cent: Cent; n: number };
  semanas: { semana: string; entradas_cent: Cent; salidas_cent: Cent }[];
  dias: { fecha: string; saldo_cent: Cent }[];
  l01_liquidez_cent: Cent | null; l02_liquidez_total_cent: Cent | null; l03_pago_semana_cent: Cent | null; l04_despues_de_pago_cent: Cent | null; clientes_cent: Cent;
}

export type EstadoLibro = 'sin_clasificar' | 'clasificado' | 'conciliado';
export interface FiltroLibro { ini: string | null; fin: string | null; estado: EstadoLibro | null; q: string | null; minCent: bigint | null; maxCent: bigint | null; cuenta: string | null; limite: number; desplazamiento: number; orden: 'asc' | 'desc' }
export interface LibroDinero {
  totales: { n: number; cargos_cent: Cent; abonos_cent: Cent; neto_cent: Cent; saldo_inicial_cent: Cent; saldo_final_cent: Cent };
  meses: { mes: string; n: number; cargos_cent: Cent; abonos_cent: Cent; neto_cent: Cent; saldo_cent: Cent }[];
  estados: { estado: EstadoLibro; n: number }[];
  movimientos: { id: number; fecha_neg: string; concepto: string | null; categoria: string | null; cuenta: string | null; origen: string | null; contraparte: string | null; folio: string | null;
    cargo_cent: Cent | null; abono_cent: Cent | null; saldo_cent: Cent; estado: EstadoLibro }[];
  total: number; limite: number; desplazamiento: number; orden: 'asc' | 'desc'; excluidos: number; cuentas: string[];
}
