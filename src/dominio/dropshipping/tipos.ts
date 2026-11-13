// Formas de lo que devuelven las funciones api.ds_* (dropshipping). Todo `*_cent` es bigint (centavos). Fechas "AAAA-MM-DD".
import type { EstadoPedido, Origen } from '@/dominio/operacion/tipos';

export type Cent = bigint;
export type OrigenSurtido = 'dropshipping' | 'inventario_merida';
export type TipoVenta = 'cliente' | 'socio_a_costo';
export type ModoInteres = 'simple' | 'compuesto' | 'fijo';
export type FuentePago = 'sociedad' | 'socio_fondos' | 'socio_propio' | 'socio_capital' | 'cliente_a_proveedor';

export interface FilaDs {
  pedido_id: number; folio: string; fecha_neg: string; fecha_envio: string | null; estado: EstadoPedido; origen: Origen; origen_surtido: OrigenSurtido;
  proveedor: 'Karen' | 'Isaac' | null; folio_externo: string | null; tipo_venta: TipoVenta | null; cliente_id: number; cliente: string;
  piezas_pedidas: number; piezas_surtidas: number; real: boolean; venta_cent: Cent; costo_cent: Cent; seguro_cent: Cent; margen_cent: Cent; utilidad_cent: Cent | null;
  saldo_cliente_cent: Cent | null; interes_cent: Cent | null; tasa_semanal_bp: number | null; semanas: number | null; fecha_pago_pactada: string | null; modo_interes: ModoInteres | null;
  amortizado_cent: Cent; por_pagar_cent: Cent; avisos: number; tiene_destinatario: boolean;
  costo_total_cent: Cent; guia_cent: Cent | null; margen_producto_cent: Cent; utilidad_provisional: boolean;
}

export interface FilaPorCobrar extends FilaDs { dias_para_vencer: number }

export interface GrupoOrden { marca: string; modelo: string; piezas: number; sabores: { sabor: string; piezas: number }[] }

export interface FichaDs extends FilaDs {
  es_dropshipping: boolean; es_estimado: boolean; proveedor_id: number | null; socio_venta: string | null; base_credito_cent: Cent | null; recargo_cent: Cent; plazo_dias: number | null;
  grupos: GrupoOrden[]; amortizaciones: { id: number; fecha_neg: string; concepto: string; monto_cent: Cent }[]; revelaciones: number;
}

export interface Destinatario {
  pedido_id: number; nombre: string; calle_numero: string; colonia: string; cp: string; municipio: string; estado: string;
  telefono_mascara: string; correo_mascara: string; tiene_telefono: boolean; tiene_correo: boolean; referencias: string;
}
export interface DatosDestinatario { nombre: string; calle_numero: string; colonia: string; cp: string; municipio: string; estado: string; telefono: string; correo: string; referencias: string }

export interface OrdenProveedor { pedido_id: number; folio: string; texto: string; grupos: GrupoOrden[]; piezas: number; costo_proveedor_cent: Cent; incluye_destinatario: boolean; completo: boolean; falta_destinatario: boolean }

export interface ColumnaOrigen {
  origen_surtido: OrigenSurtido; pedidos: number; piezas: number; venta_cent: Cent; costo_cent: Cent; margen_cent: Cent; por_cobrar_cent: Cent; por_pagar_cent: Cent; intereses_cent: Cent;
}
export interface ResumenDs {
  por_origen: ColumnaOrigen[];
  en_curso: { origen_surtido: OrigenSurtido; pedidos: number; piezas: number; venta_estimada_cent: Cent; costo_estimado_cent: Cent }[];
  proveedores: { proveedor: string; saldo_cent: Cent }[];
  sin_folio_externo: number;
  piezas_movidas: PiezasMovidas;
}
export interface PiezasMovidas {
  total: number; de_clientes: number; a_costo_socios: number; en_curso: number;
  por_proveedor: { proveedor: string; piezas: number; de_clientes: number | null; a_costo_socios: number | null; pedidos: number }[];
  por_socio: { socio: string; piezas: number; pedidos: number; costo_cent: Cent }[];
  por_mes: { mes: string; piezas: number; a_costo_socios: number }[];
}
export interface SocioAportacion { socio: string; aportado_cent: Cent; puso_capital_cent: Cent; puso_reembolsable_cent: Cent; fondos_en_poder_cent: Cent; aportacion_neta_cent: Cent; diferencia_a_igualar_cent: Cent }
export interface AportacionNeta { mayor_aportacion_neta_cent: Cent; socios: SocioAportacion[]; identidad: { via1_cent: Cent; via2_cent: Cent; cuadra: boolean } }
export interface ConciliacionPeriodo {
  ini: string; fin: string; utilidad_pedidos_cent: Cent; utilidad_dropshipping_cent: Cent; utilidad_inventario_cent: Cent; otros_no_pedido_cent: Cent; utilidad_periodo_cent: Cent; diferencia_cent: Cent; cuadra: boolean; provisional: boolean;
  socios: { socio: string; utilidad_periodo_cent: Cent }[];
}
export interface FilaDesglose { clave: string; etiqueta: string; pedidos: number; piezas: number; venta_cent: Cent; costo_cent: Cent; margen_cent: Cent; por_cobrar_cent?: Cent; por_pagar_cent?: Cent; intereses_cent?: Cent }
export type DimensionDesglose = 'origen' | 'semana' | 'mes' | 'cliente' | 'marca' | 'modelo' | 'sabor';

export interface CuentaProveedorDs {
  proveedor: string; saldo_cent: Cent; saldo_cuenta_corriente_cent: Cent; directos_enviados_cent: Cent; etiqueta: 'A favor' | 'Se debe' | 'Saldo cero';
  pedidos: FilaDs[]; costo_enviado_cent: Cent; amortizado_cent: Cent; reinvertida_cent: Cent; anticipo_cent: Cent;
  pagos: { id: number; fecha_neg: string; concepto: string; monto_cent: Cent; nota: string | null; amortizado: { folio: string; monto_cent: Cent }[] }[];
}

export interface ParteSocio { socio: string; utilidad_cent: Cent; reinvertida_cent: Cent }
export interface FilaUtilidad {
  pedido_id: number; folio: string; cliente: string; fecha_envio: string; tipo_venta: TipoVenta | null; proveedor: string | null; costo_cent: Cent; costo_producto_cent: Cent; envio_proveedor_cent: Cent; otros_directos_cent: Cent; provisional: boolean; venta_cent: Cent; utilidad_cent: Cent;
  depositado_proveedor_cent: Cent; reinvertida_cent: Cent; fuera_proveedor_cent: Cent; socios: ParteSocio[];
}
export interface UtilidadDs {
  desde: string | null; hasta: string | null; filas: FilaUtilidad[];
  totales: { pedidos: number; venta_cent: Cent; costo_cent: Cent; utilidad_cent: Cent; reinvertida_cent: Cent; fuera_proveedor_cent: Cent; socios: ParteSocio[] };
}
export interface SocioMes {
  socio: string; utilidad_mes_cent: Cent; reinvertida_mes_cent: Cent; utilidad_acum_cent: Cent; reinvertida_acum_cent: Cent; reinvertida_por_acta_mes_cent: Cent; retirado_por_acta_mes_cent: Cent;
  capital_declarado_cent: Cent; reinvertida_por_acta_acum_cent: Cent; sugerido_acta_cent: Cent; participacion_ppm: number; valuacion_cent: Cent | null;
}
export interface ReporteMensual { meses: { mes: string; utilidad_cent: Cent; reinvertida_cent: Cent; utilidad_acum_cent: Cent; reinvertida_acum_cent: Cent; valuacion_neta_cent: Cent | null; conciliacion: ConciliacionPeriodo; socios: SocioMes[] }[] }

export interface SkuDs { sku_id: number; modelo_id: number; marca: string; modelo: string; sabor: string; estado: string; precio_cent: Cent | null; costo_cent: Cent | null }
export interface CatalogoDs { interes_defecto_bp: number; envio_default_cent: Cent; skus: SkuDs[] }
