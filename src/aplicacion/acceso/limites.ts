// Topes del enlace magico. El unico tope original de /login era por IP: repartiendo IP, un atacante podia mandar cientos de
// correos a UNA victima o agotar la cuota de envio. Aqui se cuenta por IP, por CORREO destino y en total. Al excederse NO se
// manda el correo, pero la respuesta es la de siempre ("enviado"), con el mismo tiempo: ninguna senal para enumerar cuentas.
import type { LimitadorIntentos, Tope } from './puertos';

export const TOPE_IP: Tope = { limite: 10, ventanaSeg: 5 * 60 };
export const TOPE_POR_CORREO: Tope = { limite: 3, ventanaSeg: 10 * 60 };
export const TOPE_GLOBAL: Tope = { limite: 60, ventanaSeg: 10 * 60 };

/** true si esta IP ya se paso (10 intentos / 5 min). */
export function ipExcedeTope(limitador: LimitadorIntentos, ip: string): Promise<boolean> {
  return limitador.excede('ip', ip, TOPE_IP);
}

/** true si NO hay que mandar el correo (este destino o el total ya pasaron su tope). Cada peticion cuenta en ambos. */
export async function correoExcedeTopes(limitador: LimitadorIntentos, correo: string): Promise<boolean> {
  const porCorreo = await limitador.excede('correo', correo.trim().toLowerCase(), TOPE_POR_CORREO);
  const global = await limitador.excede('global', 'todos', TOPE_GLOBAL);
  return porCorreo || global;
}
