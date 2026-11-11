'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, useTransition } from 'react';
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
        const r = await ejecutar(accion, { ...args, p_clave_idem: clave.current });
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

/** Pesos escritos por una persona ("250", "1,234.50") a centavos enteros para la base; null si no es un monto valido. Sin decimales flotantes. */
export function centavosDeTexto(texto: string): number | null {
  const limpio = texto.trim().replace(/[$,\s]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) return null;
  const cent = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return cent <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cent) : null;
}
