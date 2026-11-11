'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../../operacion/usar-accion';

/** Lo que dice el proveedor: total y, si lo trae, un renglón por línea ("P-0012 9430"). Se compara en la base; aquí solo se capturan los textos. */
export function FormularioDicho({ proveedor, semana, ambito }: { proveedor: string; semana: string; ambito: 'sociedad' | 'todo' }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [total, setTotal] = useState('');
  const [lineas, setLineas] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    const t = centavosDeTexto(total);
    if (t === null) return setLocal('Escribe el total que dice el proveedor, por ejemplo 41000.');
    const rengs: { folio: string; monto_cent: number }[] = [];
    for (const l of lineas.split('\n').map((x) => x.trim()).filter(Boolean)) {
      const m = /^(\S+)\s+([\d.,]+)$/.exec(l);
      const c = m ? centavosDeTexto(m[2]!) : null;
      if (!m || c === null) return setLocal(`No entendí la línea "${l}": escribe el folio, un espacio y el monto.`);
      rengs.push({ folio: m[1]!, monto_cent: c });
    }
    setLocal(null);
    correr('registrar_dicho_proveedor', { p_proveedor: proveedor, p_semana_ini: semana, p_ambito: ambito, p_total_cent: t, p_renglones: rengs }, () => { setAbierto(false); setTotal(''); setLineas(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="registrar-dicho">Registrar lo que dice {proveedor}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Lo que dice ${proveedor}`} confirmar="Guardar y comparar" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Total que falta según el proveedor
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="dicho-total" />
          </label>
          <label className="rtm-etiqueta-campo">Renglones (opcional, uno por línea: folio y monto)
            <textarea className="rtm-campo" rows={4} value={lineas} onChange={(e) => setLineas(e.target.value)} data-testid="dicho-renglones" />
          </label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
