// Entrada del webhook de Telegram: secreto en tiempo constante, limite de cuerpo, validacion del update y respuesta 200 pase lo que pase
// (un 5xx hace que Telegram reintente durante horas; el fallo se registra, no se devuelve). Esta funcion es independiente de Next:
// la ruta app/api/telegram/webhook (otra ola) solo le pasa cabecera, cuerpo y el agente.
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ResultadoUpdate } from '@/aplicacion/agente/agente';
import type { TgMensaje, UpdateTelegram } from '@/aplicacion/agente/telegram';

export const MAX_CUERPO_BYTES = 1_000_000;

/** Comparacion en tiempo constante del secreto de la cabecera X-Telegram-Bot-Api-Secret-Token. */
export function secretoValido(cabecera: string | null | undefined, esperado: string): boolean {
  if (!cabecera || esperado === '') return false;
  const a = Buffer.from(cabecera);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const chat = z.object({ id: z.number().int(), type: z.enum(['private', 'group', 'supergroup', 'channel']) });
const usuario = z.object({ id: z.number().int() });
const mensaje = z.object({
  message_id: z.number().int(),
  from: usuario.optional(),
  chat,
  date: z.number().int(),
  text: z.string().max(10_000).optional(),
  caption: z.string().max(10_000).optional(),
  edit_date: z.number().int().optional(),
  forward_origin: z.unknown().optional(),
  photo: z.array(z.unknown()).optional(),
  voice: z.unknown().optional(),
  audio: z.unknown().optional(),
  video_note: z.unknown().optional(),
});
const esquemaUpdate = z.object({
  update_id: z.number().int(),
  message: mensaje.optional(),
  edited_message: mensaje.optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: usuario,
      message: z.object({ message_id: z.number().int(), chat }).optional(),
      data: z.string().max(64).optional(),
    })
    .optional(),
});

function aMensaje(m: z.infer<typeof mensaje>): TgMensaje {
  const salida: TgMensaje = { message_id: m.message_id, chat: m.chat, date: m.date };
  if (m.from) salida.from = m.from;
  if (m.text !== undefined) salida.text = m.text;
  if (m.caption !== undefined) salida.caption = m.caption;
  if (m.edit_date !== undefined) salida.edit_date = m.edit_date;
  if (m.forward_origin !== undefined) salida.forward_origin = m.forward_origin;
  if (m.photo !== undefined) salida.has_photo = true;
  if (m.voice !== undefined || m.audio !== undefined || m.video_note !== undefined) salida.has_audio = true;
  return salida;
}

export type LecturaUpdate = { ok: true; update: UpdateTelegram } | { ok: false; motivo: 'demasiado_grande' | 'json_invalido' | 'forma_invalida' };

export function leerUpdate(cuerpo: string): LecturaUpdate {
  if (Buffer.byteLength(cuerpo) > MAX_CUERPO_BYTES) return { ok: false, motivo: 'demasiado_grande' };
  let crudo: unknown;
  try {
    crudo = JSON.parse(cuerpo);
  } catch {
    return { ok: false, motivo: 'json_invalido' };
  }
  const r = esquemaUpdate.safeParse(crudo);
  if (!r.success) return { ok: false, motivo: 'forma_invalida' };
  const u = r.data;
  const update: UpdateTelegram = { update_id: u.update_id };
  if (u.message) update.message = aMensaje(u.message);
  if (u.edited_message) update.edited_message = aMensaje(u.edited_message);
  if (u.callback_query) update.callback_query = u.callback_query;
  return { ok: true, update };
}

export interface RespuestaWebhook {
  status: 200 | 401;
  detalle: 'secreto_invalido' | 'ignorado' | 'procesado' | 'error';
}

/**
 * Lee el cuerpo de una peticion con tope: rechaza por Content-Length ANTES de leer y corta la lectura al pasar `max` bytes (null = demasiado grande).
 * Se llama DESPUES de validar el secreto: quien no lo conoce no hace que el servidor lea nada.
 */
export async function leerCuerpoAcotado(req: { headers: { get(n: string): string | null }; body: ReadableStream<Uint8Array> | null }, max: number = MAX_CUERPO_BYTES): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declarado) && declarado > max) return null;
  if (!req.body) return '';
  const lector = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString('utf8');
}

export async function manejarWebhook(entrada: {
  cabeceraSecreto: string | null;
  secretoEsperado: string;
  /** Texto ya leido, o un lector perezoso que se invoca solo con el secreto valido (B3). null = excede el limite. */
  cuerpo: string | (() => Promise<string | null>);
  procesar: (u: UpdateTelegram) => Promise<ResultadoUpdate>;
}): Promise<RespuestaWebhook> {
  if (!secretoValido(entrada.cabeceraSecreto, entrada.secretoEsperado)) return { status: 401, detalle: 'secreto_invalido' };
  const cuerpo = typeof entrada.cuerpo === 'function' ? await entrada.cuerpo() : entrada.cuerpo;
  if (cuerpo === null) return { status: 200, detalle: 'ignorado' };
  const lectura = leerUpdate(cuerpo);
  if (!lectura.ok) return { status: 200, detalle: 'ignorado' };
  try {
    await entrada.procesar(lectura.update);
    return { status: 200, detalle: 'procesado' };
  } catch {
    return { status: 200, detalle: 'error' };
  }
}
