'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { ResultadoAlta } from '@/aplicacion/catalogo/alta';

/**
 * Envio de un formulario de alta: la clave de idempotencia es estable por INTENCION (se renueva solo tras un exito),
 * asi un reintento por red caida no duplica el hecho. Un fallo de red se convierte en mensaje, nunca en pantalla rota.
 */
export function usarAlta<K extends string>() {
  const router = useRouter();
  const [ocupado, empezar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoAlta<K> | null>(null);
  const clave = useRef<string>(`web:${crypto.randomUUID()}`);

  const enviar = (llamar: (clave: string) => Promise<ResultadoAlta<K>>, alExito?: (r: Extract<ResultadoAlta<K>, { ok: true }>) => void) => {
    empezar(async () => {
      let r: ResultadoAlta<K>;
      try {
        r = await llamar(clave.current);
      } catch {
        r = { ok: false, mensaje: 'No se pudo guardar. Revisa tu conexión e intenta de nuevo; no se duplicará.', errores: {} };
      }
      setResultado(r);
      if (r.ok) {
        clave.current = `web:${crypto.randomUUID()}`;
        alExito?.(r);
        router.refresh();
      }
    });
  };
  return { enviar, ocupado, resultado, limpiar: () => setResultado(null) };
}
