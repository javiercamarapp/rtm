// Entrada del webhook de Telegram: secreto en tiempo constante, limite de cuerpo, validacion del update. Responde 200 SOLO despues de registrar el update (reclamo con lease en SQL);
// si el registro mismo falla (base caida) responde 500 y Telegram reintenta con el mismo update_id (el agente lo reclama de nuevo: nuevo o reprocesar). Un fallo DENTRO del proceso
// ya queda registrado como 'fallido' y se reprocesa en el barrido; no se devuelve un 5xx por eso. Esta funcion es independiente de Next:
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
  document: z.unknown().optional(),
  voice: z.unknown().optional(),
  migrate_to_chat_id: z.number().int().optional(),
  migrate_from_chat_id: z.number().int().optional(),
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
  if (m.migrate_to_chat_id !== undefined) salida.migrate_to_chat_id = m.migrate_to_chat_id;
  if (m.migrate_from_chat_id !== undefined) salida.migrate_from_chat_id = m.migrate_from_chat_id;
  if (m.forward_origin !== undefined) salida.forward_origin = m.forward_origin;
  if (m.photo !== undefined) salida.has_photo = true;
  // Solo los ids (nunca el contenido): la foto mas grande de la lista, o el archivo adjunto.
  const idsDe = (x: unknown): { fileId: string; fileUniqueId: string } | null => {
    if (typeof x !== 'object' || x === null) return null;
    const o = x as { file_id?: unknown; file_unique_id?: unknown };
    return typeof o.file_id === 'string' && o.file_id.length <= 300 && typeof o.file_unique_id === 'string' && o.file_unique_id.length <= 100 ? { fileId: o.file_id, fileUniqueId: o.file_unique_id } : null;
  };
  const foto = (m.photo !== undefined ? idsDe(m.photo[m.photo.length - 1]) : null) ?? (m.document !== undefined ? idsDe(m.document) : null);
  if (foto) {
    salida.foto = foto;
    salida.has_photo = true;
  }
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
  status: 200 | 401 | 500;
  detalle: 'secreto_invalido' | 'ignorado' | 'procesado' | 'error' | 'no_registrado';
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
    // El update no se pudo registrar (o el agente fallo antes de reclamarlo): 5xx para que Telegram lo reintente. El reclamo es idempotente por update_id.
    return { status: 500, detalle: 'no_registrado' };
  }
}
