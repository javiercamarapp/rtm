// Puerto de los reportes programados sobre las funciones SQL agente.rep_* y notificacion.emitir_programado (rol servidor).
import type { PuertoReportes } from '@/aplicacion/notificaciones/reportes_programados';
import type { RepPendientes, RepResumen } from '@/dominio/agente/reportes_programados';
import type { Sql } from '@/infra/postgres/servidor';

export class PuertoReportesDb implements PuertoReportes {
  constructor(private readonly sql: Sql) {}
  async cifrasResumen(hoy: string): Promise<RepResumen> {
    return (await this.sql<{ j: RepResumen }>('select agente.rep_telegram($1::date) as j', [hoy]))[0]!.j;
  }
  async cifrasPendientes(hoy: string): Promise<RepPendientes> {
    return (await this.sql<{ j: RepPendientes }>('select agente.rep_pendientes($1::date) as j', [hoy]))[0]!.j;
  }
  async emitir(e: { regla: string; clave: string; severidad: 'C' | 'I' | 'F'; titulo: string; texto: string; ahora: Date }): Promise<{ estado: string }> {
    const r = await this.sql<{ j: { estado: string } }>(
      'select notificacion.emitir_programado($1::text, $2::text, $3::text, $4::text, $5::text, null::text, null::bigint, $6::jsonb, $7::timestamptz) as j',
      [e.regla, e.clave, e.severidad, e.titulo, e.texto, JSON.stringify({}), e.ahora.toISOString()],
    );
    return r[0]!.j;
  }
}
