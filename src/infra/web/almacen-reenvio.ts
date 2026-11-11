// Cookies del reenvio: a que correo se pidio el ultimo enlace (una hora, la vida del enlace) y el candado de 5 minutos (el TTL ES el candado).
import { cookies } from 'next/headers';
import type { AlmacenReenvio } from '@/aplicacion/acceso/puertos';

const COOKIE_CORREO = 'rtm_correo_enlace';
const COOKIE_ESPERA = 'rtm_reenvio_espera';
const ESPERA_SEGUNDOS = 5 * 60;
const VIDA_CORREO_SEGUNDOS = 60 * 60;

const OPCIONES = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const;

export function almacenReenvioCookies(): AlmacenReenvio {
  return {
    async guardarCorreo(correo) {
      (await cookies()).set(COOKIE_CORREO, encodeURIComponent(correo), { ...OPCIONES, maxAge: VIDA_CORREO_SEGUNDOS });
    },
    async correoRecordado() {
      const crudo = (await cookies()).get(COOKIE_CORREO)?.value;
      if (!crudo) return null;
      try {
        return decodeURIComponent(crudo) || null;
      } catch {
        return null;
      }
    },
    async hayEspera() {
      return !!(await cookies()).get(COOKIE_ESPERA);
    },
    async marcarEspera() {
      (await cookies()).set(COOKIE_ESPERA, '1', { ...OPCIONES, maxAge: ESPERA_SEGUNDOS });
    },
  };
}
