// Reenvio automatico del enlace caducado. Cuando alguien abre un enlace ya usado o vencido, se reenvia UN enlace nuevo al
// correo que ESTE navegador pidio (cookie de una hora). Dos frenos: uno cada 5 minutos y el mismo tope por IP del formulario.
// Si el correo no tiene cuenta, se degrada a "no se reenvio": el oraculo de enumeracion sigue cerrado.
import { correoExcedeTopes, ipExcedeTope } from './limites';
import type { DepsAcceso } from './puertos';

export type ResultadoReenvio = 'reenviado' | 'reciente' | 'no';

export function urlCallback(urlApp: string, dest: string): string {
  return `${urlApp}/auth/callback?next=${encodeURIComponent(dest)}`;
}

export async function reenviarEnlaceCaducado(deps: DepsAcceso, dest: string, ip: string): Promise<ResultadoReenvio> {
  const correo = await deps.reenvio.correoRecordado();
  if (!correo) return 'no';
  if (await deps.reenvio.hayEspera()) return 'reciente';
  if (await ipExcedeTope(deps.limitador, ip)) return 'no';
  // Un intento por ventana de 5 minutos, salga o no el correo.
  await deps.reenvio.marcarEspera();
  if (await correoExcedeTopes(deps.limitador, correo)) return 'no';
  const { error } = await deps.autenticador.enviarEnlace(correo, urlCallback(deps.urlApp, dest));
  if (error) {
    deps.rastro.aviso('login.reenvio_no_salio', { code: error.code, status: error.status });
    deps.rastro.fallo('reenvio', 'otp_no_enviado', ip);
    return 'no';
  }
  deps.rastro.aviso('login.reenvio_por_caducado');
  return 'reenviado';
}
