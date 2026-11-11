import type {
  AmbitoHoja, CascadaProyeccion, CierreReparto, CuentaSocios, EstadoCuentaSocio, HojaProveedor, LiquidacionProveedor, OmarCuenta,
  CatalogoCompra, CatalogoPedido, CompraDetalle, CompraResumen, ContextoPagos, CuentaProveedor, CuentasPorCobrar, CxcCliente, DocumentoGuardado, EstadoSocio, ListaAvisos,
  NotaFuente, PaqueteEnTransito, PaquetesPorHacer, PedidoDetalle, PedidoResumen,
} from '@/dominio/operacion/tipos';

/** Lo que la web lee de pedidos, compras, pagos, paquetes y avisos. Cada lectura es una funcion de la base; la interfaz no calcula dinero. */
export interface LectorOperacion {
  pedidos(): Promise<PedidoResumen[]>;
  pedido(id: number): Promise<PedidoDetalle | null>;
  catalogoPedido(clienteId: number): Promise<CatalogoPedido>;
  notaFuente(notaId: number): Promise<NotaFuente | null>;
  documento(notaId: number, variante: 'cliente_pdf' | 'interna_pdf'): Promise<DocumentoGuardado | null>;
  porHacer(): Promise<PaquetesPorHacer>;
  enTransito(): Promise<PaqueteEnTransito[]>;
  compras(proveedor?: string): Promise<CompraResumen[]>;
  compra(id: number): Promise<CompraDetalle | null>;
  cuentaProveedor(proveedor: string): Promise<CuentaProveedor>;
  catalogoCompra(proveedor: string): Promise<CatalogoCompra>;
  cuentasPorCobrar(): Promise<CuentasPorCobrar>;
  cxcCliente(clienteId: number): Promise<CxcCliente>;
  contextoPagos(): Promise<ContextoPagos>;
  estadoSocio(socio: string): Promise<EstadoSocio>;
  avisos(estado?: string | null): Promise<ListaAvisos>;
  // F3a
  hojaProveedor(proveedor: string, semanaIni: string | null, ambito: AmbitoHoja): Promise<HojaProveedor>;
  notaProveedor(proveedor: string, semanaIni: string | null, ambito: AmbitoHoja): Promise<{ texto: string }>;
  liquidacionesProveedor(proveedor: string): Promise<LiquidacionProveedor[]>;
  cuentaSocios(): Promise<CuentaSocios>;
  socioCuenta(socio: string): Promise<EstadoCuentaSocio>;
  cascadaProyeccion(ini: string | null, fin: string | null): Promise<CascadaProyeccion>;
  cierresReparto(): Promise<CierreReparto[]>;
  omarCuenta(semanaIni: string | null): Promise<OmarCuenta>;
  textoCobro(clienteId: number): Promise<{ texto: string | null; total_cent: bigint; cliente: string; vencidos?: number }>;
}

/** Acciones de escritura permitidas desde la web (lista cerrada). Cada una es una funcion SQL atomica e idempotente: la clave de idempotencia viaja como `p_clave_idem`. */
export const ACCIONES_OPERACION = [
  'crear_compra', 'confirmar_compra', 'marcar_compra_enviada', 'registrar_guia_compra', 'marcar_llego_merida', 'recibir_compra', 'asignar_diferencia', 'cerrar_compra', 'anular_compra',
  'crear_pedido', 'confirmar_pedido', 'cancelar_pedido', 'marcar_empacado', 'enviar_pedido', 'anular_pedido', 'emitir_correccion', 'acordar_plazo', 'marcar_entregado', 'fijar_costo_guia',
  'registrar_pago', 'aplicar_pago', 'identificar_pago', 'anular_pago', 'pago_proveedor_de_socio', 'registrar_entrega_socio',
  'registrar_toma_omar', 'resolver_toma_omar', 'cerrar_liquidacion_omar', 'registrar_pago_omar', 'aviso_marcar_leido',
  // F3a
  'registrar_aportacion', 'registrar_gasto_socio', 'registrar_pago_a_socio', 'registrar_liquidacion_entre_socios', 'anular_movimiento_socio', 'proponer_cierre_reparto', 'firmar_cierre_reparto', 'anular_cierre_reparto',
  'contra_acta_reparto', 'proponer_retiro_capital', 'confirmar_retiro_capital', 'registrar_movimiento_efectivo', 'registrar_gasto_empresa',
  'registrar_ajuste_proveedor', 'registrar_pago_proveedor_sociedad', 'anular_movimiento_proveedor', 'fijar_ambito_pedido', 'registrar_dicho_proveedor', 'cerrar_liquidacion_proveedor', 'registrar_recargo_credito',
] as const;
export type AccionOperacion = (typeof ACCIONES_OPERACION)[number];

export interface EscritorOperacion {
  ejecutar(accion: AccionOperacion, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  guardarDocumento(notaId: number, variante: 'cliente_pdf' | 'interna_pdf', sha256: string, bytes: Uint8Array): Promise<void>;
}

export interface GeneradorPdf {
  notaCliente(n: NotaFuente): Promise<Uint8Array>;
  hojaInterna(n: NotaFuente): Promise<Uint8Array>;
  huella(bytes: Uint8Array): string;
}
