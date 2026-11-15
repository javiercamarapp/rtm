'use client';

import { useState } from 'react';
import { armarDevolucionCliente, type DestinoDevolucion } from '@/dominio/operacion/devoluciones';
import { formatearMoneda, formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import type { PedidoDevoluciones } from '@/dominio/operacion/tipos';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { DialogoSimple } from '../../operacion/dialogo-simple';
import { useAccion } from '../../operacion/usar-accion';

/** Devolver mercancía de un pedido enviado: piezas por sabor (con tope en lo surtido menos lo ya devuelto), destino y motivo. El crédito lo calcula la base. */
export function DevolverMercancia({ pedidoId, folio, renglones }: { pedidoId: number; folio: string; renglones: PedidoDevoluciones['renglones'] }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [piezas, setPiezas] = useState<Record<string, string>>({});
  const [destinos, setDestinos] = useState<Record<string, DestinoDevolucion>>({});
  const [motivo, setMotivo] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const llave = (r: { linea_id: number; sku_id: number }) => `${r.linea_id}:${r.sku_id}`;
  const posibles = renglones.filter((r) => r.disponibles_devolver > 0);

  const ir = () => {
    if (motivo.trim() === '') return setLocal('Escribe el motivo de la devolución.');
    const r = armarDevolucionCliente(renglones, posibles.map((x) => ({ linea_id: x.linea_id, sku_id: x.sku_id, piezas: piezas[llave(x)] ?? '', destino: destinos[llave(x)] ?? 'inventario' })));
    if (!r.ok) return setLocal(r.error);
    setLocal(null);
    correr('registrar_devolucion_cliente', { p_pedido: pedidoId, p_lineas: r.valor, p_motivo: motivo.trim() }, () => { setAbierto(false); setPiezas({}); setMotivo(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton" onClick={() => { limpiarError(); setLocal(null); setAbierto(true); }} data-testid="devolver-mercancia" disabled={posibles.length === 0}>Devolver mercancía</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Devolver mercancía de ${folio}`} confirmar="Registrar devolución" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p>Las piezas regresan a Bodega Omar al valor al que salieron; las dañadas se mandan a merma. El crédito baja lo que el cliente debe por el precio de la nota (no incluye envío). La nota original no cambia.</p>
          <div className="rtm-lista-form" role="group" aria-label="Piezas a devolver">
            {posibles.map((r) => (
              <div key={llave(r)} className="rtm-form-fila">
                <span className="rtm-campo-ancho"><strong>{nombreVape(r.modelo)} {saborMayus(r.sabor)}</strong><br />Surtidas {formatearPiezas(r.surtidas)} · ya devueltas {formatearPiezas(r.devueltas)} · precio de la nota {formatearMoneda(r.precio_cent)}</span>
                <label className="rtm-etiqueta-campo">Devuelve<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={piezas[llave(r)] ?? ''} onChange={(e) => setPiezas((p) => ({ ...p, [llave(r)]: e.target.value }))} aria-label={`Piezas a devolver de ${r.modelo} ${r.sabor}`} /></label>
                <label className="rtm-etiqueta-campo">Destino
                  <select className="rtm-campo" value={destinos[llave(r)] ?? 'inventario'} onChange={(e) => setDestinos((d) => ({ ...d, [llave(r)]: e.target.value as DestinoDevolucion }))} aria-label={`Destino de ${r.modelo} ${r.sabor}`}>
                    <option value="inventario">Regresa al inventario</option><option value="merma">Dañado: merma</option>
                  </select>
                </label>
              </div>
            ))}
          </div>
          <p className="rtm-nota">El crédito lo calcula la base al registrar y queda en la nota.</p>
          <label className="rtm-etiqueta-campo">Motivo<input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo de la devolución" /></label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

export function AnularDevolucionCliente({ id, folio }: { id: number; folio: string }) {
  return (
    <DialogoSimple boton="Anular" chico titulo={`Anular ${folio}`} accion="anular_devolucion_cliente" args={{ p_devolucion: id }} motivo="p_motivo" testid={`anular-dev-${id}`}
      texto={<p>Regresan las piezas a como estaban en el kárdex, el crédito vuelve a la cuenta por cobrar y los pagos liberados se reaplican. Queda el registro de la anulación.</p>} />
  );
}
