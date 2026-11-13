'use client';

import { useState, useTransition } from 'react';
import { textoOrdenAccion } from './acciones';

/**
 * Orden para el proveedor (por ejemplo Karen). La vista previa va con telefono y correo enmascarados; "Copiar orden" entrega el texto completo
 * (queda auditado) y lo copia. El sistema NO escribe a Karen ni a clientes: el socio la pega y la envía él mismo.
 */
export function PanelOrden({ pedidoId, proveedor, vistaPrevia, faltaDestinatario }: { pedidoId: number; proveedor: string; vistaPrevia: string; faltaDestinatario: boolean }) {
  const [ocupado, empezar] = useTransition();
  const [estado, setEstado] = useState<'inicial' | 'copiado' | 'manual' | 'error'>('inicial');
  const [completo, setCompleto] = useState<string | null>(null);
  const copiar = () => empezar(async () => {
    const r = await textoOrdenAccion(pedidoId, true);
    if (!r.ok) { setEstado('error'); return; }
    setCompleto(r.texto);
    try { await navigator.clipboard.writeText(r.texto); setEstado('copiado'); } catch { setEstado('manual'); }
  });
  return (
    <div className="rtm-copiar" data-testid="panel-orden">
      <pre className="rtm-texto-copiable" data-testid="orden-texto">{completo ?? vistaPrevia}</pre>
      <span className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={copiar} disabled={ocupado} data-testid="copiar-orden">{ocupado ? 'Preparando' : `Copiar orden para ${proveedor}`}</button>
        {estado === 'copiado' && <span className="rtm-copia-ok" role="status" data-testid="orden-copiada">Copiada con el bloque completo del destinatario</span>}
        {estado === 'manual' && <span className="rtm-nota" role="status">No se pudo usar el portapapeles: selecciona el texto y cópialo a mano.</span>}
        {estado === 'error' && <span className="rtm-error" role="alert">No se pudo armar la orden. Intenta de nuevo.</span>}
      </span>
      {faltaDestinatario && <p className="rtm-nota">Falta capturar el destinatario: la orden saldrá sin bloque de entrega.</p>}
      <p className="rtm-nota">El sistema no envía nada: copia la orden y mándala tú a {proveedor}. Copiarla con el bloque completo queda registrado.</p>
    </div>
  );
}
