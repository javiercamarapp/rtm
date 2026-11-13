// Raiz de composicion del acceso: cablea los puertos con sus implementaciones. Es la unica capa (junto con src/proxy.ts)
// que conoce infra y aplicacion a la vez; las paginas importan de aqui y nunca de infra.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { completarAcceso, completarConfirmacion, type SalidaCallback } from '@/aplicacion/acceso/completar_acceso';
import { correoExcedeTopes, ipExcedeTope } from '@/aplicacion/acceso/limites';
import { LimitadorNoDisponible, type DepsAcceso, type Perfil } from '@/aplicacion/acceso/puertos';
import { reenviarEnlaceCaducado, urlCallback } from '@/aplicacion/acceso/reenvio';
import { DESTINO_BODEGA, DESTINO_OMAR } from '@/dominio/acceso/ruta_segura';
import { appUrl } from '@/config/env';
import { autenticadorSupabase } from '@/infra/supabase/autenticador';
import { limitadorPostgres } from '@/infra/limite/limitador_postgres';
import { almacenReenvioCookies } from '@/infra/web/almacen-reenvio';
import { ipDeCabeceras } from '@/infra/web/ip';
import { rastroConsola } from '@/infra/web/rastro';

function deps(): DepsAcceso {
  return {
    autenticador: autenticadorSupabase(),
    limitador: limitadorPostgres(),
    reenvio: almacenReenvioCookies(),
    rastro: rastroConsola(),
    urlApp: appUrl(),
  };
}

export async function ipActual(): Promise<string> {
  return ipDeCabeceras(await headers());
}

export function ipDeSolicitud(h: Headers): string {
  return ipDeCabeceras(h);
}

export type EstadoLimiteIp = 'dentro' | 'excedido' | 'no_disponible';

/** Limite por IP. FALLA CERRADO: si el limitador no responde devuelve 'no_disponible' (el llamador rechaza con la respuesta generica, sin senal) y deja un aviso interno sin datos personales. */
export async function ipDentroDelLimite(): Promise<EstadoLimiteIp> {
  const d = deps();
  try {
    return (await ipExcedeTope(d.limitador, await ipActual())) ? 'excedido' : 'dentro';
  } catch (e) {
    if (!(e instanceof LimitadorNoDisponible)) throw e;
    d.rastro.aviso('login.limitador_no_disponible', { puerta: 'ip', codigo: e.codigo });
    return 'no_disponible';
  }
}

/** Enlace magico: respuesta identica para correo con y sin cuenta (el llamador aplica el piso de tiempo).
 *  `limitadorCaido`: el limite por IP ya no pudo consultarse; no se manda nada y la respuesta es la misma que la de un correo no permitido. */
export async function pedirEnlace(correo: string, dest: string, limitadorCaido = false) {
  const d = deps();
  const ip = await ipActual();
  // Deja dicho a quien reenviar si este enlace muere, ANTES de saber si el correo tiene cuenta (anti-oraculo).
  await d.reenvio.guardarCorreo(correo);
  let sinEnviar = limitadorCaido;
  if (!sinEnviar) {
    try {
      sinEnviar = await correoExcedeTopes(d.limitador, correo);
    } catch (e) {
      if (!(e instanceof LimitadorNoDisponible)) throw e;
      d.rastro.aviso('login.limitador_no_disponible', { puerta: 'correo', codigo: e.codigo });
      sinEnviar = true; // FALLA CERRADO
    }
  }
  const { error } = sinEnviar ? { error: null } : await d.autenticador.enviarEnlace(correo, urlCallback(d.urlApp, dest));
  if (error) d.rastro.fallo('login_email', 'otp_no_enviado', ip);
  return { error };
}

export async function correoRecordado(): Promise<string | null> {
  return deps().reenvio.correoRecordado();
}

export async function reenviarEnlace(dest: string) {
  return reenviarEnlaceCaducado(deps(), dest, await ipActual());
}

export function procesarCallback(entrada: { code: string | null; next: string | null; errorCode: string | null; ip: string }): Promise<SalidaCallback> {
  return completarAcceso(deps(), entrada);
}

export async function cerrarSesionYSalir(): Promise<never> {
  await deps().autenticador.cerrarSesion();
  redirect('/login');
}

export interface SesionActiva {
  perfil: Perfil;
}

/** Guarda de las paginas de socio: sin sesion o sin cuenta activa con rol socio, al login. La autoridad es la tabla, no el cliente. */
export async function exigirSocio(): Promise<SesionActiva> {
  const estado = await deps().autenticador.sesion();
  if (!estado.autenticado) redirect('/login');
  const perfil = estado.perfil;
  // Omar activo (interruptor de M2) tiene su propia vista: nunca se le sirve una pagina de socio.
  if (perfil && perfil.activo && perfil.rol === 'omar') redirect(DESTINO_OMAR);
  if (perfil && perfil.activo && perfil.rol === 'bodega') redirect(DESTINO_BODEGA);
  if (!perfil || !perfil.activo || perfil.rol !== 'socio') redirect('/login?error=desactivada');
  return { perfil };
}

/** Guarda de la vista de Omar: sin sesion, o sin cuenta ACTIVA con rol omar (hoy desactivada hasta M2), no se renderiza nada. Un socio vuelve a su inicio. */
export async function exigirOmar(): Promise<SesionActiva> {
  const estado = await deps().autenticador.sesion();
  if (!estado.autenticado) redirect('/login');
  const perfil = estado.perfil;
  if (perfil && perfil.activo && perfil.rol === 'socio') redirect('/');
  if (perfil && perfil.activo && perfil.rol === 'bodega') redirect(DESTINO_BODEGA);
  if (!perfil || !perfil.activo || perfil.rol !== 'omar') redirect('/login?error=desactivada');
  return { perfil };
}

/** Guarda de la vista de bodega: cuenta ACTIVA con rol bodega. Un socio activo tambien entra (vista previa de lo que ve bodega); Omar vuelve a lo suyo. */
export async function exigirBodega(): Promise<SesionActiva & { vistaPrevia: boolean }> {
  const estado = await deps().autenticador.sesion();
  if (!estado.autenticado) redirect('/login');
  const perfil = estado.perfil;
  if (perfil && perfil.activo && perfil.rol === 'omar') redirect(DESTINO_OMAR);
  if (!perfil || !perfil.activo || (perfil.rol !== 'bodega' && perfil.rol !== 'socio')) redirect('/login?error=desactivada');
  return { perfil, vistaPrevia: perfil.rol === 'socio' };
}

export function procesarConfirmacion(entrada: { tokenHash: string | null; tipo: string | null; next: string | null }): Promise<SalidaCallback> {
  return ipActual().then((ip) => completarConfirmacion(deps(), { ...entrada, ip }));
}
