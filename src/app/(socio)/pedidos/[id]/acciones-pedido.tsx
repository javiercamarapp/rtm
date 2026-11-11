'use client';

import { useState } from 'react';
import { formatearMoneda } from '@/dominio/formato';
import type { EstadoPedido } from '@/dominio/operacion/tipos';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { DialogoEnviar, type RenglonEnvio } from '../../operacion/dialogo-enviar';
import { BotonAccion, DialogoSimple } from '../../operacion/dialogo-simple';
import { centavosDeTexto, useAccion } from '../../operacion/usar-accion';

interface Props {
  pedidoId: number;
  folio: string;
  clienteId: number;
  estado: EstadoPedido;
  empacado: boolean;
  entregado: boolean;
  puedeEmpacar: boolean;
  avisosPendientes: number;
  renglones: RenglonEnvio[];
  lineasNota: { id: number; etiqueta: string; precio_cent: bigint }[];
  cuentas: string[];
  saldoCent: bigint | null;
}

function Pago({ pedidoId, folio, clienteId, cuentas }: Pick<Props, 'pedidoId' | 'folio' | 'clienteId' | 'cuentas'>) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [cuenta, setCuenta] = useState(cuentas[0] ?? 'Angelo');
  const [monto, setMonto] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    const c = centavosDeTexto(monto);
    if (c === null || c === 0) return setLocal('Escribe el monto del pago, por ejemplo 9000 o 9,000.50.');
    setLocal(null);
    correr('registrar_pago', { p_cuenta: cuenta, p_monto_cent: c, p_cliente_id: clienteId, p_pedidos: [{ pedido_id: pedidoId, monto_cent: c }] }, () => { setAbierto(false); setMonto(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="registrar-pago">Registrar pago</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Registrar pago de ${folio}`} confirmar="Registrar pago" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p>Elige a qué cuenta cayó el dinero. Si cayó en la cuenta de un socio, el dinero es de la sociedad y queda como deuda de ese socio hasta que lo entregue.</p>
          <label className="rtm-etiqueta-campo">Cuenta destino
            <select className="rtm-campo" value={cuenta} onChange={(e) => setCuenta(e.target.value)} data-testid="pago-cuenta">{cuentas.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label className="rtm-etiqueta-campo">Monto
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} data-testid="pago-monto" />
          </label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

function CorreccionNota({ pedidoId, folio, lineasNota }: Pick<Props, 'pedidoId' | 'folio' | 'lineasNota'>) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [envio, setEnvio] = useState('');
  const [descuento, setDescuento] = useState('');
  const [recargo, setRecargo] = useState('');
  const [precios, setPrecios] = useState<Record<number, string>>({});
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    if (motivo.trim() === '') return setLocal('Escribe el motivo de la corrección.');
    const cambios: Record<string, number> = {};
    for (const l of lineasNota) {
      const t = precios[l.id];
      if (t === undefined || t.trim() === '') continue;
      const c = centavosDeTexto(t);
      if (c === null || c === 0) return setLocal(`El precio de ${l.etiqueta} no es válido.`);
      if (BigInt(c) !== l.precio_cent) cambios[String(l.id)] = c;
    }
    const num = (t: string) => (t.trim() === '' ? undefined : centavosDeTexto(t));
    const e = num(envio), d = num(descuento), r = num(recargo);
    if (e === null || d === null || r === null) return setLocal('Revisa envío, descuento y recargo.');
    if (Object.keys(cambios).length === 0 && e === undefined && d === undefined && r === undefined) return setLocal('No indicaste ningún cambio.');
    setLocal(null);
    correr('emitir_correccion', { p_pedido: pedidoId, p_motivo: motivo.trim(), p_precios: Object.keys(cambios).length ? cambios : null, p_envio_cent: e ?? null, p_descuento_cent: d ?? null, p_recargo_cent: r ?? null }, () => setAbierto(false));
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setAbierto(true); }} data-testid="corregir-nota">Emitir corrección</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Corregir la nota de ${folio}`} confirmar="Emitir corrección" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p>La nota emitida no se edita: la corrección es un documento nuevo enlazado (P-xxxx-C1). Deja en blanco lo que no cambia.</p>
          <label className="rtm-etiqueta-campo">Motivo<input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo de la corrección" /></label>
          <div className="rtm-form-fila">
            <label className="rtm-etiqueta-campo">Envío nuevo<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={envio} onChange={(e) => setEnvio(e.target.value)} aria-label="Envío nuevo" /></label>
            <label className="rtm-etiqueta-campo">Descuento nuevo<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} /></label>
            <label className="rtm-etiqueta-campo">Recargo nuevo<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={recargo} onChange={(e) => setRecargo(e.target.value)} /></label>
          </div>
          {lineasNota.map((l) => (
            <label key={l.id} className="rtm-etiqueta-campo">Precio de {l.etiqueta} (hoy {formatearMoneda(l.precio_cent)})
              <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={precios[l.id] ?? ''} onChange={(e) => setPrecios((p) => ({ ...p, [l.id]: e.target.value }))} aria-label={`Precio nuevo de ${l.etiqueta}`} />
            </label>
          ))}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

function Plazo({ pedidoId }: { pedidoId: number }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [dias, setDias] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    const n = Number(dias);
    if (!Number.isInteger(n) || n < 0 || n > 365) return setLocal('Los días deben ser un entero entre 0 y 365.');
    setLocal(null);
    correr('acordar_plazo', { p_pedido: pedidoId, p_dias: n }, () => setAbierto(false));
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setAbierto(true); }}>Acordar plazo</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo="Acordar plazo de pago" confirmar="Guardar plazo" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Plazo en días desde el envío<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} aria-label="Plazo en días" /></label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

export function AccionesPedido(p: Props) {
  return (
    <div className="rtm-acciones-fila" aria-label="Acciones del pedido">
      {p.estado === 'borrador' && <BotonAccion boton="Confirmar pedido" accion="confirmar_pedido" args={{ p_pedido: p.pedidoId }} primario testid="confirmar-pedido" />}
      {p.estado === 'confirmado' && p.puedeEmpacar && !p.empacado && <BotonAccion boton="Marcar empacado" accion="marcar_empacado" args={{ p_pedido: p.pedidoId }} testid="marcar-empacado" />}
      {p.estado === 'confirmado' && <DialogoEnviar pedidoId={p.pedidoId} folio={p.folio} renglones={p.renglones} avisosPendientes={p.avisosPendientes} />}
      {(p.estado === 'borrador' || p.estado === 'confirmado') && (
        <DialogoSimple boton="Cancelar pedido" titulo={`Cancelar ${p.folio}`} accion="cancelar_pedido" args={{ p_pedido: p.pedidoId }} motivo="p_motivo" texto={<p>Libera las reservas. Todavía no salió nada, así que no hay nada que revertir.</p>} />
      )}
      {p.estado === 'enviado' && (
        <>
          <Pago pedidoId={p.pedidoId} folio={p.folio} clienteId={p.clienteId} cuentas={p.cuentas} />
          <CorreccionNota pedidoId={p.pedidoId} folio={p.folio} lineasNota={p.lineasNota} />
          <Plazo pedidoId={p.pedidoId} />
          {!p.entregado && <BotonAccion boton="Marcar entregado" accion="marcar_entregado" args={{ p_pedido: p.pedidoId }} />}
          <DialogoSimple boton="Anular pedido" titulo={`Anular ${p.folio}`} accion="anular_pedido" args={{ p_pedido: p.pedidoId }} motivo="p_motivo" testid="anular-pedido"
            texto={<p>Anular es un contramovimiento: regresan las piezas, se revierte la renta y los pagos aplicados quedan como saldo a favor. La nota original no se toca.</p>} />
        </>
      )}
      {p.saldoCent !== null && p.saldoCent !== 0n && p.estado === 'enviado' && <span className="rtm-nota">Saldo: {formatearMoneda(p.saldoCent)}</span>}
    </div>
  );
}

