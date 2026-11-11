'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * El botón de envío del login con estado en vuelo (R08, paridad con el `EmailLogin` de Vexa): mientras la server action corre se deshabilita (el doble clic no pide dos enlaces), marca `aria-busy` y cambia
 * su texto («Continuar con correo» → «Solicitando…»). Las clases (`login-btn …`) y el glifo son los de siempre: `login.css` las estiliza (negro, gris y blanco).
 */
export function BotonLogin({ className, glifo, children, ocupado }: { className: string; glifo?: ReactNode; children: ReactNode; /** Texto mientras la acción corre. */ ocupado: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending || undefined}>
      {glifo}
      {pending ? <span>{ocupado}</span> : typeof children === 'string' ? <span>{children}</span> : children}
    </button>
  );
}
