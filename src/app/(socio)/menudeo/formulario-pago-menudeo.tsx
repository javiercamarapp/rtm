'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';

/** Pago de un pedido a costo: el socio paga como cliente, directo al proveedor con su dinero o como abono a la sociedad. Lo marca pagado y lo quita de pendientes; no toca su aportación. */
export function PagarPedidoMenudeo({ pedidoId, folio, proveedor, pendienteTexto }: { pedidoId: number; folio: string; proveedor: string; pendienteTexto: string }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [via, setVia] = useState('proveedor');
  const [monto, setMonto] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    const c = monto.trim() ? centavosDeTexto(monto) : null;
    if (monto.trim() && (c === null || c === 0)) return setLocal('Escribe un monto como 9000 o 9,000.50, o déjalo vacío para pagar todo lo pendiente.');
    setLocal(null);
    correr('ds_pagar_pedido_menudeo', { p_pedido: pedidoId, p_via: via, p_monto_cent: c }, () => { setAbierto(false); setMonto(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { limpiarError(); setAbierto(true); }} data-testid={`pagar-menudeo-${pedidoId}`}>Registrar pago</button>
      {abierto && (
        <ConfirmDialog abierto titulo={`Pago del pedido ${folio}`} confirmar="Registrar pago" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p className="rtm-nota">Pendiente de pago: {pendienteTexto}.</p>
          <label className="rtm-etiqueta-campo">Cómo se paga
            <select className="rtm-campo" value={via} onChange={(e) => setVia(e.target.value)} data-testid="menudeo-via">
              <option value="proveedor">Pago directo a {proveedor} con su dinero</option>
              <option value="sociedad">Abono a la sociedad</option>
            </select>
          </label>
          <label className="rtm-etiqueta-campo">Monto (vacío = todo lo pendiente)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} data-testid="menudeo-monto" /></label>
          <p className="rtm-nota">El pago se aplica a este pedido. No cambia la aportación neta ni la valuación del socio.</p>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
