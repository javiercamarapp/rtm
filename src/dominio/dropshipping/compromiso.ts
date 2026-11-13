// Fecha comprometida de pago y recordatorios de los pedidos a costo (espejo de operacion.ds_vence_en y operacion.ds_recordatorios_pago_menudeo; la base manda). Sin I/O.
export interface ConfigRecordatorios { avisoPrevioHoras: number; intervaloHoras: number; maxRecordatorios: number }
export const CONFIG_POR_OMISION: ConfigRecordatorios = { avisoPrevioHoras: 24, intervaloHoras: 24, maxRecordatorios: 7 };
export type TipoRecordatorio = 'sin_fecha' | 'por_vencer' | 'vence_hoy' | 'vencido';

const HORA = 3_600_000;
/** Mérida es UTC-6 todo el año (sin horario de verano desde 2022). */
const OFFSET_MERIDA_H = 6;

/** Momento en que vence el compromiso: la fecha con su hora (o el final del día) en hora de Mérida. null si no hay fecha. */
export function venceEn(fecha: string | null, hora: string | null): Date | null {
  if (!fecha) return null;
  const [h = '23', m = '59', s = '00'] = hora ? hora.split(':') : ['23', '59', '59'];
  return new Date(Date.parse(`${fecha}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}Z`) + OFFSET_MERIDA_H * HORA);
}

/** Fecha (AAAA-MM-DD) de hoy en Mérida para un instante dado. */
export function fechaMerida(ahora: Date): string {
  return new Date(ahora.getTime() - OFFSET_MERIDA_H * HORA).toISOString().slice(0, 10);
}

/** Días de atraso: 0 si no venció o está pagado. Cuenta días de calendario entre la fecha comprometida y hoy (Mérida). */
export function diasDeAtraso(fechaCompromiso: string | null, hora: string | null, ahora: Date, pendiente: boolean): number {
  const v = venceEn(fechaCompromiso, hora);
  if (!pendiente || !v || v.getTime() >= ahora.getTime()) return 0;
  return Math.max(Math.round((Date.parse(`${fechaMerida(ahora)}T00:00:00Z`) - Date.parse(`${fechaCompromiso}T00:00:00Z`)) / (24 * HORA)), 0);
}

export function estaVencido(fechaCompromiso: string | null, hora: string | null, ahora: Date, pendiente: boolean): boolean {
  const v = venceEn(fechaCompromiso, hora);
  return pendiente && v !== null && v.getTime() < ahora.getTime();
}

export interface EntradaRecordatorio { fecha: string | null; hora: string | null; enviados: number; ultimo: Date | null; avisadoPorVencer: boolean; avisadoHoy: boolean }

/** Qué recordatorio toca ahora (null = ninguno). sin_fecha es una alerta que no consume recordatorios. */
export function tipoRecordatorio(e: EntradaRecordatorio, ahora: Date, cfg: ConfigRecordatorios = CONFIG_POR_OMISION): TipoRecordatorio | null {
  const v = venceEn(e.fecha, e.hora);
  if (!v) return 'sin_fecha';
  if (v.getTime() > ahora.getTime()) return v.getTime() <= ahora.getTime() + cfg.avisoPrevioHoras * HORA && !e.avisadoPorVencer ? 'por_vencer' : null;
  if (e.fecha === fechaMerida(ahora)) return e.avisadoHoy ? null : 'vence_hoy';
  if (e.enviados >= cfg.maxRecordatorios) return null;
  if (e.ultimo && e.ultimo.getTime() + cfg.intervaloHoras * HORA > ahora.getTime()) return null;
  return 'vencido';
}
