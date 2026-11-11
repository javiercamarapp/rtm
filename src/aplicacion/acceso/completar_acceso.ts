// Lo que pasa cuando el enlace aterriza en /auth/callback: canjear el codigo, exigir cuenta ACTIVA con rol de la tabla
// (nunca de user_metadata) y decidir a donde ir. Si algo falla: motivo con nombre y, si el enlace caduco, reenvio automatico.
import { aParametro, motivoDeIntercambio, motivoSinCode, type MotivoLogin } from '@/dominio/acceso/motivo_login';
import { destinoSeguro } from '@/dominio/acceso/ruta_segura';
import { reenviarEnlaceCaducado } from './reenvio';
import type { DepsAcceso } from './puertos';

export interface EntradaCallback {
  code: string | null;
  next: string | null;
  errorCode: string | null;
  ip: string;
}

/** `redirigirA` es una ruta propia (la capa web la vuelve absoluta con el origen publico). */
export type SalidaCallback = { destino: string };

export async function completarAcceso(deps: DepsAcceso, entrada: EntradaCallback): Promise<SalidaCallback> {
  const destino = destinoSeguro(entrada.next);
  let motivo: MotivoLogin = motivoSinCode(entrada.errorCode);

  if (entrada.code) {
    try {
      const { error } = await deps.autenticador.canjearCodigo(entrada.code);
      if (error) {
        motivo = motivoDeIntercambio(error);
      } else {
        const estado = await deps.autenticador.sesion();
        const perfil = estado.autenticado ? estado.perfil : null;
        if (perfil && perfil.activo && perfil.rol === 'socio') return { destino };
        // Cuenta sin fila, inactiva (Omar hasta M2) o con rol sin pantallas: el enlace canjea pero no hay sesion usable.
        try {
          await deps.autenticador.cerrarSesion();
        } catch {
          /* sin sesion usable de todos modos */
        }
        deps.rastro.fallo('callback', 'desactivada', entrada.ip);
        return { destino: '/login?error=desactivada' };
      }
    } catch {
      // Fallo inesperado del SDK: cae al mismo fallback para no volverse un 500 en la pantalla mas importante.
    }
  }

  deps.rastro.fallo('callback', motivo === 'caducado' ? 'caducado' : entrada.code ? 'intercambio_fallido' : 'invalido', entrada.ip);
  if (motivo === 'caducado') {
    try {
      const r = await reenviarEnlaceCaducado(deps, destino, entrada.ip);
      if (r === 'reenviado') return { destino: '/login?enviado=1&reenviado=1' };
      if (r === 'reciente') return { destino: '/login?error=caducado_reciente' };
    } catch {
      /* sin red ni Supabase no hay reenvio: basta el mensaje de caducado */
    }
  }
  return { destino: `/login?error=${aParametro(motivo)}` };
}
