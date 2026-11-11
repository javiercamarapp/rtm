'use client';

import { useState } from 'react';
import { formatearPiezas } from '@/dominio/formato';
import type { CompraDetalle } from '@/dominio/operacion/tipos';
import { BotonAccion, DialogoSimple } from '../../../operacion/dialogo-simple';
import { useAccion } from '../../../operacion/usar-accion';
import { FormularioGuia } from '../../../paquetes/en-trayecto/formulario-guia';

export interface SaborOpcion { sku_id: number; sabor: string }

/** Acciones de la orden segun su estado. Confirmar aplica el dinero a la cuenta con el proveedor; las piezas NO cuentan hasta confirmar la recepcion. */
export function AccionesCompra({ compra }: { compra: CompraDetalle }) {
  const e = compra.estado;
  return (
    <div className="rtm-acciones-fila" aria-label="Acciones de la orden">
      {e === 'borrador' && <BotonAccion boton="Confirmar orden (aplica el dinero)" accion="confirmar_compra" args={{ p_compra: compra.id }} primario testid="confirmar-oc" />}
      {e === 'confirmada' && <BotonAccion boton="Marcar enviada" accion="marcar_compra_enviada" args={{ p_compra: compra.id }} testid="oc-enviada" />}
      {(e === 'confirmada' || e === 'enviada' || e === 'en_trayecto') && <FormularioGuia compraId={compra.id} folio={compra.folio} />}
      {(e === 'confirmada' || e === 'enviada' || e === 'en_trayecto') && <BotonAccion boton="Llegó a Mérida" accion="marcar_llego_merida" args={{ p_compra: compra.id }} testid="oc-llego" />}
      {e === 'recibida' && <BotonAccion boton="Cerrar orden" accion="cerrar_compra" args={{ p_compra: compra.id }} primario testid="cerrar-oc" />}
      {['borrador', 'confirmada', 'enviada', 'en_trayecto', 'llego_merida'].includes(e) && (
        <DialogoSimple boton="Anular orden" titulo={`Anular ${compra.folio}`} accion="anular_compra" args={{ p_compra: compra.id }} motivo="p_motivo"
          texto={<p>Anular es un contramovimiento: el cargo regresa a la cuenta con el proveedor. Una orden ya recibida no se anula.</p>} />
      )}
    </div>
  );
}

interface FilaRecepcion { linea_id: number; sku_id: number | ''; piezas: string }

/** Recepción en Mérida confirmada por sabor: solo entonces las piezas suman al inventario. */
export function FormularioRecepcion({ compra, sabores }: { compra: CompraDetalle; sabores: Record<string, SaborOpcion[]> }) {
  const { correr, ocupado, error } = useAccion();
  const inicial: FilaRecepcion[] = compra.lineas.map((l) => ({ linea_id: l.id, sku_id: l.sku_id, piezas: String(l.facturadas) }));
  const [filas, setFilas] = useState<FilaRecepcion[]>(inicial);
  const [local, setLocal] = useState<string | null>(null);

  const cambiar = (i: number, cambios: Partial<FilaRecepcion>) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...cambios } : x)));
  const confirmar = () => {
    const lista = filas.filter((f) => f.piezas.trim() !== '' && Number(f.piezas) !== 0);
    if (lista.some((f) => f.sku_id === '' || !Number.isInteger(Number(f.piezas)) || Number(f.piezas) < 0)) return setLocal('Cada renglón necesita sabor y piezas enteras.');
    if (lista.length === 0) return setLocal('Escribe las piezas recibidas por sabor.');
    setLocal(null);
    correr('recibir_compra', { p_compra: compra.id, p_recibido: lista.map((f) => ({ linea_id: f.linea_id, sku_id: f.sku_id, piezas: Number(f.piezas) })) });
  };

  return (
    <section className="rtm-seccion" aria-label="Confirmar recepción" id="recepcion">
      <h2>Confirmar recepción en Mérida</h2>
      <p className="rtm-nota">Escribe las piezas contadas por sabor. Lo recibido suma al inventario al costo puesto de lo facturado; lo que falte o sobre queda en diferencias, nunca escondido en el costo.</p>
      {filas.map((f, i) => {
        const l = compra.lineas.find((x) => x.id === f.linea_id)!;
        return (
          <div key={i} className="rtm-form-fila">
            <span className="rtm-campo-ancho">{l.modelo} (facturadas {formatearPiezas(l.facturadas)})</span>
            <label className="rtm-etiqueta-campo">Sabor
              <select className="rtm-campo" value={f.sku_id} onChange={(e) => cambiar(i, { sku_id: Number(e.target.value) })} aria-label={`Sabor recibido de ${l.modelo}`}>
                {(sabores[l.modelo] ?? []).map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sabor}</option>)}
              </select>
            </label>
            <label className="rtm-etiqueta-campo">Recibidas<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={f.piezas} onChange={(e) => cambiar(i, { piezas: e.target.value })} aria-label={`Piezas recibidas de ${l.modelo} ${i + 1}`} /></label>
            <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setFilas((x) => [...x.slice(0, i + 1), { linea_id: f.linea_id, sku_id: f.sku_id, piezas: '' }, ...x.slice(i + 1)])}>Otro sabor</button>
          </div>
        );
      })}
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <div className="rtm-acciones-fila"><button type="button" className="rtm-boton rtm-boton-primario" onClick={confirmar} disabled={ocupado} data-testid="confirmar-recepcion">{ocupado ? 'Guardando' : 'Confirmar recepción'}</button></div>
    </section>
  );
}

/** Asignar la diferencia a un responsable (sociedad, socio o proveedor). Asignar, reasignar o cancelar son movimientos aparte. */
export function AsignarDiferencia({ diferenciaId, actual }: { diferenciaId: number; actual: string }) {
  const { correr, ocupado, error } = useAccion();
  const [valor, setValor] = useState(actual === 'Angelo' ? 'socio:Angelo' : actual === 'Javier' ? 'socio:Javier' : actual === 'Proveedor' ? 'proveedor' : 'sociedad');
  const ir = () => {
    const [resp, socio] = valor.split(':');
    correr('asignar_diferencia', { p_diferencia: diferenciaId, p_responsable: resp, p_socio: socio ?? null });
  };
  return (
    <span className="rtm-acciones-fila">
      <select className="rtm-campo" value={valor} onChange={(e) => setValor(e.target.value)} aria-label="Responsable de la diferencia" data-testid={`resp-${diferenciaId}`}>
        <option value="sociedad">La sociedad (cuenta puente)</option><option value="socio:Angelo">Angelo</option><option value="socio:Javier">Javier</option><option value="proveedor">El proveedor (reclamo)</option>
      </select>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={ir} disabled={ocupado} data-testid={`asignar-${diferenciaId}`}>{ocupado ? 'Guardando' : 'Asignar'}</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </span>
  );
}
