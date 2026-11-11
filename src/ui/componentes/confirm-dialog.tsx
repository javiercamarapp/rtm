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
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} className="rtm-dialogo" aria-labelledby={`${id}-t`} aria-describedby={`${id}-x`} onCancel={(e) => { e.preventDefault(); if (!ocupado) onCancelar(); }}>
      <h2 id={`${id}-t`} className="rtm-dialogo-titulo">{titulo}</h2>
      <div id={`${id}-x`} className="rtm-dialogo-texto">{children}</div>
      <div className="rtm-dialogo-acciones">
        <button type="button" className="rtm-boton" autoFocus onClick={onCancelar} disabled={ocupado}>{cancelar}</button>
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={onConfirmar} disabled={ocupado} data-testid="confirmar">{ocupado ? 'Guardando' : confirmar}</button>
      </div>
    </dialog>
  );
}
