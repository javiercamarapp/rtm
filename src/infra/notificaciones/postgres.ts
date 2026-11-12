// Repositorio de entregas y de tareas sobre las funciones `notificacion.*` (rol servidor).
import type { LoteEntrega, RepositorioEntregas, ResultadoEnvio } from '@/aplicacion/notificaciones/despachador';
import type { PuertoTareas } from '@/aplicacion/tareas/latido';
import type { DefTarea } from '@/aplicacion/tareas/latido';
import type { Sql } from '@/infra/postgres/servidor';

export class RepositorioEntregasDb implements RepositorioEntregas {
  constructor(private readonly sql: Sql) {}

  async reclamar(limite: number): Promise<LoteEntrega[]> {
    const r = await this.sql<{ j: LoteEntrega[] }>('select notificacion.reclamar_entregas($1::int) as j', [limite]);
    return r[0]?.j ?? [];
  }

  async registrar(entregaId: number, r: ResultadoEnvio): Promise<string> {
    const p = {
      resultado: r.resultado,
      http: null as number | null,
      retry: r.resultado === '429' ? r.retryAfter : null,
      codigo: 'codigo' in r ? (r.codigo ?? null) : null,
      mensaje: r.resultado === 'ok' ? (r.mensajeId ?? null) : null,
      incierto: (r.resultado === '5xx' || r.resultado === 'red') && r.incierto === true,
      migrar: r.resultado === '400_migrar' ? r.migrarA : null,
    };
    const x = await this.sql<{ e: string }>('select notificacion.registrar_resultado($1::bigint, $2::text, $3::int, $4::int, $5::text, $6::text, $7::boolean, $8::bigint) as e', [entregaId, p.resultado, p.http, p.retry, p.codigo, p.mensaje, p.incierto, p.migrar]);
    return x[0]!.e;
  }
}

export class PuertoTareasDb implements PuertoTareas {
  constructor(private readonly sql: Sql) {}
  async sembrar(tareas: readonly (DefTarea & { expresionLocal: string; descripcion: string })[]): Promise<void> {
    await this.sql('select notificacion.sembrar_programacion($1::jsonb)', [JSON.stringify(tareas.map((t) => ({ tarea: t.tarea, expresionLocal: t.expresionLocal, expresionUtc: t.expresionUtc, descripcion: t.descripcion })))]);
  }
  async reclamar(tarea: string, ventana: string): Promise<boolean> {
    const r = await this.sql<{ ok: boolean }>('select notificacion.reclamar_ejecucion($1::text, $2::text) as ok', [tarea, ventana]);
    return r[0]!.ok;
  }
  async terminar(tarea: string, ventana: string, estado: 'ok' | 'error' | 'omitida', error?: string): Promise<void> {
    await this.sql('select notificacion.terminar_ejecucion($1::text, $2::text, $3::text, $4::text)', [tarea, ventana, estado, error ?? null]);
  }
}
