// Insumos del paquete de cifras: lo que la base (via puertos) entrega al motor. Todo dinero en centavos bigint;
// piezas enteras. El motor no lee la base ni el reloj: recibe esto y devuelve un paquete inmutable.
import type { ResultadoComprobacion } from './tipos';

export interface LineaPedido {
  readonly modelo: string;
  readonly sabor?: string;
  readonly piezas: number;
  /** Precio de venta por pieza (centavos). */
  readonly precioCent: bigint;
  /** Costo promedio por pieza (centavos). */
  readonly costoCent: bigint;
  /** Precio del tabulador vigente del cliente (centavos por pieza), si existe. */
  readonly precioTabuladorCent?: bigint;
  /** El socio autorizo la diferencia con el tabulador. */
  readonly conExcepcion?: boolean;
}

export interface PedidoInsumo {
  readonly folio: string;
  readonly fecha: string;
  readonly clienteId: string;
  readonly cliente: string;
  readonly origen: 'bodega' | 'directo';
  readonly lineas: readonly LineaPedido[];
  readonly cobradoCent: bigint;
  /** Guia de salida del pedido. */
  readonly guiaCent: bigint;
  /** Mensajeros y otros gastos variables atribuibles al pedido. */
  readonly mensajeroCent: bigint;
  /** Avisos de la nota (bajo piso, sin excepcion, etc.). */
  readonly avisos?: readonly string[];
  /** Control de piezas (C2): salieron del kardex, cobradas en la nota y autorizadas sin cobro. */
  readonly control?: { readonly salieron: number; readonly cobradas: number; readonly autorizadas: number };
}

export interface SemanaHistoria {
  readonly inicio: string;
  readonly ventasCent: bigint;
  readonly piezas: number;
  readonly contribCent: bigint;
  readonly cobradoCent: bigint;
}

export interface PedidoHistoria {
  readonly fecha: string;
  readonly piezas: number;
  readonly ventasCent: bigint;
  readonly contribCent: bigint;
  readonly sabores?: Readonly<Record<string, number>>;
}

export interface HistoriaCliente {
  readonly clienteId: string;
  readonly cliente: string;
  /** Pedidos de las ultimas 13 semanas, del mas antiguo al mas reciente. */
  readonly pedidos: readonly PedidoHistoria[];
  /** Ritmo dicho por un socio ("Declarado, no observado"), con el rango dado al capturarlo. */
  readonly declarado?: { readonly ventasSemanaCent: bigint; readonly rangoPct: number };
}

export interface SaborInventario {
  readonly sabor: string;
  readonly existencia: number;
  /** Piezas vendidas en 28 dias. */
  readonly vendidas28: number;
  readonly diasAgotado: number;
}

export interface ModeloInventario {
  readonly modelo: string;
  readonly existencia: number;
  readonly enTransito: number;
  readonly costoPromCent: bigint;
  /** Piezas vendidas por semana, de la mas antigua a la mas reciente (sin huecos). */
  readonly ventasSemanales: readonly number[];
  readonly contribPorPiezaCent: bigint;
  readonly diasSinVenta: number;
  readonly proveedor: 'Isaac' | 'Karen';
  readonly costoReposicionCent: bigint;
  /** Dias de entrega: observados (reposiciones) o declarado. */
  readonly leadTime: { readonly dias: number; readonly reposiciones: number; readonly declarado: boolean };
  readonly piezasPorCaja: number;
  readonly sabores: readonly SaborInventario[];
  /** Cambio de costo registrado del proveedor (causa afirmable de una caida de margen). */
  readonly cambioCosto?: { readonly anteriorCent: bigint; readonly nuevoCent: bigint; readonly clientesAlMismoPrecio: number };
  readonly contribMedianaPorPiezaCent?: bigint;
  /** Cuadrante Revisar (rotacion alta, margen bajo la mediana): semanas seguidas y rotacion contra la mediana (milesimas). */
  readonly revisar?: { readonly semanasSeguidas: number; readonly rotacionMilesimas: bigint };
}

export interface PartidaCartera {
  readonly clienteId: string;
  readonly cliente: string;
  readonly saldoCent: bigint;
  /** Dias del saldo mas antiguo. */
  readonly dias: number;
  readonly ticketMedianoCent: bigint;
  readonly pagosMasLentos: boolean;
  readonly pedidosHistoria: number;
}

export interface LiquidacionProveedor {
  readonly proveedor: 'Isaac' | 'Karen';
  readonly mercanciaCent: bigint;
  readonly guiasCent: bigint;
  readonly pagadoCent: bigint;
  /** Lo que dice la hoja del proveedor (via 2), si existe. */
  readonly segunProveedorCent?: bigint;
  readonly fondosDisponiblesCent: bigint;
  readonly cobrosEsperadosHastaViernesCent: bigint;
}

export interface GastoInsumo {
  readonly concepto: string;
  readonly categoria: 'variable' | 'fijo';
  readonly plataforma: boolean;
  readonly montoCent: bigint;
  readonly pagadoPor: 'Angelo' | 'Javier' | 'Sociedad';
}

export interface ConteoInsumo {
  readonly lineasTotal: number;
  readonly lineasCuadran: number;
  readonly piezasPuente: number;
  readonly valorPuenteCent: bigint;
}

export interface SociosInsumo {
  /** Posicion entre socios: positiva = Javier debe a Angelo. */
  readonly diferenciaCent: bigint;
  readonly diferenciaAnteriorCent: bigint;
  readonly omarNetoCent: bigint;
  readonly omarRentaCent: bigint;
  readonly omarTomasCent: bigint;
  readonly omarPagosCent: bigint;
  readonly omarTomaPendienteHoras: number;
}

export interface ComparacionProveedor {
  readonly modelo: string;
  readonly costoIsaacCent: bigint;
  readonly costoKarenCent: bigint;
  readonly pedidosCaroSinCausa: number;
  readonly piezasCaroSinCausa: number;
  readonly guiaPorPiezaCent: bigint;
}

export interface FlujoInsumo {
  readonly saldoInicialCent: bigint;
  /** Cobros semanales reales de las ultimas semanas (mas antigua primero). */
  readonly cobrosSemanalesCent: readonly bigint[];
  /** Cobros prometidos con fecha, por semana futura (indices 0..3). */
  readonly cobrosPrometidosCent: readonly bigint[];
  readonly pagosProveedorCent: readonly bigint[];
  readonly omarCent: readonly bigint[];
  readonly gastosCent: readonly bigint[];
  /** Cadencia declarada de cobros por semana con rango +-pct, si no hay 8 semanas. */
  readonly cadenciaDeclaradaCent?: { readonly semanaCent: bigint; readonly rangoPct: number };
}

export interface InsumosSemanal {
  readonly inicio: string;
  readonly fin: string;
  /** Corte del reporte (ISO UTC) y fecha de aprobacion del periodo, si existe. */
  readonly corteIso: string;
  readonly aprobadoEn?: string;
  readonly enCurso: boolean;
  readonly datosIncompletos: readonly string[];
  readonly semanaIso: number;
  readonly anio: number;
  readonly pedidos: readonly PedidoInsumo[];
  readonly pedidosSemanaAnterior: readonly PedidoInsumo[];
  /** Semanas previas, de la mas antigua a la mas reciente (la anterior es la ultima). */
  readonly historia: readonly SemanaHistoria[];
  readonly clientes: readonly HistoriaCliente[];
  readonly inventario: readonly ModeloInventario[];
  readonly cartera: readonly PartidaCartera[];
  readonly liquidacion?: LiquidacionProveedor;
  readonly gastos: readonly GastoInsumo[];
  readonly conteo?: ConteoInsumo;
  readonly socios?: SociosInsumo;
  readonly comparacionProveedores: readonly ComparacionProveedor[];
  readonly flujo?: FlujoInsumo;
  /** Comprobaciones C1..C22 evaluadas por contabilidad (via puerto). */
  readonly comprobaciones: readonly ResultadoComprobacion[];
  /** Tope mensual de plataforma (IA) en centavos y gasto del mes en centavos. */
  readonly plataforma?: { readonly topeCent: bigint; readonly gastoCent: bigint };
  /** Gasto por pieza mediano (centavos) de las ultimas 13 semanas, para I24. */
  readonly gastoVariablePorPiezaMedianaCent?: bigint;
}

/** Cierre mensual: el estado de resultados y sus lineas vienen de contabilidad (cada renglon con dos vias). */
export interface RenglonResultados {
  readonly id: string;
  readonly etiqueta: string;
  readonly cuenta: string;
  readonly montoCent: bigint;
  readonly mesAnteriorCent: bigint;
  readonly medianaTresMesesCent: bigint;
  /** Subtotal (con borde grueso en la cascada). */
  readonly subtotal: boolean;
  /** Signo con que entra a la cascada: +1 suma, -1 resta. */
  readonly signo: 1 | -1;
}

export interface CostosSistemaInsumo {
  readonly cargoSociedadCent: bigint;
  readonly comoSeriaCent: bigint;
  readonly comoDeberiaSerCent: bigint;
  readonly bolsilloJavierCent: bigint;
  readonly reembolsadoCent: bigint;
  readonly pendienteCent: bigint;
}

export interface InsumosMensual extends InsumosSemanal {
  readonly mes: string;
  readonly mesAnterior: readonly PedidoInsumo[];
  readonly resultados: readonly RenglonResultados[];
  readonly utilidadNetaCent: bigint;
  readonly costosSistema?: CostosSistemaInsumo;
  /** Ventas por mes de los ultimos 24 meses, del mas antiguo al mas reciente (centavos), para estacionalidad. */
  readonly ventasMensualesCent: readonly bigint[];
  /** Mapa de calor cliente x sabor (piezas) del mes. */
  readonly clienteSabor: readonly { readonly cliente: string; readonly sabor: string; readonly piezas: number }[];
  /** Posicion semanal (rank por semana) de los clientes para el bump chart. */
  readonly rankSemanalClientes: readonly { readonly cliente: string; readonly rank: readonly number[] }[];
  /** Dias de pago por cliente y DSO. */
  readonly dsoDias: number;
  /** Cartera mayor a 30 dias en las ultimas 13 semanas (centesimas de punto). */
  readonly tendenciaCarteraBp: readonly bigint[];
}
