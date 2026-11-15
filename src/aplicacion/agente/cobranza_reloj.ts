// Reloj de la cobranza (carril bot/cobranza): reclama el digest del dia en la base, lo envia al GRUPO DE LOS SOCIOS con el transporte del bot y registra el resultado.
// CONSTRUIDO Y APAGADO: la base solo reclama si el interruptor `cobranza_activa` esta encendido (nace apagado), `telegram_envio` esta encendido y `cron_pausado` no lo frena.
// Esta pieza NO esta conectada a ninguna ruta ni programacion: quien la invoque (un latido, un cron) es una decision posterior del dueno.
// Garantias: un solo digest por dia y tipo (la base lo reclama); jamas se escribe a clientes, proveedores ni Omar (solo `chats.grupoSocios`); si el envio falla se registra el fallo y solo
// entonces el siguiente tick reintenta; si el envio sale pero el registro falla, NO se reenvia (la base queda "reclamado sin confirmar" y se avisa).
import type { EnviadorTelegram } from './puertos';
import type { ChatsRegistrados } from '@/dominio/agente/tipos';

export type TipoDigest = 'am' | 'cierre';

export interface PuertoRelojCobranza {
  /** cobranza.reloj_tick: reclama y arma el digest, o explica por que no (apagado, temprano, sin_contenido, ya_enviado...). */
  tick(tipo: TipoDigest): Promise<{ estado: string; digest_id?: number; texto?: string }>;
  registrarEnvio(digestId: number, ok: boolean, messageId: number | null, error: string | null): Promise<void>;
  chats(): Promise<ChatsRegistrados>;
}

export type ResultadoReloj = { estado: string; enviado: boolean; messageId?: number };

export async function ejecutarRelojCobranza(tipo: TipoDigest, puerto: PuertoRelojCobranza, telegram: EnviadorTelegram): Promise<ResultadoReloj> {
  const r = await puerto.tick(tipo);
  if (r.estado !== 'reclamado' || r.digest_id === undefined || !r.texto) return { estado: r.estado, enviado: false };
  const chats = await puerto.chats();
  if (!chats.grupoSocios) {
    await puerto.registrarEnvio(r.digest_id, false, null, 'sin chat del grupo de los socios');
    return { estado: 'sin_grupo', enviado: false };
  }
  let messageId: number;
  try {
    // protegido: es informacion financiera; el unico destino es el grupo de los socios.
    ({ messageId } = await telegram.enviar({ chatId: chats.grupoSocios, texto: r.texto, protegido: true }));
  } catch (e) {
    await puerto.registrarEnvio(r.digest_id, false, null, (e instanceof Error ? e.message : 'error de envio').slice(0, 300));
    return { estado: 'fallido', enviado: false };
  }
  await puerto.registrarEnvio(r.digest_id, true, messageId, null);
  return { estado: 'enviado', enviado: true, messageId };
}
