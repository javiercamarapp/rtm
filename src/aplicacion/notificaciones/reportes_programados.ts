// Tareas programadas de reporte: resumen diario (20:00) y pendientes (09:00). Leen las cifras de agente.rep_* (SQL), rinden la plantilla pura y emiten POR UNA SOLA PUERTA
// (notificacion.emitir_estado: interruptor de la regla, deduplicacion por clave estable, enfriamiento, techo diario unico y silencio). Nunca hablan con Telegram ni con clientes.
// UN SOLO DIGEST: si hay avisos de inventario en cola para esta hora (ventana M a las 09:00, R a las 20:00), sus lineas viajan dentro de este mismo mensaje.
import { fechaNeg } from '@/dominio/calendario';
import { textoPendientes, textoResumenDiario, type RepPendientes, type RepResumen } from '@/dominio/agente/reportes_programados';

export interface AvisosFusionados {
  texto: string;
  /** Marca los avisos como enviados (solo despues de que el reporte salio emitido). */
  confirmar(): Promise<void>;
}

export interface PuertoReportes {
  cifrasResumen(hoy: string): Promise<RepResumen>;
  cifrasPendientes(hoy: string): Promise<RepPendientes>;
  emitir(e: { regla: string; clave: string; severidad: 'C' | 'I' | 'F'; titulo: string; texto: string; ahora: Date }): Promise<{ estado: string }>;
  /** Lineas de inventario que esperan a este reporte (null si no hay o si la fusion no aplica). Opcional: sin el, el reporte sale solo. */
  avisosFusionados?(ventana: 'M' | 'R', ahora: Date): Promise<AvisosFusionados | null>;
}

export type ResultadoReporte = { estado: 'ok' | 'omitida'; detalle: string };

async function emitirReporte(puerto: PuertoReportes, ahora: Date, regla: string, clave: string, titulo: string, base: string, ventana: 'M' | 'R'): Promise<ResultadoReporte> {
  const extra = puerto.avisosFusionados ? await puerto.avisosFusionados(ventana, ahora) : null;
  const texto = extra ? `${base}\n\n${extra.texto}` : base;
  const r = await puerto.emitir({ regla, clave, severidad: 'F', titulo, texto, ahora });
  if (r.estado !== 'emitido') return { estado: 'omitida', detalle: r.estado };
  if (extra) await extra.confirmar();
  return { estado: 'ok', detalle: 'emitido' };
}

/** Resumen diario de las 20:00 (Merida). La clave es estable por fecha: repetir el latido o reintentar no duplica. */
export async function ejecutarResumenDiario(puerto: PuertoReportes, ahora: Date): Promise<ResultadoReporte> {
  const hoy = fechaNeg(ahora);
  return emitirReporte(puerto, ahora, 'resumen_diario', `resumen:${hoy}`, `Resumen del ${hoy}`, textoResumenDiario(await puerto.cifrasResumen(hoy)), 'R');
}

/** Pendientes de las 09:00 (Merida). */
export async function ejecutarPendientes(puerto: PuertoReportes, ahora: Date): Promise<ResultadoReporte> {
  const hoy = fechaNeg(ahora);
  return emitirReporte(puerto, ahora, 'pendientes_diarios', `pendientes:${hoy}`, `Pendientes del ${hoy}`, textoPendientes(await puerto.cifrasPendientes(hoy)), 'M');
}
