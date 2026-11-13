// Constructores de updates de Telegram (pruebas y simulador). Ids ficticios.
import type { UpdateTelegram } from '@/aplicacion/agente/telegram';

export const IDS_SIMULADOS = {
  angelo: 1001,
  javier: 1002,
  omar: 1003,
  extrano: 1999,
  grupoSocios: -100_500,
  /** En Telegram el chat privado con un usuario tiene el id del usuario. */
  privadoOmar: 1003,
} as const;

export class ContadorUpdates {
  private n = 0;
  private m = 0;
  siguienteUpdate(): number {
    return ++this.n;
  }
  siguienteMensaje(): number {
    return ++this.m;
  }
}

export interface OpcionesTexto {
  de: number;
  chat: number;
  texto: string;
  tipoChat?: 'private' | 'group' | 'supergroup';
  updateId?: number;
  messageId?: number;
  edicion?: boolean;
  reenviado?: boolean;
  /** true = foto sin ids; con ids = comprobante (solo ids, jamas contenido). */
  foto?: boolean | { fileId: string; fileUniqueId: string };
  audio?: boolean;
}

export function updateTexto(c: ContadorUpdates, o: OpcionesTexto): UpdateTelegram {
  const messageId = o.messageId ?? c.siguienteMensaje();
  const mensaje = {
    message_id: messageId,
    from: { id: o.de },
    chat: { id: o.chat, type: o.tipoChat ?? (o.chat < 0 ? ('supergroup' as const) : ('private' as const)) },
    date: 1_794_000_000,
    ...(o.texto === '' ? {} : { text: o.texto }),
    ...(o.reenviado ? { forward_origin: { type: 'user' } } : {}),
    ...(o.foto ? { has_photo: true } : {}),
    ...(typeof o.foto === 'object' ? { foto: o.foto } : {}),
    ...(o.audio ? { has_audio: true } : {}),
    ...(o.edicion ? { edit_date: 1_794_000_100 } : {}),
  };
  const update_id = o.updateId ?? c.siguienteUpdate();
  return o.edicion ? { update_id, edited_message: mensaje } : { update_id, message: mensaje };
}

export function updateBoton(c: ContadorUpdates, o: { de: number; chat: number; messageId: number; data: string; callbackId?: string; updateId?: number }): UpdateTelegram {
  const update_id = o.updateId ?? c.siguienteUpdate();
  return {
    update_id,
    callback_query: {
      id: o.callbackId ?? `cb${update_id}`,
      from: { id: o.de },
      message: { message_id: o.messageId, chat: { id: o.chat, type: o.chat < 0 ? 'supergroup' : 'private' } },
      data: o.data,
    },
  };
}
