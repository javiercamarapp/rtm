'use client';

import { useState } from 'react';
import { armarDevolucionProveedor } from '@/dominio/operacion/devoluciones';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { CatalogoDevolucionProveedor } from '@/dominio/operacion/tipos';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { DialogoSimple } from '../operacion/dialogo-simple';
import { useAccion } from '../operacion/usar-accion';

/** Devolver mercancía a Isaac o Karen: sale de Bodega Omar al costo promedio y la cuenta con el proveedor sube por ese valor. Lo apartado no se devuelve. */
export function DevolverAProveedor({ catalogo }: { catalogo: CatalogoDevolucionProveedor }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [proveedor, setProveedor] = useState<'Isaac' | 'Karen'>('Isaac');
  const [compra, setCompra] = useState('');
  const [piezas, setPiezas] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const visibles = catalogo.skus.filter((s) => `${s.marca} ${s.modelo} ${s.sabor}`.toLowerCase().includes(filtro.trim().toLowerCase()));

  const ir = () => {
    if (motivo.trim() === '') return setLocal('Escribe el motivo de la devolución.');
    const r = armarDevolucionProveedor(catalogo.skus, catalogo.skus.map((s) => ({ sku_id: s.sku_id, piezas: piezas[s.sku_id] ?? '' })));
    if (!r.ok) return setLocal(r.error);
    setLocal(null);
    correr('devolver_a_proveedor', { p_proveedor: proveedor, p_lineas: r.valor, p_motivo: motivo.trim(), p_compra: compra === '' ? null : Number(compra) }, () => { setAbierto(false); setPiezas({}); setMotivo(''); });
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-primario" onClick={() => { limpiarError(); setLocal(null); setAbierto(true); }} data-testid="devolver-proveedor" disabled={catalogo.skus.length === 0}>Devolver a un proveedor</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo="Devolver mercancía a un proveedor" confirmar="Registrar devolución" ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <div className="rtm-form-fila">
            <label className="rtm-etiqueta-campo">Proveedor
              <select className="rtm-campo" value={proveedor} onChange={(e) => setProveedor(e.target.value as 'Isaac' | 'Karen')} aria-label="Proveedor"><option>Isaac</option><option>Karen</option></select>
            </label>
            <label className="rtm-etiqueta-campo">Orden de compra (opcional)
              <select className="rtm-campo" value={compra} onChange={(e) => setCompra(e.target.value)} aria-label="Orden de compra de origen">
                <option value="">Sin orden</option>
                {catalogo.compras.filter((c) => c.proveedor === proveedor).map((c) => <option key={c.id} value={c.id}>{c.folio}</option>)}
              </select>
            </label>
            <label className="rtm-etiqueta-campo">Buscar<input className="rtm-campo" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar producto" /></label>
          </div>
          <div className="rtm-lista-form" role="group" aria-label="Piezas a devolver al proveedor">
            {visibles.map((s) => (
              <div key={s.sku_id} className="rtm-form-fila">
                <span className="rtm-campo-ancho"><strong>{s.modelo} {s.sabor}</strong><br />Disponible {formatearPiezas(s.disponible)} · costo promedio {formatearMoneda(s.costo_prom_cent)}</span>
                <label className="rtm-etiqueta-campo">Devuelve<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={piezas[s.sku_id] ?? ''} onChange={(e) => setPiezas((p) => ({ ...p, [s.sku_id]: e.target.value }))} aria-label={`Piezas a devolver de ${s.modelo} ${s.sabor}`} /></label>
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

export function AnularDevolucionProveedor({ id, folio }: { id: number; folio: string }) {
  return (
    <DialogoSimple boton="Anular" chico titulo={`Anular ${folio}`} accion="anular_devolucion_proveedor" args={{ p_devolucion: id }} motivo="p_motivo" testid={`anular-devp-${id}`}
      texto={<p>Las piezas regresan al inventario y el crédito sale de la cuenta con el proveedor. Queda el registro de la anulación.</p>} />
  );
}
