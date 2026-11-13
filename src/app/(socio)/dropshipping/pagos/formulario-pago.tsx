'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../../operacion/usar-accion';
import { FUENTE_PAGO } from '../comun';

interface Opcion { id: number; texto: string }

/** Pago al proveedor, entero o parcial (amortización de un pedido). El dinero propio de un socio es REEMBOLSO salvo que declare expresamente que es capital. */
export function FormularioPagoProveedor({ proveedor, pedidos, clientes }: { proveedor: string; pedidos: Opcion[]; clientes: Opcion[] }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [fuente, setFuente] = useState('sociedad');
  const [socio, setSocio] = useState('Angelo');
  const [cliente, setCliente] = useState('');
  const [pedido, setPedido] = useState('');
  const [monto, setMonto] = useState('');
  const [declara, setDeclara] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const esSocio = fuente.startsWith('socio_');
  const ir = () => {
    const c = centavosDeTexto(monto);
    if (c === null || c === 0) return setLocal('Escribe el monto, por ejemplo 9000 o 9,000.50.');
    if (fuente === 'socio_capital' && !declara) return setLocal('Para registrarlo como capital el socio debe declararlo marcando la casilla.');
    if (fuente === 'cliente_a_proveedor' && !cliente) return setLocal('Elige el cliente que pagó al proveedor.');
    setLocal(null);
    correr('ds_pagar_proveedor', { p_proveedor: proveedor, p_monto_cent: c, p_fuente: fuente, p_socio: esSocio ? socio : null, p_cliente_id: fuente === 'cliente_a_proveedor' ? Number(cliente) : null, p_pedido: pedido ? Number(pedido) : null },
      () => { setAbierto(false); setMonto(''); setDeclara(false); });
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-primario" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="ds-nuevo-pago">Registrar pago a {proveedor}</button>
      {abierto && (
        <ConfirmDialog abierto titulo={`Pago a ${proveedor}`} confirmar="Registrar pago" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">De dónde sale el dinero
            <select className="rtm-campo" value={fuente} onChange={(e) => { setFuente(e.target.value); setDeclara(false); }} data-testid="ds-pago-fuente">
              {Object.entries(FUENTE_PAGO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {esSocio && <label className="rtm-etiqueta-campo">Socio<select className="rtm-campo" value={socio} onChange={(e) => setSocio(e.target.value)} data-testid="ds-pago-socio"><option>Angelo</option><option>Javier</option></select></label>}
          {fuente === 'cliente_a_proveedor' && <label className="rtm-etiqueta-campo">Cliente<select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="ds-pago-cliente"><option value="">Elige un cliente</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.texto}</option>)}</select></label>}
          <label className="rtm-etiqueta-campo">Pedido que amortiza (opcional)
            <select className="rtm-campo" value={pedido} onChange={(e) => setPedido(e.target.value)} data-testid="ds-pago-pedido"><option value="">A cuenta, sin pedido</option>{pedidos.map((p) => <option key={p.id} value={p.id}>{p.texto}</option>)}</select>
          </label>
          <label className="rtm-etiqueta-campo">Monto<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} data-testid="ds-pago-monto" /></label>
          {fuente === 'socio_capital' && <label className="rtm-etiqueta-campo"><span><input type="checkbox" checked={declara} onChange={(e) => setDeclara(e.target.checked)} data-testid="ds-pago-declara" /> El socio declara que este dinero es capital (inversión), no reembolso</span></label>}
          {fuente === 'socio_propio' && <p className="rtm-nota">El dinero propio de un socio queda como reembolso (cuenta por pagar al socio) salvo que declare que invierte.</p>}
          {fuente === 'cliente_a_proveedor' && <p className="rtm-nota">Baja lo que debe el cliente y sube el saldo a favor con {proveedor}; lo que exceda el costo es utilidad reinvertida.</p>}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
