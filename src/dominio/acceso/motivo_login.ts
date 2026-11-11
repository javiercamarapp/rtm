// El motivo del fallo de entrada, para que /login no mienta por omision. Los motivos hablan del estado del ENLACE, nunca de la cuenta:
// el oraculo de enumeracion que /login cierra (un correo sin cuenta responde igual que uno con cuenta) no se reabre aqui.

/** Los valores que viajan en `/login?error=...`. `generico` se serializa como `1`. */
export type MotivoLogin = 'caducado' | 'navegador' | 'generico';

/** Motivo cuando el callback llego SIN `code`: el verificador de Supabase rechazo el token y pego el porque como query params. */
export function motivoSinCode(errorCode: string | null): MotivoLogin {
  return errorCode === 'otp_expired' ? 'caducado' : 'generico';
}

/** Motivo cuando `exchangeCodeForSession` fallo con el code en la mano. */
export function motivoDeIntercambio(error: { code?: string; message?: string }): MotivoLogin {
  const mensaje = error.message ?? '';
  if (error.code === 'validation_failed' || /code verifier/i.test(mensaje)) return 'navegador';
  if (error.code === 'flow_state_not_found' || error.code === 'flow_state_expired' || /flow state/i.test(mensaje)) return 'caducado';
  return 'generico';
}

export function aParametro(motivo: MotivoLogin): string {
  return motivo === 'generico' ? '1' : motivo;
}

/** Lo que la pantalla dice por cada motivo. El texto del enlace caducado evita "intenta otra vez" a proposito. */
export function mensajeDeError(parametro: string): string {
  if (parametro === 'caducado') return 'Ese enlace ya se usó o ya caducó. Pide uno nuevo con tu correo.';
  if (parametro === 'caducado_reciente') {
    return 'Ese enlace ya se usó o ya caducó, y te mandamos uno nuevo hace unos minutos. Abre el correo más reciente.';
  }
  if (parametro === 'navegador') {
    return 'Ese enlace se pidió desde otro navegador. Ábrelo en el navegador donde escribiste tu correo, o pide uno nuevo desde aquí.';
  }
  if (parametro === 'desactivada') return 'Tu acceso a RTM no está activo. Pídele a un socio que lo habilite.';
  return 'Algo falló. Intenta otra vez.';
}
