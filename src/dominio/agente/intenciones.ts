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
  /**
   * Decision del dueno (13-nov): el dinero propio de un socio que paga a un proveedor es REEMBOLSO por omision (null o 'reembolso').
   * 'capital' SOLO si el socio lo declara expresamente (invierto, reinvierto, meto mas lana); el codigo lo vuelve a verificar contra el mensaje.
   */
  intencion?: 'capital' | 'reembolso' | null;
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
  /**
   * Adenda 32: es capital SOLO si el socio lo declara con sus palabras ("de capital", "para invertir"); cualquier otro deposito es reembolso.
   * null = no lo dijo: el servidor lo registra como reembolso y el resumen de confirmacion lo dice con todas sus letras.
   */
  intencion: 'capital' | 'reembolso' | null;
  fuente_cita: string;
}

export type ViaPago = 'transferencia' | 'efectivo';

/** El negocio le paga a un socio lo que le debe por gastos o aportaciones reembolsables (operacion.registrar_pago_a_socio, tipo reembolso). */
export interface IReembolsoSocio {
  tipo: 'reembolso_socio';
  socio: SocioNombre;
  monto_centavos: number;
  via: ViaPago | null;
  fuente_cita: string;
}

/** Retiro de utilidad ya asignada (operacion.registrar_pago_a_socio, tipo retiro). La base rechaza lo que exceda lo que se le debe. */
export interface IRetiroUtilidad {
  tipo: 'retiro_utilidad';
  socio: SocioNombre;
  monto_centavos: number;
  via: ViaPago | null;
  fuente_cita: string;
}

/**
 * CONTRATO (depende de lane/devolucion-parcial: operacion.registrar_devolucion_cliente). Mientras esa migracion no este en la base,
 * el servidor responde "dependencia pendiente" y no registra nada.
 */
export interface IDevolucion {
  tipo: 'devolucion';
  cliente_texto: string;
  pedido_folio: string | null;
  lineas: ILineaCompraTexto[];
  destino: 'inventario' | 'merma' | null;
  motivo: string | null;
  fuente_cita: string;
}

/** CONTRATO (depende de lane/paquete-perdido: operacion.reportar_paquete_salida). Igual que la devolucion: sin la migracion no se registra. */
export interface IPaquetePerdido {
  tipo: 'paquete_perdido';
  pedido_folio: string | null;
  cliente_texto: string | null;
  incidente: 'perdido' | 'danado';
  detalle: string | null;
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

/** Estado de un pedido que mueve el socio desde el chat. */
export interface IPedidoEnvio {
  tipo: 'pedido_envio';
  pedido_folio: string | null;
  estado: 'enviado' | 'entregado';
  paqueteria_texto: string | null;
  guia_texto: string | null;
  fuente_cita: string;
}

export interface IPedidoCancelar {
  tipo: 'pedido_cancelar';
  pedido_folio: string | null;
  motivo: string | null;
  fuente_cita: string;
}

export interface ICompraRecepcion {
  tipo: 'compra_recepcion';
  compra_folio: string | null;
  /** Vacio = recepcion total; con renglones = parcial (solo lo dictado). */
  lineas: ILineaCompraTexto[];
  fuente_cita: string;
}

export interface ICompraEstado {
  tipo: 'compra_estado';
  compra_folio: string | null;
  estado: 'enviada' | 'llego_merida';
  fuente_cita: string;
}

export interface ICompraAprobar {
  tipo: 'compra_aprobar';
  compra_folio: string | null;
  fuente_cita: string;
}

/** Cargo de un servicio (OpenRouter, Vercel...). El monto en pesos lo calcula la base: USD por tipo de cambio. */
export interface IGastoServicio {
  tipo: 'gasto_servicio';
  servicio_texto: string;
  monto_usd_centavos: number | null;
  monto_mxn_centavos: number | null;
  tipo_cambio_micro: number | null;
  pagado_por: QuienPaga;
  fuente_cita: string;
}

export interface IMerma {
  tipo: 'merma';
  modelo_texto: string;
  sabor_texto: string | null;
  piezas: number;
  motivo: string | null;
  fuente_cita: string;
}

export interface IConteo {
  tipo: 'conteo';
  lineas: ILineaCompraTexto[];
  fuente_cita: string;
}

export interface IClienteAlta {
  tipo: 'cliente_alta';
  nombre: string;
  fuente_cita: string;
}

export interface IClientePrecio {
  tipo: 'cliente_precio';
  cliente_texto: string;
  modelo_texto: string;
  precio_centavos: number;
  fuente_cita: string;
}

export interface IActaPropuesta {
  tipo: 'acta_propuesta';
  /** Mes (AAAA-MM) del corte; null = el mes anterior. */
  mes: string | null;
  retira_angelo_centavos: number | null;
  retira_javier_centavos: number | null;
  reinvierte_angelo_centavos: number | null;
  reinvierte_javier_centavos: number | null;
  fuente_cita: string;
}

export interface IActaFirma {
  tipo: 'acta_firma';
  acta_folio: string | null;
  fuente_cita: string;
}

export interface IRenglonHistorico {
  tipo: 'gasto' | 'cobro' | 'aportacion' | 'reembolso' | 'retiro';
  /** AAAA-MM-DD, pasada y explicita. */
  fecha: string;
  monto_centavos: number;
  socio: SocioNombre | null;
  cliente_texto: string | null;
  cuenta_texto: string | null;
  concepto: string | null;
  intencion: 'capital' | 'reembolso' | null;
  via: ViaPago | null;
}

export interface ILoteHistorico {
  tipo: 'lote_historico';
  etiqueta: string | null;
  /** Si el socio dicta un total, el codigo lo compara con la suma de los renglones; si no cuadra se bloquea. */
  total_dictado_centavos: number | null;
  renglones: IRenglonHistorico[];
  fuente_cita: string;
}

export const TIPOS_CONSULTA = [
  'cuadra',
  'balance',
  'diario',
  'cobertura',
  'reporte',
  'compras',
  'pedidos',
  'saldos_socios',
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
  /** Estado de cuenta de un socio (sujeto: angelo o javier). */
  'estado_cuenta_socio',
  /** Utilidad operativa del periodo (hoy, semana o mes). */
  'utilidad',
  /** Cuanto debe cada cliente. */
  'cartera',
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
  periodo: 'hoy' | 'ayer' | 'semana' | 'mes' | null;
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
  | IReembolsoSocio
  | IRetiroUtilidad
  | IDevolucion
  | IPaquetePerdido
  | ICompra
  | IOrdenCompra
  | ITomaOmar
  | IPedidoEnvio
  | IPedidoCancelar
  | ICompraRecepcion
  | ICompraEstado
  | ICompraAprobar
  | IGastoServicio
  | IMerma
  | IConteo
  | IClienteAlta
  | IClientePrecio
  | IActaPropuesta
  | IActaFirma
  | ILoteHistorico
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

/** Intenciones que escriben (todo lo demas es lectura o meta). Derivado del catalogo declarativo. */
export const INTENCIONES_ESCRITURA: readonly TipoIntencion[] = [
  'pedido', 'pago', 'pago_proveedor', 'gasto', 'aportacion', 'reembolso_socio', 'retiro_utilidad', 'devolucion', 'paquete_perdido', 'compra', 'orden_compra', 'toma_omar', 'deshacer',
  'pedido_envio', 'pedido_cancelar', 'compra_recepcion', 'compra_estado', 'compra_aprobar', 'gasto_servicio', 'merma', 'conteo', 'cliente_alta', 'cliente_precio', 'acta_propuesta', 'acta_firma', 'lote_historico',
];

/** Escrituras que mueven dinero o cuentas: se muestran en un resumen y exigen confirmacion explicita ANTES de registrarse. La toma de Omar ya exige la autorizacion de un socio; deshacer tiene su propio flujo. */
export function exigeConfirmacion(t: TipoIntencion): boolean {
  return esEscritura(t) && t !== 'toma_omar' && t !== 'deshacer';
}

export function esEscritura(t: TipoIntencion): boolean {
  return INTENCIONES_ESCRITURA.includes(t);
}
