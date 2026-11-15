'use client';

import { useState } from 'react';
import { TarjetaWhatsApp } from '@/ui/componentes/tarjeta-whatsapp';
import { textoOrdenAccion } from './acciones';

/**
 * Orden para el proveedor (por ejemplo Karen). La vista previa va con telefono y correo enmascarados; "Copiar orden" entrega el texto completo
 * (queda auditado) y lo copia. El sistema NO escribe a Karen ni a clientes: el socio la pega y la envía él mismo.
 */
export function PanelOrden({ pedidoId, proveedor, vistaPrevia, faltaDestinatario }: { pedidoId: number; proveedor: string; vistaPrevia: string; faltaDestinatario: boolean }) {
  const [completo, setCompleto] = useState<string | null>(null);
  // El texto completo (con el bloque del destinatario) se pide al servidor al copiar y queda auditado; mientras tanto solo se ve la vista previa enmascarada.
  const obtenerCompleto = async () => {
    const r = await textoOrdenAccion(pedidoId, true);
    if (!r.ok) return null;
    setCompleto(r.texto);
    return r.texto;
  };
  return (
    <div className="rtm-copiar" data-testid="panel-orden">
      <TarjetaWhatsApp titulo={`Enviar orden a ${proveedor}`} mensaje={completo ?? vistaPrevia} obtenerCompleto={obtenerCompleto} etiquetaCopiar={`Copiar orden para ${proveedor}`} testidMensaje="orden-texto" testidCopiar="copiar-orden" />
      {faltaDestinatario && <p className="rtm-nota">Falta capturar el destinatario: la orden saldrá sin bloque de entrega.</p>}
      <p className="rtm-nota">El sistema no envía nada: copia la orden y mándala tú a {proveedor}. Copiarla con el bloque completo queda registrado.</p>
    </div>
  );
}
