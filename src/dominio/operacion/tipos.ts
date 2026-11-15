// Formas de lo que devuelven las funciones api.* de F2. Todo `*_cent` es bigint (centavos). Fechas "AAAA-MM-DD" (America/Merida) e instantes ISO.
export type Cent = bigint;
export type EstadoPedido = 'borrador' | 'confirmado' | 'enviado' | 'cancelado' | 'anulado';
export type Origen = 'bodega_omar' | 'karen_directo' | 'karen_via_isaac' | 'isaac_directo' | 'castores';
export type EstadoCompra = 'borrador' | 'confirmada' | 'enviada' | 'en_trayecto' | 'llego_merida' | 'recibida_parcial' | 'recibida' | 'cerrada' | 'anulada';

export interface PedidoResumen {
  id: number; folio: string; fecha_neg: string; cliente_id: number; cliente: string; duenio: 'Angelo' | 'Javier'; origen: Origen; estado: EstadoPedido; tipo_venta?: 'cliente' | 'socio_a_costo' | null;
  piezas_pedidas: number; piezas_surtidas: number; cobrado_cent: Cent; saldo_cent: Cent | null; utilidad_cent: Cent | null; utilidad_provisional: boolean | null;
  avisos: number; empacado: boolean; plazo_dias: number | null;
}

/** Una fila de api.pedidos_desglose(): cifras ya calculadas en la base (la interfaz solo da formato). Niveles: total, surtido, proveedor (bodega_omar, castores, karen, isaac) y tipo (cliente, socio_a_costo; solo dropshipping). */
export interface DesglosePedidos {
  nivel: 'total' | 'surtido' | 'proveedor' | 'tipo'; surtido: 'dropshipping' | 'inventario_merida' | null; clave: string;
  pedidos: number; enviados: number; piezas: number; facturado_cent: Cent; por_cobrar_cent: Cent; utilidad_cent: Cent | null; utilidad_provisional: boolean; con_avisos: number;
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
            lote: { costo_puesto_cent: Cent; valor_entrada_cent: Cent; guia_cent: Cent; seguro_cent: Cent; llegadas?: number } | null }[];
  recepciones: { sabor: string; modelo: string; piezas: number; contado_at: string }[];
  guias: { id: number; paqueteria: string; numero: string; fecha_neg: string }[];
  diferencias: { id: number; tipo: 'faltante' | 'sobrante'; piezas: number; valor_cent: Cent; modelo: string; responsable: string | null; responsable_tipo: 'sociedad' | 'socio' | 'proveedor' }[];
  partidas_fuera_sociedad: { socio: string; monto_cent: Cent; piezas: number | null; estado: string }[];
  linea_tiempo: EventoInfo[];
}
export interface PosicionDetalle { posicion_cent: Cent; se_debe_cent: Cent; a_favor_cent: Cent; cargos_cent: Cent; abonos_cent: Cent; desglose_cuadra: boolean; auxiliar_cent: Cent | null; cuadra_auxiliar: boolean | null;
  /** Pedidos a costo del socio de menudeo ya enviados con este proveedor: a su cuenta, NO son deuda de la empresa (el libro si los suma). */
  menudeo_pedidos: number; menudeo_costo_cent: Cent; menudeo_pagado_cent: Cent; menudeo_pendiente_cent: Cent; menudeo_vencido_cent: Cent;
  /** Posicion de la empresa = libro + pedidos del socio pendientes. Positivo = a favor, negativo = se le debe. */
  posicion_empresa_cent: Cent; deuda_empresa_cent: Cent; a_favor_empresa_cent: Cent }
export interface CuentaProveedor {
  id: number; proveedor: 'Isaac' | 'Karen'; modalidad: 'semanal_viernes' | 'prepago_total'; saldo_cent: Cent; etiqueta: 'A favor' | 'Se debe' | 'Saldo cero'; puente_cent: Cent;
  /** Posicion completa con el proveedor segun el Mayor (cuenta 2110 o 2120): incluye el costo de los pedidos directos enviados. Positivo = a favor de la sociedad, negativo = se debe. */
  posicion_cent: Cent;
  /** Detalle de la posicion (misma fuente): cargos = costo de pedidos y compras; abonos = pagos, abonos y ajustes; auxiliar = cuenta corriente menos pedidos directos. */
  posicion: PosicionDetalle;
  movimientos: (EventoInfo & { id: number; fecha_neg: string; concepto: string; monto_cent: Cent; saldo_corrido_cent: Cent; compra: string | null; pago: string | null; cliente: string | null; cuenta_origen: string | null; nota: string | null })[];
}
export interface CatalogoCompra { modalidad: 'semanal_viernes' | 'prepago_total'; saldo_cent: Cent; seguro_reenvio_cent: Cent; skus: { sku_id: number; modelo: string; marca: string; sabor: string; costo_cent: Cent | null }[] }

export interface FilaCxc {
  pedido_id: number; folio: string; cliente_id: number; cliente: string; duenio: 'Angelo' | 'Javier'; fecha_envio: string; plazo_dias: number | null; vence: string | null;
  original_cent: Cent; abonos_cent: Cent; saldo_cent: Cent; dias: number; dias_atraso: number | null; estado: 'al_corriente' | 'por_vencer' | 'vencido' | 'sin_plazo' | 'saldo_a_favor'; cubeta: '0_7' | '8_14' | '15_30' | 'mas_30';
  recargo_cent: Cent; recargo_sugerido_cent: Cent;
}
/** Cuenta por cobrar cargada en la apertura: una fila por partida con la fecha del adeudo; los cobros se asignan a la mas antigua primero. */
export interface FilaCxcApertura { partida_id: number; cliente_id: number; cliente: string; duenio: 'Angelo' | 'Javier'; fecha_ref: string; original_cent: Cent; abonos_cent: Cent; saldo_cent: Cent; dias: number }
export interface CuentasPorCobrar {
  hoy: string; filas: FilaCxc[]; apertura: FilaCxcApertura[]; total_cent: Cent; vencido_cent: Cent; antiguedad_cent: Record<'0_7' | '8_14' | '15_30' | 'mas_30', Cent>;
  saldos_a_favor: { cliente_id: number; cliente: string; duenio: string; monto_cent: Cent }[];
  pagos_sin_identificar: { id: number; folio: string; fecha_neg: string; monto_cent: Cent; cuenta: string }[];
  socios: { socio: 'Angelo' | 'Javier'; deuda_cent: Cent; fondos_cent: Cent; diferencia_cent: Cent; dias_fondos: number | null; alerta_fondos: boolean }[];
  recargo_bp: number;
  por_cliente: { cliente_id: number; cliente: string; duenio: 'Angelo' | 'Javier'; saldo_cent: Cent; vencido_cent: Cent; pedidos: number; dias_max: number; proximo_vence: string | null }[];
}
export interface CxcCliente {
  cliente: { id: number; nombre: string; duenio: string }; saldo_cent: Cent; saldo_favor_cent: Cent;
  apertura: { partida_id: number; fecha_ref: string; original_cent: Cent; abonos_cent: Cent; saldo_cent: Cent }[];
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// F3a: proveedores (hoja y liquidacion), cuenta de socios y cascada de reparto, cuenta con Omar y cuentas por cobrar completa.
export type AmbitoHoja = 'sociedad' | 'todo';
export interface HojaRenglon {
  tipo: 'pedido' | 'oc'; id: number; folio: string; fecha: string; cliente: string | null; duenio: 'Angelo' | 'Javier' | null; es_de_sociedad: boolean; origen: string; piezas: number;
  mercancia_cent: Cent; seguro_cent: Cent; guia_cent: Cent; guia_pendiente: boolean; costo_cent: Cent; detalle_cent: Cent; cuadra: boolean;
  detalle: { modelo: string; piezas: number; costo_cent: Cent; costo_unit_cent: Cent }[];
}
export interface HojaAbono extends EventoInfo { id: number; fecha_neg: string; concepto: string; monto_cent: Cent; cliente: string | null; pedido: string | null; cuenta_origen: string | null; nota: string | null; deshecho: boolean }
export interface HojaAjuste extends EventoInfo { id: number; fecha_neg: string; concepto: string; monto_cent: Cent; nota: string | null; deshecho: boolean }
export interface HojaProveedor {
  proveedor: 'Isaac' | 'Karen'; modalidad: 'semanal_viernes' | 'prepago_total'; ambito: AmbitoHoja; semana_ini: string; semana_fin: string; desde: string; viernes_cerrado: boolean;
  renglones: HojaRenglon[]; abonos: HojaAbono[]; ajustes: HojaAjuste[]; pagos_por_concepto_cent: Record<string, Cent>;
  totales: { saldo_anterior_cent: Cent; mercancia_cent: Cent; seguros_cent: Cent; guias_cent: Cent; costo_total_cent: Cent; pagos_cent: Cent; ajustes_cent: Cent; falta_por_saldar_cent: Cent; libro_al_corte_cent: Cent; diferencia_libro_cent: Cent;
    /** Pedidos del socio de menudeo pendientes de pago con este proveedor (a su cuenta) y deuda de la empresa = falta por saldar menos eso; menudeo_vigente: la semana es la actual. */
    menudeo_pendiente_cent: Cent; deuda_empresa_cent: Cent; menudeo_vigente: boolean };
  comprobaciones: {
    renglon_igual_detalle: boolean; renglones_igual_mercancia: boolean; mercancia_independiente_cent: Cent; renglones_igual_seguros: boolean; seguros_independiente_cent: Cent;
    guias_igual_envios: boolean; guias_independiente_cent: Cent; abonos_igual_depositos: boolean; depositos_independiente_cent: Cent; cuadra: boolean;
    /** Comparacion contra el saldo del libro al corte de la hoja (solo ambito 'sociedad'). */
    libro_aplica: boolean; libro_igual_hoja: boolean;
  };
  guias_pendientes: number;
  conciliacion: { dicho_cent: Cent; nuestro_cent: Cent; diferencia_cent: Cent; nota: string | null; renglones: { folio: string; dice_cent: Cent | null; nuestro_cent: Cent | null; diferencia_cent: Cent; en_nuestra_hoja: boolean }[] } | null;
  cierre: { folio: string; fecha_cierre: string; falta_por_saldar_cent: Cent; dicho_cent: Cent | null; diferencia_cent: Cent | null } | null;
}
export interface LiquidacionProveedor {
  id: number; folio: string; semana_ini: string; semana_fin: string; ambito: AmbitoHoja; saldo_anterior_cent: Cent; mercancia_cent: Cent; seguros_cent: Cent; guias_cent: Cent; pagos_cent: Cent;
  ajustes_cent: Cent; falta_por_saldar_cent: Cent; dicho_cent: Cent | null; diferencia_cent: Cent | null; fecha_cierre: string; nota: string | null;
}

export interface SocioResumen {
  socio: 'Angelo' | 'Javier'; neto_cent: Cent; aportado_cent: Cent; capital_pendiente_cent: Cent; reembolso_pendiente_cent: Cent; fondos_cent: Cent; debe_cent: Cent; dias_fondos: number | null; alerta_fondos: boolean;
}
export interface MovimientoSocios extends EventoInfo {
  orden: number; tipo: 'aportacion' | 'libro'; id: number; socio: string; fecha_neg: string; concepto: string; monto_cent: Cent; clasificacion: string; deshecho: boolean; deshacible: boolean;
}
export interface ParteSocio { aportado_cent: Cent; directo_cent: Cent; puso_capital_cent: Cent; puso_reembolsable_cent: Cent; fuera_sociedad_cent: Cent; debe_cent: Cent; diferencia_cent: Cent }
/** Una verificacion del libro conciliado: dos lados independientes y si coinciden. `unidad` 'n' = conteo (no dinero). */
export interface VerificacionCuadre {
  id: string; grupo: 'auxiliares' | 'partida_doble' | 'comprobaciones' | 'efectivo_repartido'; nombre: string; a_nombre: string; a_cent: Cent; b_nombre: string; b_cent: Cent; ok: boolean;
  unidad?: 'n' | 'mxn' | 'pz'; detalle?: string | null;
}
/** Salud de la cuenta de socios: identidades del libro (docs/cuadre-socios-definicion.md). No depende de cuanto puso cada socio para la compra. */
export interface CuadreSocios {
  libro_conciliado: boolean; fallas: number; estado: 'conciliado' | 'pendiente_proveedor' | 'revisar'; etiqueta: string; pendiente_proveedor_cent: Cent; verificaciones: VerificacionCuadre[];
}
export interface CuentaSocios {
  hoy: string; costo_cent: Cent; mitad_cent: Cent; angelo: ParteSocio; javier: ParteSocio; javier_debe_a_angelo_cent: Cent; via1_cent: Cent; via2_cent: Cent; via2_resto_cent: Cent;
  financiado_por_sociedad_cent: Cent;
  /** Desglose del costo: dinero propio de los socios + caja de la sociedad + fondos de la sociedad en poder de un socio + pendiente con proveedores + otros. */
  directo_socios_cent: Cent; pagado_por_sociedad_cent: Cent; pagado_con_fondos_cent: Cent; pendiente_proveedor_cent: Cent; otros_cent: Cent;
  /** Informativo: las dos vias de la diferencia por la compra coinciden. NO es la salud del libro (esa es `cuadre`). */
  cuadra: boolean; cuadre: CuadreSocios; partidas_fuera_sociedad: { socio: string; monto_cent: Cent; concepto: string; estado: string; piezas: number | null }[];
  socios: SocioResumen[]; movimientos: MovimientoSocios[];
}
export interface MovimientoEstadoSocio extends EventoInfo { tipo: 'aportacion' | 'libro' | 'deuda' | 'apertura'; id: number; fecha_neg: string; concepto: string; efecto_cent: Cent; saldo_cent: Cent; deshacible: boolean }
export interface EstadoCuentaSocio {
  socio: 'Angelo' | 'Javier'; neto_cent: Cent; aportaciones_capital_cent: Cent; gastos_pagados_cent: Cent; reembolsos_recibidos_cent: Cent; devoluciones_recibidas_cent: Cent; retiros_cent: Cent;
  utilidad_asignada_cent: Cent; fondos_cent: Cent; faltantes_cent: Cent; debe_cent: Cent; reembolso_pendiente_cent: Cent; aportacion_pendiente_cent: Cent; dias_fondos: number | null;
  movimientos: MovimientoEstadoSocio[];
}
export interface ResultadoSocioCascada {
  reembolso_pendiente_cent: Cent; aportacion_pendiente_cent: Cent; paga_reembolso_cent: Cent; utilidad_cent: Cent; anticipo_cent: Cent; asignado_cent: Cent;
  tiene_en_poder_cent: Cent; debe_cent: Cent; resultado_cent: Cent; sigue_pendiente_cent: Cent;
}
export interface Cascada {
  periodo_ini: string; periodo_fin: string; utilidad_cent: Cent; perdida_cent: Cent; utilidad_provisional: boolean;
  utilidad_detalle: { utilidad_pedidos_cent: Cent; pedidos: number; utilidad_tomas_cent: Cent; gastos_cent: Cent; provisional: boolean; utilidad_cent: Cent };
  arrastre_ini_cent: Cent; arrastre_fin_cent: Cent; utilidad_acumulada_cent: Cent;
  efectivo: { en_poder_cent: Cent; caja_cent: Cent; total_cent: Cent; comprometido_cent: Cent; disponible_cent: Cent };
  reembolsos: { pendiente_cent: Cent; pagado_cent: Cent }; aportaciones: { pendiente_cent: Cent; pagado_cent: Cent };
  repartible_cent: Cent; remanente_cent: Cent; limitado_por_efectivo: boolean;
  por_socio: Record<'Angelo' | 'Javier', ResultadoSocioCascada>; suma_asignada_cent: Cent; suma_resultados_cent: Cent; identidad_cuadra: boolean;
  identidad: { via1_cent: Cent; via2_cent: Cent; efectivo_repartido_cent: Cent; deuda_no_efectivo_cent: Cent; cuadra: boolean };
  liquidar: { de: 'Angelo' | 'Javier'; a: 'Angelo' | 'Javier'; monto_cent: Cent } | null;
}
export interface CascadaProyeccion extends Cascada { hoy: string; en_vivo: boolean }
export interface CierreReparto {
  id: number; folio: string; tipo: 'periodo' | 'contra'; corrige_a: number | null; corregida: boolean; periodo_ini: string; periodo_fin: string; utilidad_cent: Cent; utilidad_provisional: boolean; efectivo_caja_cent: Cent; nota: string | null; snapshot: Cascada;
  decisiones: Record<string, { retira: Cent; reinvierte: Cent }>; arrastre_ini_cent: Cent; arrastre_fin_cent: Cent;
  creado_at: string; propuesto_por: string | null; firmas: { socio: string; firmado_at: string }[]; estado: 'propuesto' | 'firmado_por_uno' | 'cerrado' | 'anulado'; yo_firme: boolean;
}

export interface OmarFila { id: number; fecha: string; modelo: string; piezas: number }
export interface OmarCuenta {
  semana_ini: string; semana_fin: string; hoy: string; persona: string; estado: 'abierta' | 'cerrada'; liquidacion: string | null; palabra: 'Le debemos' | 'Omar debe' | 'Saldo cero';
  renta_cent: Cent; tomas_cent: Cent; compensado_cent: Cent; neto_cent: Cent; pagos_semana_cent: Cent; tomas_pendientes: number; tomas_sin_precio: number; renta_por_pieza_cent: Cent;
  puede_cerrar: boolean; semana_anterior_sin_cerrar: string | null; saldo_cuenta_cent: Cent;
  renta: { id: number; folio: string; fecha: string; modelo: string; piezas: number; monto_cent: Cent; tarifa_cent: Cent | null; reversa: boolean; sabores: string | null }[];
  tomas: { id: number; folio: string; fecha: string; modelo: string; sabor: string; piezas: number; precio_cent: Cent | null; subtotal_cent: Cent | null; estado: string; via: string; falta_precio: boolean }[];
  pendientes: { id: number; folio: string; fecha: string; modelo: string; sabor: string; piezas: number; precio_cent: Cent | null; solicitada_at: string; caduca_at: string; falta_precio: boolean }[];
  pagos: { id: number; folio: string; fecha: string; monto_cent: Cent; sentido: 'a_omar' | 'de_omar'; via: string; socio: string | null }[];
  liquidaciones: { folio: string; semana_ini: string; semana_fin: string; renta_cent: Cent; tomas_cent: Cent; compensado_cent: Cent; neto_cent: Cent; palabra: string; fecha_cierre: string }[];
  skus: { sku_id: number; marca: string; modelo: string; sabor: string; existencia: number; precio_cent: Cent | null }[];
}

/** Umbrales de las paginas de paquetes (config): horas sin empacar o enviar, y dias de gracia sobre el plazo del proveedor. */
export interface UmbralesPaquetes { horas_sin_empacar: number; trayecto_dias_extra: number; plazo_dias: Record<string, number> }

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Paquete perdido o danado (carril paquete-perdido). Salida = pedido ya enviado; entrada = orden de compra en camino.
export type ResponsablePaquete = 'sociedad' | 'socio' | 'proveedor' | 'cliente' | 'mixto';
export interface IncidentePaquete {
  id: number; folio: string; sentido: 'salida' | 'entrada'; tipo: 'perdido' | 'danado'; estado: 'abierto' | 'resuelto'; detalle: string; fecha_neg: string; reportado_at: string; horas: number;
  pedido_id: number | null; pedido_folio: string | null; compra_id: number | null; compra_folio: string | null; cliente: string | null; proveedor: string | null;
  piezas: number; valor_cent: Cent; renglones: { modelo: string; sabor: string; piezas: number; valor_cent: Cent }[];
  resolucion: {
    responsable: ResponsablePaquete; socio: string | null; accion: 'reponer' | 'bonificar' | 'castigar' | 'asignar' | 'reclamar' | 'mixta' | 'ninguna'; absorbe_sociedad_cent: Cent; recuperable_cent: Cent;
    bonificacion_cent: Cent; ajuste_utilidad_cent: Cent; motivo: string; fecha_neg: string; guia: { paqueteria: string; numero: string; costo_cent: Cent | null } | null;
  } | null;
  /** Entrada: responsable vigente leido de la asignacion de la diferencia (puede reasignarse desde la compra). */
  responsable_vigente: 'sociedad' | 'socio' | 'proveedor' | 'mixto' | null;
  guias: { paqueteria: string; numero: string }[];
}
export interface PaquetesIncidentes { incidentes: IncidentePaquete[] }
export interface SalidaLineaIncidente { linea_id: number; sku_id: number; modelo: string; sabor: string; surtidas: number; reportadas: number }
/** Recepcion de una compra por llegadas: lo facturado, lo contado y lo pendiente por renglon, y cada llegada con el valor que entro al inventario. */
export interface RecepcionCompra {
  compra_id: number; folio: string; estado: EstadoCompra;
  lineas: { linea_id: number; sku_id: number; modelo: string; sabor: string; facturadas: number; recibidas: number; pendientes: number; puesto_cent: Cent; entrada_cent: Cent }[];
  llegadas: { n: number; contado_at: string; piezas: number; valor_cent: Cent }[];
}

export interface DevolucionClienteResumen { id: number; folio: string; fecha_neg: string; pedido_id: number; pedido: string; cliente: string; piezas: number; monto_cent: Cent; costo_cent: Cent; liberado_cent: Cent; motivo: string; anulada: boolean }
export interface DevolucionProveedorResumen { id: number; folio: string; fecha_neg: string; proveedor: string; compra: string | null; piezas: number; valor_cent: Cent; motivo: string; anulada: boolean }
export interface DevolucionesLista { clientes: DevolucionClienteResumen[]; proveedores: DevolucionProveedorResumen[]; credito_clientes_cent: Cent; credito_proveedores_cent: Cent }

/** Lo que se puede devolver de un pedido, por renglon y sabor, y las devoluciones ya hechas. */
export interface PedidoDevoluciones {
  pedido_id: number; folio: string; puede: boolean; motivo_no: string | null; devuelto_cent: Cent;
  /** Cifras del pedido netas de devoluciones vigentes (calculadas en la base); null si el pedido no tiene hoja interna. */
  cascada_neta: { total_cent: Cent; costo_cent: Cent; costo_regresado_cent: Cent; merma_cent: Cent; utilidad_cent: Cent } | null;
  renglones: { linea_id: number; sku_id: number; modelo: string; sabor: string; surtidas: number; devueltas: number; disponibles_devolver: number; precio_cent: Cent }[];
  devoluciones: { id: number; folio: string; fecha_neg: string; piezas: number; monto_cent: Cent; liberado_cent: Cent; motivo: string; anulada: boolean; pdf: boolean }[];
}
export interface CatalogoDevolucionProveedor {
  skus: { sku_id: number; marca: string; modelo: string; sabor: string; disponible: number; costo_prom_cent: Cent }[];
  compras: { id: number; folio: string; proveedor: string; estado: EstadoCompra }[];
}
/** Lo que se imprime en la nota de credito (cliente) o en la devolucion al proveedor. */
export interface FuenteDevolucion {
  tipo: 'cliente' | 'proveedor'; id: number; folio: string; emitida_at: string; texto: string;
  snapshot: {
    folio: string; fecha: string; cliente?: string; proveedor?: string; pedido?: string; nota?: string; compra?: string | null; motivo: string; piezas_total: number;
    lineas: { modelo: string; sabor: string; piezas: number; precio_cent?: Cent; total_cent?: Cent; valor_cent?: Cent; destino?: 'inventario' | 'merma' }[];
    total_cent?: Cent; total_nota_cent?: Cent; liberado_cent?: Cent; valor_cent?: Cent; saldo_antes_cent: Cent; saldo_despues_cent: Cent;
  };
}
