'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, useTransition } from 'react';
import { centavosDesdeTexto } from '@/dominio/dinero';
import { bigintACentavos } from '@/dominio/operacion/json';
import { ejecutar } from './acciones';

/**
 * Ejecuta una accion de escritura con clave de idempotencia estable por INTENCION: se renueva solo cuando la accion tuvo exito.
 * Si la red falla y el usuario reintenta, viaja la misma clave y la base no duplica el hecho.
 */
export function useAccion() {
  const router = useRouter();
  const [ocupado, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const clave = useRef<string>(`web:${crypto.randomUUID()}`);

  const correr = useCallback(
    (accion: string, args: Record<string, unknown>, alTerminar?: (datos: Record<string, unknown>) => void) => {
      empezar(async () => {
        let r: Awaited<ReturnType<typeof ejecutar>>;
        try {
          r = await ejecutar(accion, { ...args, p_clave_idem: clave.current });
        } catch {
          // Corte de red o respuesta perdida: sin esto la excepcion de la transicion tira toda la pantalla al error general y se pierde el dialogo.
          // La clave NO se renueva: reintentar manda la misma y la base no duplica el hecho.
          setError('No se pudo confirmar la respuesta (sin conexión). Es posible que ya se haya guardado: vuelve a pulsar el botón; la misma solicitud no se duplica.');
          return;
        }
        if (r.ok) {
          clave.current = `web:${crypto.randomUUID()}`;
          setError(null);
          alTerminar?.(r.datos);
          router.refresh();
        } else {
          setError(r.mensaje);
        }
      });
    },
    [router],
  );
  return { correr, ocupado, error, limpiarError: () => setError(null) };
}

/** Pesos escritos por una persona ("250", "1,234.50") a centavos enteros para la base; null si no es un monto valido o es negativo. Sin decimales flotantes. */
export function centavosDeTexto(texto: string): number | null {
  try {
    const c = centavosDesdeTexto(texto);
    return c < 0n ? null : bigintACentavos(c);
  } catch {
    return null;
  }
}
