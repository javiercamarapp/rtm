'use client';

import { useState, useTransition } from 'react';
import { TarjetaWhatsApp } from '@/ui/componentes/tarjeta-whatsapp';
import { notaProveedorAccion, textoCobroAccion } from './lecturas';

type Fuente = { tipo: 'cobro'; clienteId: number } | { tipo: 'proveedor'; proveedor: string; semana: string; ambito: 'sociedad' | 'todo' };

/** Pide el texto ya redactado por la base y lo muestra en la tarjeta de WhatsApp (copiar, abrir WhatsApp). Nada se envia a nadie: el agente nunca escribe a clientes ni a proveedores. */
export function CopiarTexto({ etiqueta, fuente, chico }: { etiqueta: string; fuente: Fuente; chico?: boolean }) {
  const [texto, setTexto] = useState<string | null | undefined>(undefined);
  const [ocupado, empezar] = useTransition();
  const pedir = () => empezar(async () => {
    const t = fuente.tipo === 'cobro' ? await textoCobroAccion(fuente.clienteId) : await notaProveedorAccion(fuente.proveedor, fuente.semana, fuente.ambito);
    setTexto(t);
  });
  return (
    <span className="rtm-copiar">
      <button type="button" className={`rtm-boton${chico ? ' rtm-boton-chico' : ''}`} onClick={pedir} disabled={ocupado} data-testid="copiar-texto">{ocupado ? 'Preparando' : etiqueta}</button>
      {texto === null && <span className="rtm-nota" role="status">No hay saldo por cobrar para este texto.</span>}
      {texto && <TarjetaWhatsApp titulo={fuente.tipo === 'cobro' ? 'Enviar cobro por WhatsApp' : 'Enviar nota por WhatsApp'} mensaje={texto} testidMensaje="texto-copiable" testidCopiar="copiar-mensaje" />}
    </span>
  );
}
