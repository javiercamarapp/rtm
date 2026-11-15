// Puerto de los reportes programados sobre las funciones SQL agente.rep_* y la interfaz UNICA de emision notificacion.emitir_estado (rol servidor).
import type { AvisosFusionados, PuertoReportes } from '@/aplicacion/notificaciones/reportes_programados';
import { PuertoAvisosInventarioDb } from '@/infra/agente/avisos_inventario_postgres';
import { redactarMensaje } from '@/dominio/agente/avisos_inventario';
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
      'select notificacion.emitir_estado($1::text, $2::text, $3::jsonb, null::text, $4::timestamptz) as j',
      [e.regla, e.clave, JSON.stringify({ texto: e.texto, titulo: e.titulo, severidad: e.severidad }), e.ahora.toISOString()],
    );
    return r[0]!.j;
  }
  async avisosFusionados(ventana: 'M' | 'R', ahora: Date): Promise<AvisosFusionados | null> {
    const inv = new PuertoAvisosInventarioDb(this.sql);
    const d = await inv.armar(ventana, ahora, true);
    if (d.estado !== 'ok') return null;
    const texto = redactarMensaje(ventana, d.items, d.restantes);
    if (texto === null) return null;
    return { texto, confirmar: async () => { await inv.confirmar(ventana, d.items.map((i) => i.id), ahora, true); } };
  }
}
