'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';

/**
 * Un socio paga a un proveedor desde su cuenta: sube el saldo a favor. Con "auto" baja primero lo que ese socio debe a la sociedad.
 * Regla del dueño: el dinero propio del socio es REEMBOLSO (cuenta por pagar al socio) por omisión; es aportación de capital SOLO si el socio
 * lo declara expresamente (casilla con texto de confirmación). Nunca se marca capital por defecto.
 */
export const TEXTO_CAPITAL = 'El socio declara que este dinero es una aportación de capital: reinvierte, invierte o mete más lana a la sociedad.';

export function PagoSocioProveedor({ proveedor }: { proveedor: string }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [socio, setSocio] = useState('Angelo');
  const [monto, setMonto] = useState('');
  const [fuente, setFuente] = useState('auto');
  const [capital, setCapital] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const hayDineroPropio = fuente !== 'fondos_sociedad';
  const cerrar = () => { setAbierto(false); setLocal(null); setCapital(false); limpiarError(); };
  const ir = () => {
    const c = centavosDeTexto(monto);
    if (c === null || c === 0) return setLocal('Escribe el monto, por ejemplo 9000 o 9,000.50.');
    setLocal(null);
    correr('pago_proveedor_de_socio', { p_proveedor: proveedor, p_monto_cent: c, p_socio: socio, p_fuente: fuente, p_declara_capital: hayDineroPropio && capital }, () => { setAbierto(false); setMonto(''); setCapital(false); });
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="pago-socio">Registrar pago de un socio</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Pago de un socio a ${proveedor}`} confirmar="Registrar pago" ocupado={ocupado} onConfirmar={ir} onCancelar={cerrar}>
          <label className="rtm-etiqueta-campo">Socio que pagó
            <select className="rtm-campo" value={socio} onChange={(e) => setSocio(e.target.value)} aria-label="Socio que pagó"><option>Angelo</option><option>Javier</option></select>
          </label>
          <label className="rtm-etiqueta-campo">Monto<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Monto del pago" /></label>
          <label className="rtm-etiqueta-campo">Con qué dinero
            <select className="rtm-campo" value={fuente} onChange={(e) => setFuente(e.target.value)} aria-label="Con qué dinero">
              <option value="auto">Automático: primero lo que debe a la sociedad, el resto es dinero propio (reembolso)</option>
              <option value="fondos_sociedad">Solo fondos de la sociedad que tiene en su poder</option>
              <option value="dinero_propio">Dinero propio (reembolso: la sociedad se lo debe al socio)</option>
            </select>
          </label>
          {hayDineroPropio && (
            <>
              <p className="rtm-nota">El dinero propio queda como reembolso: una cuenta por pagar al socio que la sociedad le devuelve. No es capital salvo que el socio lo declare.</p>
              <label className="rtm-etiqueta-campo">
                <input type="checkbox" checked={capital} onChange={(e) => setCapital(e.target.checked)} aria-label="Declarar aportación de capital" data-testid="declara-capital" /> {TEXTO_CAPITAL}
              </label>
              {capital && <p className="rtm-nota" role="status" data-testid="aviso-capital">Se registrará como aportación de capital, no como reembolso. Confírmalo solo si el socio lo declaró expresamente.</p>}
            </>
          )}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
