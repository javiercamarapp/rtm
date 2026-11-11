'use client';

import { useState, useTransition } from 'react';
import { notaProveedorAccion, textoCobroAccion } from './lecturas';

type Fuente = { tipo: 'cobro'; clienteId: number } | { tipo: 'proveedor'; proveedor: string; semana: string; ambito: 'sociedad' | 'todo' };

/** Pide el texto ya redactado por la base, lo muestra y lo copia. Nada se envia a nadie: el agente nunca escribe a clientes ni a proveedores. */
export function CopiarTexto({ etiqueta, fuente, chico }: { etiqueta: string; fuente: Fuente; chico?: boolean }) {
  const [texto, setTexto] = useState<string | null | undefined>(undefined);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, empezar] = useTransition();
  const pedir = () => empezar(async () => {
    const t = fuente.tipo === 'cobro' ? await textoCobroAccion(fuente.clienteId) : await notaProveedorAccion(fuente.proveedor, fuente.semana, fuente.ambito);
    setTexto(t);
    setCopiado(false);
    if (t) { try { await navigator.clipboard.writeText(t); setCopiado(true); } catch { /* sin permiso: queda el texto a la vista */ } }
  });
  return (
    <span className="rtm-copiar">
      <button type="button" className={`rtm-boton${chico ? ' rtm-boton-chico' : ''}`} onClick={pedir} disabled={ocupado} data-testid="copiar-texto">{ocupado ? 'Preparando' : etiqueta}</button>
      {texto === null && <span className="rtm-nota" role="status">No hay saldo por cobrar para este texto.</span>}
      {texto && (
        <>
          <pre className="rtm-texto-copiable" data-testid="texto-copiable">{texto}</pre>
          {copiado && <span className="rtm-copia-ok" role="status">Copiado</span>}
        </>
      )}
    </span>
  );
}
