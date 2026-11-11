// Formas de lo que devuelven las funciones api.* de F2. Todo `*_cent` es bigint (centavos). Fechas "AAAA-MM-DD" (America/Merida) e instantes ISO.
export type Cent = bigint;
export type EstadoPedido = 'borrador' | 'confirmado' | 'enviado' | 'cancelado' | 'anulado';
export type Origen = 'bodega_omar' | 'karen_directo' | 'karen_via_isaac' | 'isaac_directo' | 'castores';
export type EstadoCompra = 'borrador' | 'confirmada' | 'enviada' | 'en_trayecto' | 'llego_merida' | 'recibida' | 'cerrada' | 'anulada';

export interface PedidoResumen {
  id: number; folio: string; fecha_neg: string; cliente_id: number; cliente: string; duenio: 'Angelo' | 'Javier'; origen: Origen; estado: EstadoPedido;
  piezas_pedidas: number; piezas_surtidas: number; cobrado_cent: Cent; saldo_cent: Cent | null; utilidad_cent: Cent | null; utilidad_provisional: boolean | null;
  avisos: number; empacado: boolean; plazo_dias: number | null;
}

export interface LineaPedido {
  id: number; sku_id: number; modelo: string; sabor: string; piezas_pedidas: number; piezas_surtidas: number; precio_cent: Cent; precio_tabulador_cent: Cent | null;
  motivo_precio: string | null; costo_unit_cent: Cent | null; renta_cent: Cent; disponible: number; existencia: number;
}
export interface AvisoPedido { id: number; codigo: string; nt: string | null; detalle: string; decidido_por: string | null; decidido_at: string | null }
export interface EventoInfo { evento: string; canal: string; hora: string; mensaje_origen: string | null; autor: string | null; tipo?: string }

export interface NotaClienteSnap {
  folio: string; fecha: string | null; cliente: string; entrega: string;
  grupos: { modelo: string; piezas: number; subtotal_cent: Cent; sabores: { sabor: string; piezas: number; precio_cent: Cent; total_cent: Cent }[] }[];
  lineas_texto: { modelo: string; piezas: number; precio_cent: Cent; total_cent: Cent }[];
  piezas_total: number; subtotal_cent: Cent; envio_cent: Cent; recargo_cent: Cent; descuento_cent: Cent; total_cent: Cent;
}
export interface NotaInternaSnap {
  folio: string; cliente: string; duenio: string; origen: Origen;
  lineas: { linea_id: number; modelo: string; sabor: string; piezas: number; precio_cent: Cent; venta_cent: Cent; costo_cent: Cent; costo_unit_cent: Cent; utilidad_cent: Cent }[];
  por_modelo: { modelo: string; piezas: number; venta_cent: Cent; costo_cent: Cent; utilidad_cent: Cent }[];
  cascada: { venta_cent: Cent; envio_cent: Cent; recargo_cent: Cent; descuento_cent: Cent; total_cent: Cent; costo_cent: Cent; renta_cent: Cent; guia_cent: Cent | null; guia_pendiente: boolean; utilidad_cent: Cent; utilidad_provisional: boolean };
  comprobaciones: { c1: { renglones_cent: Cent; modelos_cent: Cent; cuadra: boolean }; c2: { pedidas: number; salidas: number; en_nota: number; cobradas: number; pendientes: number; cuadra: boolean } };
}
export interface NotaPedido {
  id: number; folio_documento: string; tipo: 'original' | 'correccion'; motivo_correccion: string | null; total_cent: Cent; emitida_at: string; corregida_por: string | null; vigente: boolean;
  texto_whatsapp: string; cliente: NotaClienteSnap; interno: NotaInternaSnap; pdf_cliente: boolean; pdf_interna: boolean;
}

export interface PedidoDetalle {
  id: number; folio: string; fecha_neg: string; origen: Origen; estado: EstadoPedido; plazo_dias: number | null; paqueteria: string | null; nota: string | null;
  envio_cent: Cent; descuento_cent: Cent; recargo_cent: Cent; empacado_at: string | null; enviado_at: string | null; fecha_envio: string | null; entregado_at: string | null;
  cliente: { id: number; nombre: string; duenio: string };
  cobrado_cent: Cent; aplicado_cent: Cent; saldo_cent: Cent | null; estimado_cent: Cent; saldo_favor_cliente_cent: Cent;
  lineas: LineaPedido[]; cargos: { concepto: string; monto_cent: Cent }[]; ajustes: { tipo: string; piezas: number; sabor: string; modelo: string }[];
  avisos: AvisoPedido[]; guias: { id: number; paqueteria: string; numero: string; costo_cent: Cent | null; fecha_neg: string }[];
  notas: NotaPedido[]; pagos: { folio: string; fecha_neg: string; cuenta: string; monto_cent: Cent }[]; linea_tiempo: EventoInfo[];
}

export interface SkuPedido { sku_id: number; modelo_id: number; marca: string; modelo: string; sabor: string; estado: string; existencia: number; disponible: number; precio_cent: Cent | null; costo_ref_cent: Cent | null }
export interface CatalogoPedido { envio_default_cent: Cent; minimo_piezas: number; destinos: { id: number; etiqueta: string; zona: string }[]; skus: SkuPedido[] }

export interface PaquetesPorHacer {
  pedidos: { id: number; folio: string; cliente: string; duenio: string; origen: Origen; paqueteria: string | null; envio_cent: Cent; empacado: boolean; estado_paquete: 'por_empacar' | 'empacado'; horas: number; piezas: number;
             renglones: { linea_id: number; sku_id: number; modelo: string; sabor: string; piezas: number; disponible: number; existencia: number }[] }[];
  surtido: { sku_id: number; modelo: string; sabor: string; piezas: number; existencia: number; falta: number }[];
  enviados_recientes: { id: number; folio: string; cliente: string; fecha_envio: string; entregado: boolean; guias: { paqueteria: string; numero: string; costo_cent: Cent | null }[] | null }[];
}
export interface PaqueteEnTransito {
  id: number; folio: string; proveedor: string; estado: EstadoCompra; fecha_neg: string; enviada_fecha: string | null; llegada_estimada: string | null; dias_en_camino: number | null; total_cent: Cent; piezas_pedidas: number;
  guias: { paqueteria: string; numero: string }[]; renglones: { linea_id: number; modelo: string; sabor: string; pagadas: number; facturadas: number; costo_unit_cent: Cent }[];
}

export interface CompraResumen { id: number; folio: string; proveedor: string; fecha_neg: string; estado: EstadoCompra; total_cent: Cent; ambito: string; pagadas: number; facturadas: number; recibidas: number | null; diferencias_abiertas: number }
export interface CompraDetalle {
  id: number; folio: string; estado: EstadoCompra; fecha_neg: string; destino: string; ambito: string; mercancia_cent: Cent; guia_cent: Cent; seguro_cent: Cent; total_cent: Cent;
  llegada_estimada: string | null; enviada_fecha: string | null; recibida_fecha: string | null; nota: string | null;
  proveedor: { id: number; nombre: 'Isaac' | 'Karen'; modalidad: 'semanal_viernes' | 'prepago_total' }; saldo_proveedor_cent: Cent;
  lineas: { id: number; sku_id: number; modelo: string; sabor: string; pagadas: number; facturadas: number; recibidas: number | null; costo_unit_cent: Cent; costo_lista_cent: Cent | null; motivo_costo: string | null;
            lote: { costo_puesto_cent: Cent; valor_entrada_cent: Cent; guia_cent: Cent; seguro_cent: Cent } | null }[];
  recepciones: { sabor: string; modelo: string; piezas: number; contado_at: string }[];
  guias: { id: number; paqueteria: string; numero: string; fecha_neg: string }[];
  diferencias: { id: number; tipo: 'faltante' | 'sobrante'; piezas: number; valor_cent: Cent; modelo: string; responsable: string | null; responsable_tipo: 'sociedad' | 'socio' | 'proveedor' }[];
  partidas_fuera_sociedad: { socio: string; monto_cent: Cent; piezas: number | null; estado: string }[];
  linea_tiempo: EventoInfo[];
}
export interface CuentaProveedor {
  id: number; proveedor: 'Isaac' | 'Karen'; modalidad: 'semanal_viernes' | 'prepago_total'; saldo_cent: Cent; etiqueta: 'A favor' | 'Se debe' | 'Saldo cero'; puente_cent: Cent;
  movimientos: (EventoInfo & { id: number; fecha_neg: string; concepto: string; monto_cent: Cent; saldo_corrido_cent: Cent; compra: string | null; pago: string | null; cliente: string | null; cuenta_origen: string | null; nota: string | null })[];
}
export interface CatalogoCompra { modalidad: 'semanal_viernes' | 'prepago_total'; saldo_cent: Cent; seguro_reenvio_cent: Cent; skus: { sku_id: number; modelo: string; marca: string; sabor: string; costo_cent: Cent | null }[] }

export interface FilaCxc {
  pedido_id: number; folio: string; cliente_id: number; cliente: string; duenio: 'Angelo' | 'Javier'; fecha_envio: string; plazo_dias: number | null; vence: string | null;
  original_cent: Cent; abonos_cent: Cent; saldo_cent: Cent; dias: number; dias_atraso: number | null; estado: 'al_corriente' | 'por_vencer' | 'vencido' | 'sin_plazo' | 'saldo_a_favor'; cubeta: '0_7' | '8_14' | '15_30' | 'mas_30';
}
export interface CuentasPorCobrar {
  hoy: string; filas: FilaCxc[]; total_cent: Cent; vencido_cent: Cent; antiguedad_cent: Record<'0_7' | '8_14' | '15_30' | 'mas_30', Cent>; por_duenio_cent: Record<string, Cent>;
  saldos_a_favor: { cliente_id: number; cliente: string; duenio: string; monto_cent: Cent }[];
  pagos_sin_identificar: { id: number; folio: string; fecha_neg: string; monto_cent: Cent; cuenta: string }[];
  socios: { socio: 'Angelo' | 'Javier'; deuda_cent: Cent; fondos_cent: Cent; diferencia_cent: Cent }[];
}
export interface CxcCliente {
  cliente: { id: number; nombre: string; duenio: string }; saldo_cent: Cent; saldo_favor_cent: Cent;
  pedidos: { id: number; folio: string; estado: string; fecha_envio: string; cobrado_cent: Cent; saldo_cent: Cent; notas: string[] | null }[];
  pagos: (EventoInfo & { id: number; folio: string; fecha_neg: string; monto_cent: Cent; cuenta: string; disponible_cent: Cent; anulado: boolean })[];
}
export interface ContextoPagos { cuentas: { nombre: string; titular_tipo: string }[]; clientes: { id: number; nombre: string; duenio: string; saldo_cent: Cent }[] }
export interface EstadoSocio {
  socio: string; deuda_cent: Cent; fondos_cent: Cent; diferencia_cent: Cent; aportaciones_cent: Cent; reembolsable_cent: Cent;
  movimientos: { id: number; fecha_neg: string; concepto: string; aplica_a: string; monto_cent: Cent; saldo_corrido_cent: Cent; nota: string | null }[];
}
export interface AvisoSistema {
  id: number; nt: string; codigo: string; severidad: 'C' | 'I' | 'F'; titulo: string; entidad_tipo: string | null; entidad_id: number | null; payload: Record<string, unknown>;
  duenio: string | null; actor: string | null; estado: string; conteo: number; creado_at: string; canales_previstos: string[]; leido: boolean;
}
export interface ListaAvisos { sin_leer: number; avisos: AvisoSistema[] }

export interface NotaFuente {
  id: number; pedido_id: number; folio_documento: string; tipo: 'original' | 'correccion'; emitida_at: string; motivo_correccion: string | null; corrige: string | null;
  cliente: NotaClienteSnap; interno: NotaInternaSnap; marca_texto: string | null; datos_pago_texto: string | null;
}
export interface DocumentoGuardado { sha256: string; base64: string; creado_at: string }

/** Respuesta uniforme de las acciones de escritura de la web. */
export type ResultadoAccion<T = Record<string, unknown>> = { ok: true; datos: T } | { ok: false; mensaje: string; codigo: string | null };
