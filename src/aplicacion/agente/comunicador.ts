// Salida de mensajes. Dos garantias que no dependen de quien arme el texto:
//  1) Ninguna cifra llega a una respuesta si el servidor no la entrego (RegistroCifras.exigir).
//  2) Nada con costos, margenes, utilidad, proveedores, socios o clientes llega al chat de Omar (lista blanca de plantillas + lista negra de terminos).
import { ErrorCifraAjena, ErrorFugaOmar, type ChatsRegistrados } from '@/dominio/agente/tipos';
import type { AlmacenAgente, BotonEnLinea, EnviadorTelegram } from './puertos';
import type { MensajeListo } from './plantillas';

/** Lista negra de terminos prohibidos en cualquier mensaje a Omar (spec 26). */
const TERMINOS_PROHIBIDOS_OMAR = /costo|margen|utilidad|proveedor|isaac|karen|vapemate|socio|cliente|precio|angelo|javier/i;

const TEXTO_BLOQUEADO = 'No pude mostrar esa respuesta con seguridad. Usa la web.';

export function verificarMensajeOmar(m: MensajeListo): string {
  const hallado = TERMINOS_PROHIBIDOS_OMAR.exec(m.texto);
  if (hallado) throw new ErrorFugaOmar(hallado[0].toLowerCase());
  return m.registro.exigir(m.texto);
}

export class Comunicador {
  constructor(
    private readonly telegram: EnviadorTelegram,
    private readonly almacen: AlmacenAgente,
  ) {}

  /** Mensaje al grupo de socios. Devuelve el id del mensaje, o null si la guardia lo bloqueo. */
  async aGrupo(chats: ChatsRegistrados, m: MensajeListo, opciones: { botones?: BotonEnLinea[][]; respondeA?: number } = {}): Promise<number | null> {
    try {
      const texto = m.registro.exigir(m.texto);
      const r = await this.telegram.enviar({ chatId: chats.grupoSocios, texto, botones: opciones.botones, respondeA: opciones.respondeA, protegido: true });
      return r.messageId;
    } catch (e) {
      if (!(e instanceof ErrorCifraAjena)) throw e;
      await this.almacen.registrarEvento({ tipo: 'respuesta_bloqueada', miembro: null, detalle: `cifras_ajenas=${e.ajenas.length}` });
      await this.telegram.enviar({ chatId: chats.grupoSocios, texto: TEXTO_BLOQUEADO });
      return null;
    }
  }

  /** Mensaje al chat privado de Omar: lista blanca de plantillas y lista negra de terminos. */
  async aOmar(chats: ChatsRegistrados, m: MensajeListo): Promise<number | null> {
    try {
      const texto = verificarMensajeOmar(m);
      const r = await this.telegram.enviar({ chatId: chats.privadoOmar, texto });
      return r.messageId;
    } catch (e) {
      if (!(e instanceof ErrorCifraAjena) && !(e instanceof ErrorFugaOmar)) throw e;
      await this.almacen.registrarEvento({ tipo: 'respuesta_bloqueada', miembro: null, detalle: e instanceof ErrorFugaOmar ? 'fuga_omar' : 'cifras_ajenas_omar' });
      await this.telegram.enviar({ chatId: chats.privadoOmar, texto: 'Eso lo registran los duenos, ya les avise.' });
      return null;
    }
  }

  /** Edita una tarjeta ya enviada (sin `botones` se retira el teclado). Mismas guardias que el envio. */
  async editar(chats: ChatsRegistrados, chatId: number, messageId: number, m: MensajeListo, botones?: BotonEnLinea[][]): Promise<void> {
    try {
      const texto = chatId === chats.privadoOmar ? verificarMensajeOmar(m) : m.registro.exigir(m.texto);
      await this.telegram.editar(chatId, messageId, texto, botones);
    } catch (e) {
      if (!(e instanceof ErrorCifraAjena) && !(e instanceof ErrorFugaOmar)) throw e;
      await this.almacen.registrarEvento({ tipo: 'respuesta_bloqueada', miembro: null, detalle: 'edicion_bloqueada' });
    }
  }
}
