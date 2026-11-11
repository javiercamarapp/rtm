// Formas de lo que Omar ve de su propia bodega. Lista blanca: ningun tipo de este archivo tiene costo, margen, utilidad, precio de venta,
// cliente, proveedor, socio ni folio de pedido. Los importes son centavos (bigint) y vienen ya calculados por la base.
export type Cent = bigint;

/** Una fila de omar.v_mercancia: lo que hay fisicamente en su bodega, por modelo y sabor. */
export interface PiezaDisponible {
  modelo: string;
  sabor: string;
  piezas: number;
}

/** Una fila de omar.v_mi_cuenta. `importe` con signo: renta y pagos de los socios a Omar suman; sus tomas y lo que Omar paga restan. */
export interface MovimientoCuenta {
  concepto: 'renta' | 'toma' | 'pago';
  fecha: string;
  /** Referencia de la fila. La renta nunca lleva el folio del pedido: se reasigna un consecutivo propio al leerla. */
  referencia: string;
  modelo: string | null;
  piezas: number | null;
  tarifa: Cent | null;
  importe: Cent;
}

export type EstadoSolicitud = 'pendiente' | 'autorizada' | 'rechazada' | 'caducada' | 'deshecha';

export interface Solicitud {
  folio: string;
  modelo: string;
  sabor: string;
  piezas: number;
  estado: EstadoSolicitud;
  solicitada_at: string;
  caduca_at: string;
  resuelta_at: string | null;
}

export interface LiquidacionOmar {
  folio: string;
  semana_ini: string;
  semana_fin: string;
  renta_cent: Cent;
  tomas_cent: Cent;
  compensado_cent: Cent;
  /** > 0 los socios le deben; < 0 Omar debe. */
  neto_cent: Cent;
  /** Lo pagado contra esta liquidacion, con signo (a Omar suma, de Omar resta). */
  pagado_cent: Cent;
  fecha_cierre: string;
}

export type TipoPaquete = 'salida' | 'entrada';
export type EstadoPaquete = 'por_empacar' | 'empacado' | 'en_trayecto' | 'llego';

/** Paquete que debe preparar (salida) o recibir (entrada). Sin cliente, sin proveedor, sin folio de pedido ni de compra. */
export interface PaqueteOmar {
  consecutivo: number;
  tipo: TipoPaquete;
  estado: EstadoPaquete;
  /** Horas que lleva pendiente (solo salida). */
  horas: number | null;
  /** Fecha estimada de llegada (solo entrada). */
  llegada_estimada: string | null;
  renglones: { modelo: string; sabor: string; piezas: number }[];
}

export interface ConfiguracionOmar {
  tope_toma_piezas: number;
  caduca_horas: number;
  renta_por_pieza_cent: Cent | null;
}

export interface LineaSolicitud {
  modelo: string;
  sabor: string;
  piezas: number;
}

export type MotivoRechazo = 'tope' | 'cantidad' | 'sin_existencia' | 'sin_disponible' | 'pieza_desconocida' | 'desactivado' | 'sin_cola' | 'clave';

export type ResultadoSolicitud =
  | { ok: true; folio: string; estado: 'pendiente'; caduca_at: string; repetido: boolean }
  | { ok: false; motivo: MotivoRechazo; mensaje: string };

/** Lo que una lectura puede entregar: o el dato, o la palabra de por que no hay (la base aun no tiene la funcion, o fallo). */
export type Lectura<T> = { estado: 'ok'; datos: T } | { estado: 'pendiente_sql' } | { estado: 'error' };

/** Llaves que jamas deben aparecer en nada que se le entregue a Omar (respuesta de la base ni props de la interfaz). */
export const LLAVES_PROHIBIDAS = /costo|margen|utilidad|ganancia|precio_venta|precio_cent|cliente|proveedor|socio|duenio|dueno|isaac|karen|angelo|javier|vapemate|reserva|reservado|pedido/i;
