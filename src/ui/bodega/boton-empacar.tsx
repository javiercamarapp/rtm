'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { ResultadoEmpaque } from '@/dominio/bodega/bodega';

/** Marca un pedido como empacado. Sin dinero: solo avisa a los socios que ya esta listo para enviar. La clave se renueva solo tras un exito. */
export function BotonEmpacar({ folio, accion }: { folio: string; accion: (clave: string, folio: string) => Promise<ResultadoEmpaque> }) {
  const router = useRouter();
  const [ocupado, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const clave = useRef(`web:${crypto.randomUUID()}`);
  const pulsar = () => empezar(async () => {
    let r: ResultadoEmpaque;
    try { r = await accion(clave.current, folio); } catch { r = { ok: false, mensaje: 'No se pudo guardar. Revisa tu conexión e intenta de nuevo; no se duplicará.' }; }
    if (r.ok) { setError(null); clave.current = `web:${crypto.randomUUID()}`; router.refresh(); } else setError(r.mensaje);
  });
  return (
    <span className="bodega-empacar">
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={pulsar} data-testid="marcar-empacado">{ocupado ? 'Guardando' : 'Marcar empacado'}</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </span>
  );
}
