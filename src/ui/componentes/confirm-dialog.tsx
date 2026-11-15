'use client';

import type { ReactNode } from 'react';
import { DialogoEnterprise, type PropsHoja } from './dialogo-enterprise';

interface Props extends Partial<Omit<PropsHoja, 'children' | 'abierto' | 'titulo' | 'confirmar' | 'onConfirmar' | 'onCancelar'>> {
  abierto: boolean;
  titulo: string;
  children: ReactNode;
  confirmar: string;
  cancelar?: string;
  ocupado?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

/** Confirmacion propia (nunca window.confirm): evolucion del dialogo simple a la hoja enterprise (DialogoEnterprise) con las mismas firmas.
 *  <dialog> modal con foco atrapado, Esc y clic fuera cierran (con confirmacion si hay cambios), y la accion segura enfocada primero cuando no hay campos. */
export function ConfirmDialog(props: Props) {
  return <DialogoEnterprise {...props} />;
}
