// El latido: una sola entrada de reloj. Cada pasada ejecuta el trabajo propio del latido (despachar, reintentar, caducar) y las tareas cuya ventana cayo desde la ultima pasada.
// Cada (tarea, ventana) se reclama una sola vez en la base: dos latidos para la misma ventana ejecutan UNA corrida. La fecha de decision es siempre la de Merida.
import { ventanasDebidas } from '@/dominio/tareas';

export interface DefTarea {
  readonly tarea: string;
  readonly expresionUtc: string;
  readonly implementada: boolean;
}

export interface PuertoTareas {
  reclamar(tarea: string, ventana: string): Promise<boolean>;
  terminar(tarea: string, ventana: string, estado: 'ok' | 'error' | 'omitida', error?: string): Promise<void>;
}

export type ResultadoManejador = { estado: 'ok' | 'omitida'; detalle?: string };
export type Manejador = (ventana: string) => Promise<ResultadoManejador>;

export interface EntradaLatido {
  tareas: readonly DefTarea[];
  puerto: PuertoTareas;
  manejadores: Readonly<Record<string, Manejador>>;
  /** Trabajo propio del latido (despacho de avisos, caducidades). Corre siempre, sin reclamar ventana. */
  propio: () => Promise<void>;
  ahora: Date;
  /** Minutos hacia atras que se revisan (las ventanas son idempotentes, asi que un latido tardio no pierde tareas). */
  retrocesoMin?: number;
}

export interface ResumenLatido {
  ejecutadas: string[];
  omitidas: string[];
  fallidas: string[];
  yaReclamadas: number;
}

export async function correrLatido(e: EntradaLatido): Promise<ResumenLatido> {
  const resumen: ResumenLatido = { ejecutadas: [], omitidas: [], fallidas: [], yaReclamadas: 0 };
  await e.propio();
  const desde = new Date(e.ahora.getTime() - (e.retrocesoMin ?? 10) * 60_000);
  for (const t of e.tareas) {
    if (t.tarea === 'latido') continue;
    for (const ventana of ventanasDebidas(t.expresionUtc, desde, e.ahora)) {
      if (!(await e.puerto.reclamar(t.tarea, ventana))) {
        resumen.yaReclamadas += 1;
        continue;
      }
      const m = e.manejadores[t.tarea];
      if (!t.implementada || !m) {
        await e.puerto.terminar(t.tarea, ventana, 'omitida', 'todavia no implementada');
        resumen.omitidas.push(`${t.tarea}@${ventana}`);
        continue;
      }
      try {
        const r = await m(ventana);
        await e.puerto.terminar(t.tarea, ventana, r.estado, r.detalle);
        (r.estado === 'ok' ? resumen.ejecutadas : resumen.omitidas).push(`${t.tarea}@${ventana}`);
      } catch (err) {
        // Solo el nombre del error: ningun contenido de datos ni de mensajes.
        await e.puerto.terminar(t.tarea, ventana, 'error', err instanceof Error ? err.name : 'error');
        resumen.fallidas.push(`${t.tarea}@${ventana}`);
      }
    }
  }
  return resumen;
}
