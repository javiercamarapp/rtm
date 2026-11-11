// Subconjunto de la Bot API de Telegram que usa el agente. La validacion del cuerpo del webhook vive en infra/agente.

export interface TgUsuario {
  id: number;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TgMensaje {
  message_id: number;
  from?: TgUsuario;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  edit_date?: number;
  /** Presente en mensajes reenviados: su contenido es dato no confiable. */
  forward_origin?: unknown;
  has_photo?: boolean;
  has_audio?: boolean;
}

export interface TgCallback {
  id: string;
  from: TgUsuario;
  message?: { message_id: number; chat: TgChat };
  data?: string;
}

export interface UpdateTelegram {
  update_id: number;
  message?: TgMensaje;
  edited_message?: TgMensaje;
  callback_query?: TgCallback;
}
