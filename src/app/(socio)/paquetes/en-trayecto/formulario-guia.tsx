'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { useAccion } from '../../operacion/usar-accion';

/** Registra una guía de rastreo de una orden de compra (puede haber varias por orden). */
export function FormularioGuia({ compraId, folio, variante }: { compraId: number; folio: string; variante?: 'boton' | 'item' }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [paqueteria, setPaqueteria] = useState('');
  const [numero, setNumero] = useState('');
  const [llegada, setLlegada] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    if (!numero.trim()) return setLocal('Escribe el número de guía.');
    if (llegada && !/^\d{4}-\d{2}-\d{2}$/.test(llegada)) return setLocal('La llegada estimada debe ser una fecha.');
    setLocal(null);
    correr('registrar_guia_compra', { p_compra: compraId, p_paqueteria: paqueteria.trim() || 'Paquetería', p_numero: numero.trim(), p_llegada_estimada: llegada || null }, () => { setAbierto(false); setNumero(''); });
  };
  return (
    <>
      <button type="button" className={variante === 'item' ? 'rtm-boton-item' : 'rtm-boton rtm-boton-chico'} onClick={() => { limpiarError(); setAbierto(true); }} data-testid={`guia-${compraId}`}>Registrar guía</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Registrar guía de ${folio}`} confirmar="Registrar guía" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Paquetería<input className="rtm-campo" value={paqueteria} onChange={(e) => setPaqueteria(e.target.value)} placeholder="Castores" /></label>
          <label className="rtm-etiqueta-campo">Guía<input className="rtm-campo" value={numero} onChange={(e) => setNumero(e.target.value)} aria-label="Número de guía" /></label>
          <label className="rtm-etiqueta-campo">Llegada estimada<input className="rtm-campo" type="date" value={llegada} onChange={(e) => setLlegada(e.target.value)} /></label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
