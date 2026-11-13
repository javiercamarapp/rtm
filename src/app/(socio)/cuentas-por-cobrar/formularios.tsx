'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';

interface ClienteOpcion { id: number; nombre: string }

/** Registrar el pago de un cliente con su cuenta destino. Sin cliente queda "sin identificar" y no se aplica a ningún pedido. */
export function FormularioPago({ cuentas, clientes }: { cuentas: string[]; clientes: ClienteOpcion[] }) {
  const { correr, ocupado, error, codigo, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [confirmoExceso, setConfirmoExceso] = useState(false);
  const [cliente, setCliente] = useState('');
  const [cuenta, setCuenta] = useState(cuentas[0] ?? 'Angelo');
  const [monto, setMonto] = useState('');
  const [tipo, setTipo] = useState('abono');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    const c = centavosDeTexto(monto);
    if (c === null || c === 0) return setLocal('Escribe el monto, por ejemplo 9000 o 9,000.50.');
    setLocal(null);
    correr('registrar_pago', { p_cuenta: cuenta, p_monto_cent: c, p_cliente_id: cliente ? Number(cliente) : null, p_tipo: tipo, p_aplicar: tipo !== 'anticipo', p_confirmo_exceso: confirmoExceso }, () => { setAbierto(false); setMonto(''); setConfirmoExceso(false); });
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-primario" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="nuevo-pago">Registrar pago</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo="Registrar pago de un cliente" confirmar="Registrar pago" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Cliente
            <select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="pago-cliente">
              <option value="">Sin identificar todavía</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="rtm-etiqueta-campo">Cuenta a la que llegó
            <select className="rtm-campo" value={cuenta} onChange={(e) => setCuenta(e.target.value)} data-testid="pago-cuenta">{cuentas.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label className="rtm-etiqueta-campo">Monto<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} data-testid="pago-monto" /></label>
          <label className="rtm-etiqueta-campo">Tipo
            <select className="rtm-campo" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="abono">Abono a lo que debe</option><option value="anticipo">Anticipo (queda a su favor)</option><option value="pago_faltante_credito">Pago de faltante a crédito</option></select>
          </label>
          <p className="rtm-nota">Si eliges la cuenta de Angelo o de Javier, el dinero es de la sociedad: queda como deuda de ese socio hasta que lo entregue. Si eliges Isaac o Karen, sube el saldo a favor de la sociedad con ese proveedor.</p>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
          {codigo === 'P0429' && (
            <label className="rtm-casilla" data-testid="pago-confirmo-exceso">
              <input type="checkbox" checked={confirmoExceso} onChange={(e) => setConfirmoExceso(e.target.checked)} />
              <span>Confirmo que el excedente es un anticipo a favor del cliente.</span>
            </label>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

export function IdentificarPago({ pagoId, clientes }: { pagoId: number; clientes: ClienteOpcion[] }) {
  const { correr, ocupado, error } = useAccion();
  const [cliente, setCliente] = useState('');
  return (
    <span className="rtm-acciones-fila">
      <select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente del pago" data-testid={`identificar-${pagoId}`}>
        <option value="">Elige un cliente</option>
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado || cliente === ''} onClick={() => correr('identificar_pago', { p_pago: pagoId, p_cliente: Number(cliente) })}>{ocupado ? 'Guardando' : 'Identificar'}</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </span>
  );
}

/** El socio entrega a la sociedad (o a otro socio) lo que tiene en su poder. */
export function EntregaSocio({ socio }: { socio: string }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState('');
  const [destino, setDestino] = useState('sociedad');
  const [local, setLocal] = useState<string | null>(null);
  const otro = socio === 'Angelo' ? 'Javier' : 'Angelo';
  const ir = () => {
    const c = centavosDeTexto(monto);
    if (c === null || c === 0) return setLocal('Escribe el monto de la entrega.');
    setLocal(null);
    correr('registrar_entrega_socio', { p_socio: socio, p_monto_cent: c, p_destino: destino === 'sociedad' ? 'sociedad' : 'otro_socio', p_socio_destino: destino === 'sociedad' ? null : otro, p_aplica_a: 'general' }, () => { setAbierto(false); setMonto(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { limpiarError(); setAbierto(true); }} data-testid={`entrega-${socio}`}>Registrar entrega</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Entrega de ${socio}`} confirmar="Registrar entrega" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Monto entregado<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Monto entregado" /></label>
          <label className="rtm-etiqueta-campo">Se lo entrega a
            <select className="rtm-campo" value={destino} onChange={(e) => setDestino(e.target.value)}><option value="sociedad">La sociedad</option><option value="otro">{otro} (queda en su poder)</option></select>
          </label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
