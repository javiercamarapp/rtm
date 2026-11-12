'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { CONTRAPARTE_DE_TIPO, ETIQUETA_TIPO, TIPOS_MOVIMIENTO, type Candidata, type FilaMovimiento, type ReferenciasMovimientos, type TipoMovimiento } from '@/dominio/movimientos/tipos';
import { formatearMoneda } from '@/dominio/formato';
import { useAccion } from '../operacion/usar-accion';
import { candidatasAccion } from './acciones';

const SOCIOS = ['Angelo', 'Javier'];
const NINGUNO = '';
const HECHO: Record<string, string> = { pago: 'un pago', gasto: 'un gasto', aportacion: 'una aportación' };

/** Clasificar, conciliar y descartar un movimiento. Nada de esto crea cobros, pagos ni asientos. */
export function AccionesMovimiento({ fila, refs }: { fila: FilaMovimiento; refs: ReferenciasMovimientos }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [dialogo, setDialogo] = useState<'clasificar' | 'conciliar' | 'marcar' | null>(null);
  const [tipo, setTipo] = useState<TipoMovimiento>(fila.monto_cent > 0n ? 'cobro_cliente' : 'pago_proveedor');
  const [cliente, setCliente] = useState(NINGUNO);
  const [pedido, setPedido] = useState(NINGUNO);
  const [proveedor, setProveedor] = useState(String(refs.proveedores[0]?.id ?? ''));
  const [socio, setSocio] = useState(SOCIOS[0]!);
  const [motivo, setMotivo] = useState('');
  const [marca, setMarca] = useState<'descartado' | 'duplicado'>('descartado');
  const [candidatas, setCandidatas] = useState<Candidata[] | null>(null);
  const [contraparte, setContraparte] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const tipoContraparte = fila.tipo ? CONTRAPARTE_DE_TIPO[fila.tipo] : undefined;
  const cerrar = () => { setDialogo(null); setLocal(null); limpiarError(); };
  const abrirConciliar = async () => {
    setCandidatas(null);
    setDialogo('conciliar');
    const c = await candidatasAccion(fila.id);
    setCandidatas(c);
    setContraparte(String(c[0]?.id ?? ''));
  };

  const clasificar = () => {
    const ref: Record<string, unknown> = {};
    if (cliente) ref['cliente_id'] = Number(cliente);
    if (pedido) ref['pedido_id'] = Number(pedido);
    if (tipo === 'pago_proveedor') ref['proveedor_id'] = Number(proveedor);
    if (['aportacion', 'retiro', 'fondos_en_poder_socio', 'transferencia_entre_socios'].includes(tipo)) ref['socio'] = socio;
    correr('mov_clasificar', { p_mov: fila.id, p_tipo: tipo, p_ref: ref, p_motivo: motivo.trim() || null }, cerrar);
  };

  const cerrado = fila.estado === 'descartado' || fila.estado === 'duplicado';
  return (
    <span className="rtm-acciones-fila">
      {!cerrado && <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { limpiarError(); setDialogo('clasificar'); }} data-testid={`clasificar-${fila.id}`}>{fila.estado === 'sin_clasificar' ? 'Clasificar' : 'Reclasificar'}</button>}
      {fila.estado === 'clasificado' && tipoContraparte && <button type="button" className="rtm-boton rtm-boton-chico" onClick={abrirConciliar} data-testid={`conciliar-${fila.id}`}>Conciliar</button>}
      {(fila.estado === 'sin_clasificar' || fila.estado === 'clasificado') && <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { limpiarError(); setDialogo('marcar'); }} data-testid={`marcar-${fila.id}`}>Descartar</button>}
      {dialogo === 'clasificar' && (
        <ConfirmDialog abierto titulo="Clasificar el movimiento" confirmar="Guardar clasificación" ocupado={ocupado} onConfirmar={clasificar} onCancelar={cerrar}>
          <p className="rtm-nota">{formatearMoneda(fila.monto_cent, { conSigno: true })} · {fila.mensaje ?? fila.origen ?? ''}</p>
          <label className="rtm-etiqueta-campo">Tipo
            <select className="rtm-campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimiento)} data-testid="campo-tipo">{TIPOS_MOVIMIENTO.map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}</select>
          </label>
          {(tipo === 'cobro_cliente' || tipo === 'gasto' || tipo === 'otro') && (
            <label className="rtm-etiqueta-campo">Cliente (opcional salvo en un cobro)
              <select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="campo-cliente"><option value={NINGUNO}>Ninguno</option>{refs.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
            </label>
          )}
          {(tipo === 'cobro_cliente' || tipo === 'gasto') && (
            <label className="rtm-etiqueta-campo">Pedido (opcional)
              <select className="rtm-campo" value={pedido} onChange={(e) => setPedido(e.target.value)} data-testid="campo-pedido"><option value={NINGUNO}>Ninguno</option>{refs.pedidos.map((p) => <option key={p.id} value={p.id}>{p.folio} · {p.cliente}</option>)}</select>
            </label>
          )}
          {tipo === 'pago_proveedor' && (
            <label className="rtm-etiqueta-campo">Proveedor
              <select className="rtm-campo" value={proveedor} onChange={(e) => setProveedor(e.target.value)} data-testid="campo-proveedor">{refs.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
            </label>
          )}
          {['aportacion', 'retiro', 'fondos_en_poder_socio', 'transferencia_entre_socios'].includes(tipo) && (
            <label className="rtm-etiqueta-campo">Socio
              <select className="rtm-campo" value={socio} onChange={(e) => setSocio(e.target.value)} data-testid="campo-socio">{SOCIOS.map((s) => <option key={s}>{s}</option>)}</select>
            </label>
          )}
          <label className="rtm-etiqueta-campo">Motivo {tipo === 'otro' ? '(obligatorio)' : '(opcional)'}
            <input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="campo-motivo" />
          </label>
          <p className="rtm-nota">Clasificar describe el movimiento; no crea cobros, pagos ni asientos.</p>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
      {dialogo === 'conciliar' && tipoContraparte && (
        <ConfirmDialog abierto titulo="Conciliar con un hecho existente" confirmar="Conciliar" ocupado={ocupado} onConfirmar={() => (contraparte ? correr('mov_conciliar', { p_mov: fila.id, p_contraparte_tipo: tipoContraparte, p_contraparte_id: Number(contraparte) }, cerrar) : setLocal('No hay contraparte con la misma suma.'))} onCancelar={cerrar}>
          <p className="rtm-nota">Solo concilia con {HECHO[tipoContraparte]} vigente (no anulado) que corresponda a la clasificación, que tenga exactamente la misma suma ({formatearMoneda(fila.monto_cent < 0n ? -fila.monto_cent : fila.monto_cent)}) y que no concilie otro movimiento.</p>
          {candidatas === null ? <p>Buscando…</p> : candidatas.length === 0 ? <p data-testid="sin-candidatas">No hay ninguna contraparte con la misma suma.</p> : (
            <label className="rtm-etiqueta-campo">Contraparte
              <select className="rtm-campo" value={contraparte} onChange={(e) => setContraparte(e.target.value)} data-testid="campo-contraparte">{candidatas.map((c) => <option key={c.id} value={c.id}>{c.texto} · {formatearMoneda(c.monto_cent)}</option>)}</select>
            </label>
          )}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
      {dialogo === 'marcar' && (
        <ConfirmDialog abierto titulo="Descartar el movimiento" confirmar="Descartar" ocupado={ocupado} onConfirmar={() => (motivo.trim() ? correr('mov_marcar', { p_mov: fila.id, p_estado: marca, p_motivo: motivo.trim() }, cerrar) : setLocal('Escribe el motivo.'))} onCancelar={cerrar}>
          <label className="rtm-etiqueta-campo">Por qué
            <select className="rtm-campo" value={marca} onChange={(e) => setMarca(e.target.value as 'descartado' | 'duplicado')}><option value="descartado">No pertenece al negocio</option><option value="duplicado">Es un duplicado</option></select>
          </label>
          <label className="rtm-etiqueta-campo">Motivo
            <input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="campo-motivo" />
          </label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
      {error && !dialogo && <span className="rtm-error" role="alert">{error}</span>}
    </span>
  );
}
