// Parametros de la lectura del inventario de proveedores. Un solo lugar; ninguno es un importe.

/** Tope duro de peticiones al sitio por dia (adenda 24). No aumentar sin autorizacion expresa del dueno. */
export const TOPE_PETICIONES_DIA = 40;

/** Desglose del tope (la suma es el tope): JSON horario, confirmaciones, HTML de promociones, colecciones. */
export const TOPE_POR_TIPO = {
  catalogo: 24,
  confirmacion: 6,
  inicio: 8,
  coleccion: 2,
} as const;

/** Lecturas de seguridad que no consumen el desglose: una sola vez por semana. */
export const TOPE_ROBOTS_DIA = 1;

/** Pausa minima entre dos peticiones consecutivas. */
export const PAUSA_ENTRE_PETICIONES_MS = 3_000;

/** Cuanto se espera para la lectura de confirmacion de un cambio candidato. */
export const MINUTOS_CONFIRMACION = 10;

/** Avisos de dato viejo: mas de 3 horas sin lectura valida bloquea la lista para clientes. */
export const HORAS_DATO_VIEJO = 3;

/** Fallos seguidos que abren un incidente de fuente. */
export const FALLOS_PARA_INCIDENTE = 3;

/** Un recordatorio del incidente a las 6 horas. */
export const HORAS_RECORDATORIO_INCIDENTE = 6;

/** Promociones. */
export const HORAS_CONFIRMACION_PROMOCION = 1;
export const LECTURAS_AUSENTE_TERMINA = 2;
export const HORAS_FIN_VENCIDO = 1;
export const HORAS_POR_TERMINAR = 24;
export const DIAS_CONSERVAR_TERMINADAS = 30;

/** Claves de lectura recordadas para la idempotencia. */
export const LECTURAS_RECORDADAS = 200;
