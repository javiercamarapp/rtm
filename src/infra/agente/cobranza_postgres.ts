// Adaptador de Postgres del modulo de cobranza (rol `servidor`, funciones agente.cobranza_* y cobranza.* de las migraciones 20261116700000 y 20261116700100).
// Cada puerta verifica en SQL que el telegram_user_id sea el del socio indicado y que el interruptor de escritura este encendido; aqui solo se transporta. Ningun calculo de dinero ni de fechas en TypeScript.
import { RechazoCobranza, type EsperaCobranza, type PuertoCobranza, type RespCobranza } from '@/aplicacion/agente/cobranza';
import type { PuertoRelojCobranza } from '@/aplicacion/agente/cobranza_reloj';
import type { AccionCobranza } from '@/dominio/agente/cobranza';
import type { Miembro } from '@/dominio/agente/tipos';
import type { Sql } from '@/infra/postgres/servidor';

/** Errores de negocio de la base con un mensaje pensado para el socio (identidad, solo lectura, ventana de 10 minutos, validacion). */
const CODIGOS_RECHAZO: ReadonlySet<string> = new Set(['P0460', 'P0463', 'P0464', '42501', '22023', 'P0409']);

async function llamar<T>(sql: Sql, texto: string, params: readonly unknown[]): Promise<T | null> {
  try {
    const r = await sql<{ j: T | null }>(texto, params);
    return r[0]?.j ?? null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code !== undefined && CODIGOS_RECHAZO.has(err.code)) throw new RechazoCobranza((err.message ?? 'La base rechazo la operacion.').replace(/^error: /i, ''), err.code);
    throw e;
  }
}

const quien = (a: Miembro): Record<string, unknown> => ({ autor: a.persona, telegram_user_id: a.telegramUserId });

export class PuertoCobranzaDb implements PuertoCobranza {
  constructor(private readonly sql: Sql) {}

  async responder(clave: string, autor: Miembro, args: Record<string, unknown>): Promise<RespCobranza> {
    return (await llamar<RespCobranza>(this.sql, 'select agente.cobranza_responder($1, $2::jsonb) as j', [clave, JSON.stringify({ ...args, ...quien(autor) })])) ?? {};
  }

  async deshacer(clave: string, autor: Miembro, folio: string): Promise<RespCobranza> {
    return (await llamar<RespCobranza>(this.sql, 'select agente.cobranza_deshacer($1, $2, $3, $4::bigint) as j', [clave, folio, autor.persona, autor.telegramUserId])) ?? {};
  }

  async esperaVigente(chatId: number): Promise<EsperaCobranza | null> {
    const r = await llamar<{ cliente_id: number; accion: AccionCobranza; falta: string; datos: Record<string, unknown> }>(this.sql, 'select agente.cobranza_espera_vigente($1::bigint) as j', [chatId]);
    return r === null ? null : { clienteId: String(r.cliente_id), accion: r.accion, falta: r.falta, datos: r.datos ?? {} };
  }

  async esperaGuardar(chatId: number, autor: Miembro, e: EsperaCobranza): Promise<void> {
    await this.sql('select agente.cobranza_espera_guardar($1::bigint, $2::bigint, $3, $4, $5::jsonb, $6)::text as j', [chatId, Number(e.clienteId), e.accion, e.falta, JSON.stringify(e.datos), autor.persona]);
  }

  async esperaCerrar(chatId: number): Promise<void> {
    await this.sql('select agente.cobranza_espera_cerrar($1::bigint)::text as j', [chatId]);
  }
}

/** Reloj de la cobranza contra Postgres (cobranza.reloj_tick y cobranza.registrar_envio). El envio lo hace TypeScript; la base solo reclama y registra. */
export class PuertoRelojCobranzaDb implements PuertoRelojCobranza {
  constructor(private readonly sql: Sql, private readonly args: Record<string, unknown> = {}) {}

  async tick(tipo: 'am' | 'cierre') {
    const r = await this.sql<{ j: { estado: string; digest_id?: number; texto?: string } }>('select cobranza.reloj_tick($1, $2::jsonb) as j', [tipo, JSON.stringify(this.args)]);
    return r[0]!.j;
  }
  async registrarEnvio(digestId: number, ok: boolean, messageId: number | null, error: string | null) {
    await this.sql('select cobranza.registrar_envio($1::bigint, $2::boolean, $3::bigint, $4) as j', [digestId, ok, messageId, error]);
  }
  async chats() {
    const r = await this.sql<{ j: { grupoSocios: number | null; privadoOmar: number | null } }>('select agente.chats() as j');
    return { grupoSocios: r[0]?.j.grupoSocios ?? 0, privadoOmar: r[0]?.j.privadoOmar ?? 0 };
  }
}
