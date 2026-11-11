'use client';

import { useState } from 'react';

/** Copia el texto de WhatsApp al portapapeles. El software nunca escribe a clientes: la persona pega y envia. */
export function BotonCopiar({ texto, etiqueta = 'Copiar para WhatsApp', testid = 'copiar-texto' }: { texto: string; etiqueta?: string; testid?: string }) {
  const [estado, setEstado] = useState<'inicial' | 'copiado' | 'error'>('inicial');
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado('copiado');
    } catch {
      setEstado('error');
    }
  };
  return (
    <span className="rtm-acciones-fila">
      <button type="button" className="rtm-boton" onClick={copiar} data-testid={testid}>{etiqueta}</button>
      {estado === 'copiado' && <span className="rtm-copia-ok" role="status">Copiado</span>}
      {estado === 'error' && <span className="rtm-error" role="alert">No se pudo copiar: selecciona el texto y cópialo a mano.</span>}
    </span>
  );
}
