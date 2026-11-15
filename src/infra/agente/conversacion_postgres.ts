// Adaptador de Postgres del estado de conversacion (rol `servidor`, funciones agente.conversacion_*). La base es la fuente de verdad: una conversacion viva por chat y autor,
// caducidad de 30 minutos, idempotencia por clave y auditoria en agente.conversacion_evento.
import type { AlmacenConversacion, BotonConv, ContextoConv, ConversacionVista, ResultadoAbrir } from '@/aplicacion/agente/conversacion';
import type { OperacionConv } from '@/dominio/agente/slots';
import type { Sql } from '@/infra/postgres/servidor';

type J = Record<string, unknown>;

function aVista(j: J): ConversacionVista {
  const p = j.pregunta as J | null;
  const r = j.reemplazo as J | null;
  return {
    id: Number(j.id), chatId: Number(j.chat_id), autor: String(j.autor), operacion: j.operacion as OperacionConv, estado: j.estado as ConversacionVista['estado'],
    slots: (j.slots as Record<string, unknown>) ?? {}, faltantes: (j.faltantes as string[]) ?? [], contexto: (j.contexto as ContextoConv) ?? {},
    pregunta: p ? { slot: (p.slot as string | null) ?? null, texto: (p.texto as string | null) ?? null, opciones: p.opciones ?? null, mensajeId: p.mensaje_id == null ? null : Number(p.mensaje_id) } : null,
    reemplazo: r ? { operacion: String(r.operacion), slots: (r.slots as Record<string, unknown>) ?? {}, contexto: (r.contexto as Record<string, unknown>) ?? {}, mensaje: (r.mensaje as string | null) ?? null } : null,
    expiraAt: new Date(String(j.expira_at)),
  };
}

const json = (v: unknown): string => JSON.stringify(v ?? null);

export class AlmacenConversacionDb implements AlmacenConversacion {
  constructor(private readonly sql: Sql) {}

  private async f(fn: string, marcas: string, args: readonly unknown[]): Promise<J | null> {
    const r = await this.sql<{ j: J | null }>(`select agente.${fn}(${marcas}) as j`, args);
    return r[0]?.j ?? null;
  }

  async obtener(chatId: number, autor: string): Promise<ConversacionVista | null> {
    const j = await this.f('conversacion_obtener', '$1, $2', [chatId, autor]);
    return j ? aVista(j) : null;
  }

  async abrir(a: Parameters<AlmacenConversacion['abrir']>[0]): Promise<ResultadoAbrir> {
    const j = (await this.f('conversacion_abrir', '$1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8', [a.clave, a.chatId, a.autor, a.operacion, json(a.slots), json(a.contexto), a.mensaje, a.mensajeId]))!;
    if (j.estado === 'conflicto') return { estado: 'conflicto', abierta: aVista(j.abierta as J) };
    return { estado: 'abierta', conversacion: aVista((j.conversacion as J) ?? j) };
  }

  async reemplazar(a: { clave: string; chatId: number; autor: string }): Promise<ConversacionVista> {
    const j = (await this.f('conversacion_reemplazar', '$1, $2, $3', [a.clave, a.chatId, a.autor]))!;
    return aVista(j.conversacion as J);
  }

  async completarSlot(a: Parameters<AlmacenConversacion['completarSlot']>[0]) {
    const j = (await this.f('conversacion_completar_slot', '$1, $2, $3, $4::jsonb, $5, $6, $7::jsonb', [a.clave, a.id, a.slot, a.valor === null || a.valor === undefined ? null : json(a.valor), a.mensaje ?? null, a.mensajeId ?? null, a.contexto ? json(a.contexto) : null]))!;
    return { estado: j.estado as ConversacionVista['estado'], conversacion: aVista(j.conversacion as J) };
  }

  async fijarPregunta(a: Parameters<AlmacenConversacion['fijarPregunta']>[0]): Promise<ConversacionVista> {
    const j = (await this.f('conversacion_fijar_pregunta', '$1, $2, $3, $4, $5::jsonb, $6::jsonb, $7', [a.clave, a.id, a.slot, a.texto, a.opciones ? json(a.opciones as readonly BotonConv[]) : null, json(a.contexto), a.mensajeId ?? null]))!;
    return aVista(j.conversacion as J);
  }

  async cancelar(a: { clave: string; id: number; motivo: string }): Promise<void> {
    await this.f('conversacion_cancelar', '$1, $2, $3', [a.clave, a.id, a.motivo]);
  }

  async registrada(a: { clave: string; id: number; folio: string }): Promise<void> {
    await this.f('conversacion_registrada', '$1, $2, $3', [a.clave, a.id, a.folio]);
  }

  /** Reloj: caduca las vencidas y reclama los recordatorios unicos. APAGADO por el interruptor agente_conversacion_reloj (responde estado 'apagado' sin hacer nada). */
  async expirar(ahora: Date): Promise<{ estado: 'apagado' | 'activo'; expiradas: J[]; recordatorios: J[] }> {
    const j = (await this.f('conversacion_expirar', '$1::timestamptz, 15', [ahora.toISOString()]))!;
    return { estado: j.estado as 'apagado' | 'activo', expiradas: (j.expiradas as J[]) ?? [], recordatorios: (j.recordatorios as J[]) ?? [] };
  }
}
