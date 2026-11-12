// Cliente de la Bot API de Telegram detras del puerto EnviadorTelegram. `fetch` entra por parametro: en esta ola nada llama a la red.
// El token nunca se escribe en errores, logs ni mensajes (la URL lo lleva y por eso no se propaga).
import type { BotonEnLinea, EnviadorTelegram, MensajeSalida } from '@/aplicacion/agente/puertos';

export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class ErrorTelegram extends Error {
  constructor(
    readonly codigo: 'rate_limit' | 'sin_destino' | 'servidor' | 'rechazado' | 'red',
    readonly status: number,
    readonly reintentarEnSeg: number | null = null,
  ) {
    super(`Telegram: ${codigo} (${status})`);
    this.name = 'ErrorTelegram';
  }
}

function tecladoDe(botones: BotonEnLinea[][] | undefined): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } | undefined {
  if (!botones) return undefined;
  return { inline_keyboard: botones.map((fila) => fila.map((b) => ({ text: b.texto, callback_data: b.callbackData }))) };
}

export function crearEnviadorTelegram(config: { token: string; fetch: FetchLike; base?: string; tiempoMaxMs?: number }): EnviadorTelegram {
  const base = config.base ?? 'https://api.telegram.org';

  async function llamar<T>(metodo: string, cuerpo: Record<string, unknown>): Promise<T> {
    let r: Awaited<ReturnType<FetchLike>>;
    try {
      r = await config.fetch(`${base}/bot${config.token}/${metodo}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(config.tiempoMaxMs ?? 10_000),
      });
    } catch {
      throw new ErrorTelegram('red', 0);
    }
    const datos = (await r.json().catch(() => null)) as { ok?: boolean; result?: T; parameters?: { retry_after?: number } } | null;
    if (r.ok && datos?.ok) return datos.result as T;
    if (r.status === 429) throw new ErrorTelegram('rate_limit', 429, datos?.parameters?.retry_after ?? null);
    if (r.status === 403 || r.status === 400) throw new ErrorTelegram(r.status === 403 ? 'sin_destino' : 'rechazado', r.status);
    throw new ErrorTelegram(r.status >= 500 ? 'servidor' : 'rechazado', r.status);
  }

  return {
    async enviar(m: MensajeSalida) {
      const res = await llamar<{ message_id: number }>('sendMessage', {
        chat_id: m.chatId,
        text: m.texto,
        reply_markup: tecladoDe(m.botones),
        reply_to_message_id: m.respondeA,
        protect_content: m.protegido === true,
        disable_notification: m.silencioso === true,
        link_preview_options: { is_disabled: true },
      });
      return { messageId: res.message_id };
    },
    async editar(chatId, messageId, texto, botones) {
      await llamar('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: texto,
        reply_markup: tecladoDe(botones) ?? { inline_keyboard: [] },
        link_preview_options: { is_disabled: true },
      });
    },
    async responderCallback(callbackId, texto, alerta) {
      await llamar('answerCallbackQuery', { callback_query_id: callbackId, text: texto ?? undefined, show_alert: alerta });
    },
    async salirDelChat(chatId) {
      await llamar('leaveChat', { chat_id: chatId });
    },
  };
}
