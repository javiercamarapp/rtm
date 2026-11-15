'use client';

import { useState } from 'react';
import { formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import type { IncidentePaquete, SalidaLineaIncidente } from '@/dominio/operacion/tipos';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';
import { lineasSalida } from './lineas-salida';

const TIPOS = [{ v: 'perdido', t: 'Perdido' }, { v: 'danado', t: 'Dañado' }];

/** Reporta un paquete ya enviado a un cliente que se perdio o llego danado: piezas por renglon y sabor; no mueve dinero hasta resolverlo. */
export function DialogoReportarSalida({ pedidoId, folio }: { pedidoId: number; folio: string }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [lineas, setLineas] = useState<SalidaLineaIncidente[] | null>(null);
  const [piezas, setPiezas] = useState<Record<string, string>>({});
  const [tipo, setTipo] = useState('perdido');
  const [detalle, setDetalle] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const clave = (l: SalidaLineaIncidente) => `${l.linea_id}:${l.sku_id}`;

  const abrir = () => {
    limpiarError(); setLocal(null); setAbierto(true);
    void lineasSalida(pedidoId).then(setLineas, () => setLocal('No se pudieron leer los renglones del pedido.'));
  };
  const confirmar = () => {
    const lista = (lineas ?? []).map((l) => ({ l, n: Number(piezas[clave(l)] || '0') })).filter((x) => x.n !== 0);
    if (lista.some((x) => !Number.isInteger(x.n) || x.n < 0 || x.n > x.l.surtidas - x.l.reportadas)) return setLocal('Las piezas deben ser enteros entre 1 y lo que aún no se ha reportado.');
    if (lista.length === 0) return setLocal('Indica al menos una pieza afectada.');
    if (detalle.trim() === '') return setLocal('Cuenta qué pasó.');
    setLocal(null);
    correr('reportar_paquete_salida', { p_pedido: pedidoId, p_tipo: tipo, p_detalle: detalle.trim(), p_lineas: lista.map((x) => ({ linea_id: x.l.linea_id, sku_id: x.l.sku_id, piezas: x.n })) }, () => setAbierto(false));
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={abrir} data-testid={`reportar-salida-${pedidoId}`}>Perdido o dañado</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Paquete perdido o dañado ${folio}`} confirmar="Reportar" ocupado={ocupado} onConfirmar={confirmar} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p>Reportar no mueve dinero ni inventario: avisa a los socios y queda pendiente decidir quién absorbe la pérdida.</p>
          <label className="rtm-etiqueta-campo">Qué pasó
            <select className="rtm-campo" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de incidente">{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}</select>
          </label>
          {lineas === null ? <p className="rtm-nota">Leyendo renglones.</p> : lineas.map((l) => (
            <label key={clave(l)} className="rtm-etiqueta-campo">
              {nombreVape(l.modelo)} · {saborMayus(l.sabor)} (salieron {formatearPiezas(l.surtidas)}{l.reportadas > 0 ? `, ya reportadas ${formatearPiezas(l.reportadas)}` : ''})
              <input className="rtm-campo rtm-campo-num" inputMode="numeric" value={piezas[clave(l)] ?? ''} onChange={(e) => setPiezas((s) => ({ ...s, [clave(l)]: e.target.value }))} aria-label={`Piezas afectadas de ${l.modelo} ${l.sabor}`} />
            </label>
          ))}
          <label className="rtm-etiqueta-campo">Detalle<textarea className="rtm-campo" value={detalle} onChange={(e) => setDetalle(e.target.value)} aria-label="Detalle del incidente" /></label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

export interface RenglonEntrada { linea_id: number; modelo: string; sabor: string; facturadas: number }

/** Reporta una orden en camino que se perdio o llego danada: se confirma la recepcion solo con lo que llego sano (cero si no llego nada). */
export function DialogoReportarEntrada({ compraId, folio, renglones }: { compraId: number; folio: string; renglones: RenglonEntrada[] }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState('perdido');
  const [sanas, setSanas] = useState<Record<number, string>>({});
  const [detalle, setDetalle] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const confirmar = () => {
    const lista = tipo === 'perdido' ? [] : renglones.map((r) => ({ r, n: Number(sanas[r.linea_id] || '0') })).filter((x) => x.n !== 0);
    if (lista.some((x) => !Number.isInteger(x.n) || x.n < 0 || x.n > x.r.facturadas)) return setLocal('Las piezas sanas deben ser enteros entre 0 y lo facturado.');
    if (tipo === 'danado' && renglones.every((r) => Number(sanas[r.linea_id] || '0') >= r.facturadas)) return setLocal('Si todo llegó sano no hay incidente.');
    if (detalle.trim() === '') return setLocal('Cuenta qué pasó.');
    setLocal(null);
    correr('reportar_paquete_entrada', { p_compra: compraId, p_tipo: tipo, p_detalle: detalle.trim(), p_recibido: lista.map((x) => ({ linea_id: x.r.linea_id, sabor: x.r.sabor, piezas: x.n })) }, () => setAbierto(false));
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { limpiarError(); setLocal(null); setAbierto(true); }} data-testid={`reportar-entrada-${compraId}`}>Perdido o dañado</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Paquete perdido o dañado de ${folio}`} confirmar="Reportar" ocupado={ocupado} onConfirmar={confirmar} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p>Se confirma la recepción solo con lo que llegó sano. Lo que falta queda como diferencia por asignar; las piezas no entran a la existencia.</p>
          <label className="rtm-etiqueta-campo">Qué pasó
            <select className="rtm-campo" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de incidente">{TIPOS.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}</select>
          </label>
          {tipo === 'danado' && renglones.map((r) => (
            <label key={r.linea_id} className="rtm-etiqueta-campo">
              {nombreVape(r.modelo)} · {saborMayus(r.sabor)}: piezas sanas recibidas (de {formatearPiezas(r.facturadas)})
              <input className="rtm-campo rtm-campo-num" inputMode="numeric" value={sanas[r.linea_id] ?? ''} onChange={(e) => setSanas((s) => ({ ...s, [r.linea_id]: e.target.value }))} aria-label={`Sanas de ${r.modelo} ${r.sabor}`} />
            </label>
          ))}
          <label className="rtm-etiqueta-campo">Detalle<textarea className="rtm-campo" value={detalle} onChange={(e) => setDetalle(e.target.value)} aria-label="Detalle del incidente" /></label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Resolver: quién absorbe la pérdida (sociedad 50/50, un socio, el proveedor o el cliente) y qué pasa con el cliente. */
export function DialogoResolver({ incidente }: { incidente: Pick<IncidentePaquete, 'id' | 'folio' | 'sentido'> }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const salida = incidente.sentido === 'salida';
  const [abierto, setAbierto] = useState(false);
  const [resp, setResp] = useState('sociedad');
  const [socio, setSocio] = useState('Angelo');
  const [accion, setAccion] = useState('bonificar');
  const [motivo, setMotivo] = useState('');
  const [paqueteria, setPaqueteria] = useState('');
  const [numero, setNumero] = useState('');
  const [costo, setCosto] = useState('');
  const [pagaGuia, setPagaGuia] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const confirmar = () => {
    if (motivo.trim() === '') return setLocal('Escribe el motivo.');
    const c = costo.trim() === '' ? null : centavosDeTexto(costo);
    if (costo.trim() !== '' && c === null) return setLocal('El costo de la guía debe ser un monto como 180 o 180.00.');
    const conGuia = salida && resp !== 'cliente' && accion === 'reponer' && numero.trim() !== '';
    setLocal(null);
    correr('resolver_paquete_incidente', {
      p_incidente: incidente.id, p_responsable: resp, p_socio: resp === 'socio' ? socio : null, p_accion: salida && resp !== 'cliente' ? accion : null, p_motivo: motivo.trim(),
      p_guia: conGuia ? { paqueteria: paqueteria.trim() || 'Paquetería', numero: numero.trim(), ...(c !== null ? { costo_cent: c } : {}), ...(pagaGuia ? { pagada_por: pagaGuia } : {}) } : null,
    }, () => setAbierto(false));
  };
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico rtm-boton-primario" onClick={() => { limpiarError(); setLocal(null); setAbierto(true); }} data-testid={`resolver-${incidente.id}`}>Resolver</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Resolver ${incidente.folio}`} confirmar="Resolver" ocupado={ocupado} onConfirmar={confirmar} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <label className="rtm-etiqueta-campo">Quién absorbe la pérdida
            <select className="rtm-campo" value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Responsable">
              <option value="sociedad">La sociedad (pérdida 50/50 en la utilidad)</option>
              <option value="socio">Un socio (le queda por cobrar)</option>
              {!salida && <option value="proveedor">El proveedor (reclamo)</option>}
              {salida && <option value="cliente">El cliente (no cambia nada)</option>}
            </select>
          </label>
          {resp === 'socio' && (
            <label className="rtm-etiqueta-campo">Socio
              <select className="rtm-campo" value={socio} onChange={(e) => setSocio(e.target.value)} aria-label="Socio responsable"><option>Angelo</option><option>Javier</option></select>
            </label>
          )}
          {salida && resp !== 'cliente' && (
            <label className="rtm-etiqueta-campo">Qué pasa con el cliente
              <select className="rtm-campo" value={accion} onChange={(e) => setAccion(e.target.value)} aria-label="Qué pasa con el cliente">
                <option value="bonificar">Bonificar: no paga esas piezas (se corrige la nota)</option>
                <option value="reponer">Reponer: se reenvían piezas desde la bodega</option>
              </select>
            </label>
          )}
          {salida && resp !== 'cliente' && accion === 'reponer' && (
            <div className="rtm-form-fila">
              <label className="rtm-etiqueta-campo">Paquetería<input className="rtm-campo" value={paqueteria} onChange={(e) => setPaqueteria(e.target.value)} placeholder="Castores" /></label>
              <label className="rtm-etiqueta-campo">Guía del reenvío<input className="rtm-campo" value={numero} onChange={(e) => setNumero(e.target.value)} aria-label="Guía del reenvío" /></label>
              <label className="rtm-etiqueta-campo">Costo real<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} aria-label="Costo de la guía del reenvío" /></label>
              <label className="rtm-etiqueta-campo">La pagó
                <select className="rtm-campo" value={pagaGuia} onChange={(e) => setPagaGuia(e.target.value)}><option value="">Sin indicar</option><option value="Angelo">Angelo</option><option value="Javier">Javier</option></select>
              </label>
            </div>
          )}
          <label className="rtm-etiqueta-campo">Motivo<textarea className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo" /></label>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
