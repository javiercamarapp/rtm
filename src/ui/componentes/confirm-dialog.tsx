'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  abierto: boolean;
  titulo: string;
  children: ReactNode;
  confirmar: string;
  cancelar?: string;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Confirmacion propia (nunca window.confirm): <dialog> modal con foco atrapado, Esc para cancelar y la accion segura enfocada primero. */
export function ConfirmDialog({ abierto, titulo, children, confirmar, cancelar = 'Cancelar', ocupado, onConfirmar, onCancelar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const origenRef = useRef<HTMLElement | null>(null);
  const id = useId();
  // Los formularios montan el dialogo solo mientras esta abierto: al desmontarse, el foco vuelve al control que lo abrio.
  useEffect(() => {
    const origen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (origen?.isConnected) origen.focus(); };
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // React no escribe el atributo `autofocus` y showModal() enfoca el primer control: se enfoca la accion segura (Cancelar) de forma explicita.
    if (abierto && !d.open) { origenRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; d.showModal(); cancelarRef.current?.focus(); }
    if (!abierto && d.open) { d.close(); if (origenRef.current?.isConnected) origenRef.current.focus(); }
  }, [abierto]);
  return (
    <dialog ref={ref} className="rtm-dialogo" aria-labelledby={`${id}-t`} aria-describedby={`${id}-x`} onCancel={(e) => { e.preventDefault(); if (!ocupado) onCancelar(); }}>
      <h2 id={`${id}-t`} className="rtm-dialogo-titulo">{titulo}</h2>
      <div id={`${id}-x`} className="rtm-dialogo-texto">{children}</div>
      <div className="rtm-dialogo-acciones">
        <button ref={cancelarRef} type="button" className="rtm-boton" autoFocus onClick={onCancelar} disabled={ocupado}>{cancelar}</button>
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={onConfirmar} disabled={ocupado} data-testid="confirmar">{ocupado ? 'Guardando' : confirmar}</button>
      </div>
    </dialog>
  );
}
