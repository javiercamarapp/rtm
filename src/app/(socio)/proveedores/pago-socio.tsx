'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';

/** Un socio paga a un proveedor desde su cuenta: sube el saldo a favor. Con "auto" baja primero lo que ese socio debe a la sociedad; el resto es aportación. */
export function PagoSocioProveedor({ proveedor }: { proveedor: string }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [socio, setSocio] = useState('Angelo');
  const [monto, setMonto] = useState('');
  const [fuente, setFuente] = useState('auto');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    const c = centavosDeTexto(monto);
    if (c === null || c === 0) return setLocal('Escribe el monto, por ejemplo 9000 o 9,000.50.');
    setLocal(null);
    correr('pago_proveedor_de_socio', { p_proveedor: proveedor, p_monto_cent: c, p_socio: socio, p_fuente: fuente }, () => { setAbierto(false); setMonto(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="pago-socio">Registrar pago de un socio</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Pago de un socio a ${proveedor}`} confirmar="Registrar pago" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Socio que pagó
            <select className="rtm-campo" value={socio} onChange={(e) => setSocio(e.target.value)} aria-label="Socio que pagó"><option>Angelo</option><option>Javier</option></select>
          </label>
          <label className="rtm-etiqueta-campo">Monto<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Monto del pago" /></label>
          <label className="rtm-etiqueta-campo">Con qué dinero
            <select className="rtm-campo" value={fuente} onChange={(e) => setFuente(e.target.value)} aria-label="Con qué dinero">
              <option value="auto">Automático: primero lo que debe a la sociedad, el resto es aportación</option>
              <option value="fondos_sociedad">Solo fondos de la sociedad que tiene en su poder</option>
              <option value="aportacion">Dinero propio (aportación de capital)</option>
            </select>
          </label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
