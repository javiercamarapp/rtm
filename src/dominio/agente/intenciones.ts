// Catalogo de intenciones del agente. El modelo devuelve TEXTOS tal como se dijeron (nunca ids ni importes calculados);
// el codigo resuelve alias y calcula. Los esquemas estrictos (zod) viven en aplicacion/agente/esquemas.ts y deben coincidir con estos tipos.

export const TIPOS_GASTO = ['guia', 'envio', 'uber', 'comision_terminal', 'servicio', 'otro'] as const;
export type TipoGasto = (typeof TIPOS_GASTO)[number];

export type QuienPaga = 'angelo' | 'javier' | 'sociedad';
export type SocioNombre = 'angelo' | 'javier';

export interface LineaPedidoTexto {
  modelo_texto: string;
  sabor_texto: string | null;
  piezas: number;
  /** Solo si el mensaje lo dice; se compara contra el tabulador, nunca lo reemplaza. */
  precio_texto: string | null;
  fuente_cita: string;
}

export interface IPedido {
  tipo: 'pedido';
  cliente_texto: string;
  destino_texto: string | null;
  lineas: LineaPedidoTexto[];
  envio_cobrado_centavos: number | null;
  fuente_cita: string;
}

export interface IPago {
  tipo: 'pago';
  cliente_texto: string;
  monto_centavos: number;
  cuenta_destino_texto: string | null;
  pedido_folio: string | null;
  fuente_cita: string;
}

/** Adenda 23: pago de un cliente redirigido a un proveedor, o pago de un socio al proveedor. Un solo proveedor por indicacion. */
export interface IPagoProveedor {
  tipo: 'pago_proveedor';
  proveedor_texto: string;
  monto_centavos: number;
  pagado_por: QuienPaga;
  cliente_texto: string | null;
  fuente_cita: string;
}

export interface IGasto {
  tipo: 'gasto';
  gasto: TipoGasto;
  monto_centavos: number;
  pagado_por: QuienPaga;
  descripcion: string | null;
  fuente_cita: string;
}

/** Adenda 21: aportacion de capital de un socio (se devuelve con las utilidades). */
export interface IAportacion {
  tipo: 'aportacion';
  socio: SocioNombre;
  monto_centavos: number;
  motivo: string | null;
  fuente_cita: string;
}

export interface ILineaCompraTexto {
  modelo_texto: string;
  sabor_texto: string | null;
  piezas: number;
}

export interface ICompra {
  tipo: 'compra';
  proveedor_texto: string;
  lineas: ILineaCompraTexto[];
  guia_centavos: number | null;
  pagado_por: QuienPaga | null;
  fuente_cita: string;
}

/** Adenda 23: la OC lleva el costo vigente del proveedor (lo pone el servidor) y descuenta saldo a favor si se pide. */
export interface IOrdenCompra {
  tipo: 'orden_compra';
  proveedor_texto: string;
  lineas: ILineaCompraTexto[];
  aplicar_saldo: boolean;
  fuente_cita: string;
}

export interface ITomaOmar {
  tipo: 'toma_omar';
  lineas: ILineaCompraTexto[];
  fuente_cita: string;
}

export const TIPOS_CONSULTA = [
  'inventario',
  'saldo',
  'saldo_proveedor',
  'precio',
  'pedido',
  'explicar',
  'resumen',
  'liquidacion_proveedor',
  'pendientes',
  'ayuda',
] as const;
export type TipoConsulta = (typeof TIPOS_CONSULTA)[number];

export interface IConsulta {
  tipo: 'consulta';
  consulta: TipoConsulta;
  modelo_texto: string | null;
  sabor_texto: string | null;
  /** omar | isaac | karen | socios | texto de cliente */
  sujeto_texto: string | null;
  folio: string | null;
  periodo: 'hoy' | 'ayer' | 'semana' | null;
}

export interface IDeshacer {
  tipo: 'deshacer';
  folio: string | null;
}

export interface IAclarar {
  tipo: 'aclarar';
  pregunta: string;
}

export interface INinguna {
  tipo: 'ninguna';
}

export type Intencion =
  | IPedido
  | IPago
  | IPagoProveedor
  | IGasto
  | IAportacion
  | ICompra
  | IOrdenCompra
  | ITomaOmar
  | IConsulta
  | IDeshacer
  | IAclarar
  | INinguna;

export type TipoIntencion = Intencion['tipo'];

/** Respuesta completa del extractor para un mensaje. */
export interface RespuestaExtractor {
  acciones: Intencion[];
  sospecha_inyeccion: boolean;
  baja_certeza: boolean;
}

export const MAX_ACCIONES = 6;
export const MAX_LINEAS = 30;

/** Intenciones que escriben (todo lo demas es lectura o meta). */
export const INTENCIONES_ESCRITURA: readonly TipoIntencion[] = [
  'pedido',
  'pago',
  'pago_proveedor',
  'gasto',
  'aportacion',
  'compra',
  'orden_compra',
  'toma_omar',
  'deshacer',
];

export function esEscritura(t: TipoIntencion): boolean {
  return INTENCIONES_ESCRITURA.includes(t);
}
