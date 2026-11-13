'use client';

import { useState } from 'react';
import { useAccion } from '../../../operacion/usar-accion';

/** Registra (o corrige) el folio del proveedor, por ejemplo el número de pedido de Karen. Único por proveedor. */
export function RegistrarFolio({ pedidoId, actual }: { pedidoId: number; actual: string | null }) {
  const { correr, ocupado, error } = useAccion();
  const [v, setV] = useState(actual ?? '');
  const [local, setLocal] = useState<string | null>(null);
  return (
    <div className="rtm-form-fila">
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Folio del proveedor<input className="rtm-campo" value={v} onChange={(e) => setV(e.target.value)} data-testid="folio-externo-campo" placeholder="73266" /></label>
      <button type="button" className="rtm-boton" disabled={ocupado} data-testid="folio-externo-guardar" onClick={() => { if (!v.trim()) return setLocal('Escribe el folio que te dio el proveedor.'); setLocal(null); correr('ds_registrar_folio', { p_pedido: pedidoId, p_folio_externo: v.trim() }); }}>{ocupado ? 'Guardando' : actual ? 'Corregir folio' : 'Registrar folio'}</button>
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
    </div>
  );
}

/** Pasos del pedido: confirmar (reserva nada: es directo) y marcar enviado cuando el proveedor lo despachó. Los avisos se aceptan expresamente. */
export function PasosPedido({ pedidoId, estado, avisos }: { pedidoId: number; estado: string; avisos: number }) {
  const { correr, ocupado, error } = useAccion();
  const [acepto, setAcepto] = useState(false);
  const [guia, setGuia] = useState('');
  const [costoGuia, setCostoGuia] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  if (estado === 'borrador') {
    return <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado} onClick={() => correr('confirmar_pedido', { p_pedido: pedidoId })} data-testid="ds-confirmar">{ocupado ? 'Confirmando' : 'Confirmar pedido'}</button>;
  }
  if (estado !== 'confirmado') return null;
  return (
    <div className="rtm-form">
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo">Guía (opcional)<input className="rtm-campo" value={guia} onChange={(e) => setGuia(e.target.value)} data-testid="ds-guia" /></label>
        <label className="rtm-etiqueta-campo">Costo de la guía (opcional)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={costoGuia} onChange={(e) => setCostoGuia(e.target.value)} data-testid="ds-guia-costo" /></label>
      </div>
      {avisos > 0 && <label className="rtm-etiqueta-campo"><span><input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} data-testid="ds-acepto-avisos" /> Acepto los {avisos} avisos del pedido (enviar de todos modos)</span></label>}
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="ds-enviado" onClick={() => {
        if (avisos > 0 && !acepto) return setLocal('Acepta los avisos para enviar de todos modos.');
        setLocal(null);
        const costo = costoGuia.trim() ? Math.round(Number(costoGuia.replace(/,/g, '')) * 100) : null;
        correr('enviar_pedido', { p_pedido: pedidoId, p_aceptar_avisos: acepto, ...(guia.trim() ? { p_guia: { paqueteria: 'Proveedor', numero: guia.trim(), ...(costo !== null && Number.isFinite(costo) ? { costo_cent: costo } : {}) } } : {}) });
      }}>{ocupado ? 'Guardando' : 'Marcar enviado por el proveedor'}</button>
    </div>
  );
}
