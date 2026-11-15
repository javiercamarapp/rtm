// Tareas programadas de reporte: resumen diario (20:00) y pendientes (09:00). Leen las cifras de agente.rep_* (SQL), rinden la plantilla pura y emiten POR UNA SOLA PUERTA
// (notificacion.emitir_programado: interruptor de la regla, deduplicacion por clave estable, enfriamiento, techo diario y silencio). Nunca hablan con Telegram ni con clientes.
import { fechaNeg } from '@/dominio/calendario';
import { textoPendientes, textoResumenDiario, type RepPendientes, type RepResumen } from '@/dominio/agente/reportes_programados';

export interface PuertoReportes {
  cifrasResumen(hoy: string): Promise<RepResumen>;
  cifrasPendientes(hoy: string): Promise<RepPendientes>;
  emitir(e: { regla: string; clave: string; severidad: 'C' | 'I' | 'F'; titulo: string; texto: string; ahora: Date }): Promise<{ estado: string }>;
}

export type ResultadoReporte = { estado: 'ok' | 'omitida'; detalle: string };

/** Resumen diario de las 20:00 (Merida). La clave es estable por fecha: repetir el latido o reintentar no duplica. */
export async function ejecutarResumenDiario(puerto: PuertoReportes, ahora: Date): Promise<ResultadoReporte> {
  const hoy = fechaNeg(ahora);
  const r = await puerto.emitir({ regla: 'resumen_diario', clave: `resumen:${hoy}`, severidad: 'F', titulo: `Resumen del ${hoy}`, texto: textoResumenDiario(await puerto.cifrasResumen(hoy)), ahora });
  return r.estado === 'emitido' ? { estado: 'ok', detalle: 'emitido' } : { estado: 'omitida', detalle: r.estado };
}

/** Pendientes de las 09:00 (Merida). */
export async function ejecutarPendientes(puerto: PuertoReportes, ahora: Date): Promise<ResultadoReporte> {
  const hoy = fechaNeg(ahora);
  const r = await puerto.emitir({ regla: 'pendientes_diarios', clave: `pendientes:${hoy}`, severidad: 'F', titulo: `Pendientes del ${hoy}`, texto: textoPendientes(await puerto.cifrasPendientes(hoy)), ahora });
  return r.estado === 'emitido' ? { estado: 'ok', detalle: 'emitido' } : { estado: 'omitida', detalle: r.estado };
}
