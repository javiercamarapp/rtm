'use client';

import { useMemo, useState } from 'react';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { previewPedido, semanasHasta } from '@/dominio/dropshipping/calculos';
import { parsearPegado } from '@/dominio/dropshipping/pegado';
import type { CatalogoDs, DatosDestinatario } from '@/dominio/dropshipping/tipos';
import { textoOrden, agruparRenglones } from '@/dominio/dropshipping/orden';
import { centavosDeTexto, useAccion } from '../../operacion/usar-accion';
import { CamposDestinatario, DESTINATARIO_VACIO } from '../bloque-destinatario';
import { PanelOrden } from '../panel-orden';

interface Renglon { sku_id: number; marca: string; modelo: string; sabor: string; piezas: number; precioCent: bigint | null; costoCent: bigint | null }
const pesos = (c: bigint | null) => (c === null ? '' : formatearMoneda(c).replace('$', '').replace(/,/g, ''));
const hoyISO = () => new Date().toISOString().slice(0, 10);

/** Formulario único: renglones (con pegado rápido de sabores), destinatario protegido, vista previa de costo, margen, interés y utilidad, y la orden para copiar. */
export function FormularioDs({ clienteId, clienteNombre, origen, catalogo, socioMenudeo, puedeMenudeo }: { clienteId: number; clienteNombre: string; origen: string; catalogo: CatalogoDs; socioMenudeo: string; puedeMenudeo: boolean }) {
  const { correr, ocupado, error } = useAccion();
  const proveedor = origen === 'isaac_directo' ? 'Isaac' : 'Karen';
  const modelos = useMemo(() => {
    const m = new Map<number, { id: number; marca: string; nombre: string }>();
    for (const s of catalogo.skus) if (!m.has(s.modelo_id)) m.set(s.modelo_id, { id: s.modelo_id, marca: s.marca, nombre: s.modelo });
    return [...m.values()];
  }, [catalogo.skus]);
  const [tipo, setTipo] = useState<'cliente' | 'socio_a_costo'>('cliente');
  const [fechaCompromiso, setFechaCompromiso] = useState('');
  const [horaCompromiso, setHoraCompromiso] = useState('');
  const [modeloId, setModeloId] = useState<number | ''>('');
  const [skuId, setSkuId] = useState<number | ''>('');
  const [piezas, setPiezas] = useState('');
  const [precio, setPrecio] = useState('');
  const [pegado, setPegado] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [envio, setEnvio] = useState('0');
  const [envioProv, setEnvioProv] = useState('0');
  const [descuento, setDescuento] = useState('0');
  const [credito, setCredito] = useState(false);
  const [tasa, setTasa] = useState('10');
  const [semanas, setSemanas] = useState('1');
  const [fechaPago, setFechaPago] = useState('');
  const [interesFijo, setInteresFijo] = useState('');
  const [folioExt, setFolioExt] = useState('');
  const [dest, setDest] = useState<DatosDestinatario>(DESTINATARIO_VACIO);
  const [local, setLocal] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ id: number; folio: string; costo: bigint; margen: bigint; interes: bigint; total: bigint } | null>(null);

  const aCosto = tipo === 'socio_a_costo';
  const sabores = catalogo.skus.filter((s) => s.modelo_id === modeloId);
  const sku = catalogo.skus.find((s) => s.sku_id === skuId);

  const elegirModelo = (id: number | '') => { setModeloId(id); setSkuId(''); const p = catalogo.skus.find((s) => s.modelo_id === id); setPrecio(pesos(aCosto ? p?.costo_cent ?? null : p?.precio_cent ?? null)); };
  const precioDe = (s: { precio_cent: bigint | null; costo_cent: bigint | null }): bigint | null => (aCosto ? s.costo_cent : (centavosDeTexto(precio) !== null && precio !== '' ? BigInt(centavosDeTexto(precio) ?? 0) : s.precio_cent));
  const agregar = () => {
    if (!sku) return setLocal('Elige modelo y sabor.');
    const n = Number(piezas);
    if (!Number.isInteger(n) || n <= 0) return setLocal('Las piezas deben ser un entero positivo.');
    setLocal(null);
    setRenglones((r) => [...r, { sku_id: sku.sku_id, marca: sku.marca, modelo: sku.modelo, sabor: sku.sabor, piezas: n, precioCent: precioDe(sku), costoCent: sku.costo_cent }]);
    setPiezas('');
  };
  const agregarPegado = () => {
    if (modeloId === '') return setLocal('Elige el modelo antes de pegar los sabores.');
    const res = parsearPegado(pegado, sabores.map((s) => s.sabor));
    if (res.errores.length) return setLocal(res.errores.join(' '));
    const nuevos: Renglon[] = res.renglones.flatMap((x) => { const s = sabores.find((q) => q.sabor === x.sabor); return s ? [{ sku_id: s.sku_id, marca: s.marca, modelo: s.modelo, sabor: s.sabor, piezas: x.piezas, precioCent: precioDe(s), costoCent: s.costo_cent }] : []; });
    setLocal(null);
    setRenglones((r) => [...r, ...nuevos]);
    setPegado('');
  };

  const envioC = centavosDeTexto(envio || '0') ?? 0;
  const descC = centavosDeTexto(descuento || '0') ?? 0;
  const envioProvC = centavosDeTexto(envioProv || '0') ?? 0;
  const fijoC = interesFijo ? centavosDeTexto(interesFijo) : null;
  const tasaBp = Math.round(Number(tasa || '0') * 100);
  const semanasN = fechaPago && /^\d{4}-\d{2}-\d{2}$/.test(fechaPago) && fechaPago >= hoyISO() ? semanasHasta(hoyISO(), fechaPago) : Number(semanas || '1');
  const prev = useMemo(() => {
    const cred = credito && !aCosto && Number.isInteger(semanasN) && semanasN >= 0 && semanasN <= 260 && tasaBp >= 0 && tasaBp <= 10000 ? { tasaBp, semanas: semanasN, modo: 'simple' as const, interesFijoCent: fijoC === null ? null : BigInt(fijoC) } : null;
    return previewPedido(renglones.map((r) => ({ piezas: r.piezas, precioCent: r.precioCent ?? 0n, costoCent: r.costoCent })), aCosto ? 0n : BigInt(envioC), aCosto ? 0n : BigInt(descC), cred, BigInt(envioProvC));
  }, [renglones, envioC, descC, envioProvC, credito, aCosto, tasaBp, semanasN, fijoC]);
  const totalPiezas = renglones.reduce((a, r) => a + r.piezas, 0);
  const vistaPrevia = textoOrden('(folio al guardar)', agruparRenglones(renglones), null);

  const crear = () => {
    if (renglones.length === 0) return setLocal('Agrega al menos un renglón.');
    if (!aCosto && renglones.some((r) => r.precioCent === null)) return setLocal('Hay renglones sin precio para este cliente: escribe el precio a mano.');
    if (!aCosto && (centavosDeTexto(envio || '0') === null || centavosDeTexto(descuento || '0') === null)) return setLocal('Revisa envío y descuento: deben ser montos como 300 o 300.00.');
    if (dest.nombre.trim() && !/^\d{5}$/.test(dest.cp.trim())) return setLocal('El código postal del destinatario debe tener 5 dígitos.');
    const tieneDest = dest.nombre.trim() !== '' || dest.calle_numero.trim() !== '';
    if (tieneDest && (!dest.nombre.trim() || !dest.calle_numero.trim() || !dest.municipio.trim() || !dest.estado.trim())) return setLocal('El destinatario necesita nombre, calle y número, código postal, municipio y estado.');
    setLocal(null);
    const cr = credito && !aCosto ? { ...(fechaPago ? { fecha_pago: fechaPago } : { semanas: Number(semanas || '1') }), tasa_semanal_bp: tasaBp, ...(fijoC !== null ? { interes_cent: fijoC } : {}) } : null;
    correr('ds_crear_pedido', {
      p_cliente_id: clienteId, p_origen: origen, p_tipo_venta: tipo, p_socio: aCosto ? socioMenudeo : null, p_fecha_compromiso: aCosto && fechaCompromiso ? fechaCompromiso : null, p_hora_compromiso: aCosto && fechaCompromiso && horaCompromiso ? horaCompromiso : null, p_folio_externo: folioExt.trim() || null, p_envio_cent: aCosto ? 0 : envioC, p_descuento_cent: aCosto ? 0 : descC,
      p_credito: cr, p_destinatario: tieneDest ? dest : null,
      p_lineas: renglones.map((r) => ({ sku_id: r.sku_id, piezas: r.piezas, ...(aCosto || r.precioCent === null ? {} : { precio_cent: Number(r.precioCent) }) })),
    }, (d) => setCreado({ id: Number(d['pedido_id']), folio: String(d['folio']), costo: BigInt(Number(d['costo_estimado_cent'])), margen: BigInt(Number(d['margen_estimado_cent'])), interes: BigInt(Number(d['interes_cent'])), total: BigInt(Number(d['venta_estimada_cent'])) }));
  };

  if (creado) {
    return (
      <section className="rtm-seccion" aria-label="Pedido creado" data-testid="ds-creado">
        <h2>Pedido {creado.folio} creado</h2>
        <p className="rtm-nota">Costo a {proveedor}: {formatearMoneda(creado.costo)} · margen: {formatearMoneda(creado.margen)} · interés: {formatearMoneda(creado.interes)} · total del pedido: {formatearMoneda(creado.total)}.</p>
        <PanelOrden pedidoId={creado.id} proveedor={proveedor} vistaPrevia={textoOrden(creado.folio, agruparRenglones(renglones), dest.nombre.trim() ? { ...dest, telefono: dest.telefono ? '*** ** ' + dest.telefono.replace(/\D/g, '').slice(-2) : '', correo: dest.correo ? dest.correo.slice(0, 1) + '***@***' : '' } : null)} faltaDestinatario={!dest.nombre.trim()} />
        <p className="rtm-acciones-fila"><a className="rtm-boton rtm-boton-primario" href={`/dropshipping/pedidos/${creado.id}`} data-testid="ir-ficha">Ir a la ficha del pedido</a></p>
      </section>
    );
  }

  return (
    <div className="rtm-form" aria-label={`Pedido de dropshipping de ${clienteNombre}`}>
      <section className="rtm-seccion" aria-label="Tipo de pedido">
        <h2>Tipo de pedido</h2>
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Quién compra
            <select className="rtm-campo" value={tipo} onChange={(e) => { setTipo(e.target.value as 'cliente' | 'socio_a_costo'); setRenglones([]); setCredito(false); }} data-testid="ds-tipo">
              <option value="cliente">Cliente (precio de su tabulador)</option>{puedeMenudeo && <option value="socio_a_costo">Menudeo de {socioMenudeo}, a costo (no genera utilidad)</option>}
            </select>
          </label>
          {aCosto && <p className="rtm-etiqueta-campo">Socio<span className="rtm-campo" data-testid="ds-socio">{socioMenudeo}</span></p>}
          {aCosto && <label className="rtm-etiqueta-campo">Fecha comprometida de pago (opcional)<input className="rtm-campo" type="date" value={fechaCompromiso} onChange={(e) => setFechaCompromiso(e.target.value)} data-testid="ds-fecha-compromiso" /></label>}
          {aCosto && fechaCompromiso !== '' && <label className="rtm-etiqueta-campo">Hora (opcional)<input className="rtm-campo" type="time" value={horaCompromiso} onChange={(e) => setHoraCompromiso(e.target.value)} data-testid="ds-hora-compromiso" /></label>}
        </div>
        {aCosto && <p className="rtm-nota">Solo {socioMenudeo} mete pedidos a costo para su menudeo (Playa del Carmen); el otro socio los supervisa. Se cobra solo el costo del proveedor: ingreso igual al costo, utilidad cero. Si no fijas fecha comprometida de pago, el pedido se muestra «sin fecha comprometida» como alerta.</p>}
      </section>

      <section className="rtm-seccion" aria-label="Renglones">
        <h2>Renglones</h2>
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Modelo
            <select className="rtm-campo" value={modeloId} onChange={(e) => elegirModelo(e.target.value === '' ? '' : Number(e.target.value))} data-testid="ds-modelo">
              <option value="">Elige un modelo</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.marca} · {m.nombre}</option>)}
            </select>
          </label>
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Sabor
            <select className="rtm-campo" value={skuId} onChange={(e) => setSkuId(e.target.value === '' ? '' : Number(e.target.value))} disabled={modeloId === ''} data-testid="ds-sabor">
              <option value="">Elige un sabor</option>{sabores.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sabor}</option>)}
            </select>
          </label>
          <label className="rtm-etiqueta-campo">Piezas<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={piezas} onChange={(e) => setPiezas(e.target.value)} data-testid="ds-piezas" /></label>
          {!aCosto && <label className="rtm-etiqueta-campo">Precio por pieza<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} data-testid="ds-precio" /></label>}
          <button type="button" className="rtm-boton" onClick={agregar} data-testid="ds-agregar">Agregar renglón</button>
        </div>
        <label className="rtm-etiqueta-campo rtm-campo-ancho">Pegar muchos sabores del modelo elegido (uno por línea: «Fresa 8»)
          <textarea className="rtm-campo" rows={4} value={pegado} onChange={(e) => setPegado(e.target.value)} data-testid="ds-pegado" />
        </label>
        <button type="button" className="rtm-boton" onClick={agregarPegado} data-testid="ds-agregar-pegado">Agregar los sabores pegados</button>
        {sku && <p className="rtm-nota">Costo de {proveedor}: {sku.costo_cent === null ? 'sin costo vigente (no se puede surtir)' : formatearMoneda(sku.costo_cent)} · precio del tabulador: {sku.precio_cent === null ? 'sin precio' : formatearMoneda(sku.precio_cent)}</p>}
        {renglones.length > 0 && (
          <ul className="rtm-lineas-form" aria-label="Renglones agregados" data-testid="ds-renglones">
            {renglones.map((x, i) => (
              <li key={`${x.sku_id}-${i}`} className="rtm-acciones-fila">
                <span>{x.modelo} · {x.sabor} · {formatearPiezas(x.piezas)}{x.precioCent !== null ? ` a ${formatearMoneda(x.precioCent)}` : ''}</span>
                <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setRenglones((r) => r.filter((_, j) => j !== i))}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!aCosto && (
        <section className="rtm-seccion" aria-label="Cargos y crédito">
          <h2>Envío, descuento y crédito</h2>
          <div className="rtm-form-fila">
            <label className="rtm-etiqueta-campo">Envío cobrado al cliente<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={envio} onChange={(e) => setEnvio(e.target.value)} data-testid="ds-envio" /></label>
            <label className="rtm-etiqueta-campo">Envío que cobra el proveedor (solo para la vista previa)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={envioProv} onChange={(e) => setEnvioProv(e.target.value)} /></label>
            <label className="rtm-etiqueta-campo">Descuento<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} /></label>
          </div>
          <label className="rtm-etiqueta-campo"><span><input type="checkbox" checked={credito} onChange={(e) => setCredito(e.target.checked)} data-testid="ds-credito" /> Venta a crédito (interés semanal simple)</span></label>
          {credito && (
            <div className="rtm-form-fila" data-testid="ds-credito-campos">
              <label className="rtm-etiqueta-campo">Interés por semana (%)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} data-testid="ds-tasa" /></label>
              <label className="rtm-etiqueta-campo">Semanas<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={semanas} onChange={(e) => setSemanas(e.target.value)} disabled={fechaPago !== ''} data-testid="ds-semanas" /></label>
              <label className="rtm-etiqueta-campo">o fecha de pago pactada<input className="rtm-campo" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} /></label>
              <label className="rtm-etiqueta-campo">o monto de interés pactado<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={interesFijo} onChange={(e) => setInteresFijo(e.target.value)} data-testid="ds-interes-fijo" /></label>
            </div>
          )}
          {credito && <p className="rtm-nota">Por omisión: 10 % de una semana sobre el total de la mercancía (sin envío), interés simple. Normalmente se liquida a la semana y no hay más.</p>}
        </section>
      )}

      <section className="rtm-seccion" aria-label="Destinatario">
        <h2>Destinatario (protegido)</h2>
        <p className="rtm-nota">Se guarda aparte, solo lo ven los socios; teléfono y correo salen ocultos con «Revelar». Nunca pasa por la IA ni por Telegram.</p>
        <CamposDestinatario valor={dest} onCambio={setDest} />
        <label className="rtm-etiqueta-campo">Folio del proveedor (si ya lo tienes; se puede registrar después)<input className="rtm-campo" value={folioExt} onChange={(e) => setFolioExt(e.target.value)} data-testid="ds-folio-ext" placeholder="73266" /></label>
      </section>

      <section className="rtm-seccion" aria-label="Vista previa" data-testid="ds-vista-previa">
        <h2>Vista previa</h2>
        <dl className="rtm-ficha-datos">
          <div><dt>Piezas</dt><dd data-testid="prev-piezas">{formatearPiezas(totalPiezas)}</dd></div>
          <div><dt>Costo a {proveedor}</dt><dd data-testid="prev-costo">{prev.costoCent === null ? (renglones.length ? 'Sin costo vigente en algún renglón' : 'Sin dato') : formatearMoneda(prev.costoCent)}</dd></div>
          <div><dt>Venta de la mercancía</dt><dd data-testid="prev-venta">{formatearMoneda(prev.ventaMercanciaCent)}</dd></div>
          <div><dt>Margen (precio menos costo)</dt><dd data-testid="prev-margen">{prev.margenCent === null ? 'Sin dato' : `${formatearMoneda(prev.margenCent)}${prev.margenPct !== null ? ` · ${prev.margenPct.toFixed(1)} %` : ''}`}</dd></div>
          <div><dt>Interés del crédito</dt><dd data-testid="prev-interes">{formatearMoneda(prev.interesCent)}</dd></div>
          <div><dt>Total del pedido</dt><dd data-testid="prev-total">{formatearMoneda(prev.totalCent)}</dd></div>
          <div><dt>Utilidad (todo el ingreso menos todo el costo)</dt><dd data-testid="prev-utilidad">{prev.utilidadCent === null ? 'Sin dato' : formatearMoneda(prev.utilidadCent)}</dd></div>
        </dl>
        <p className="rtm-nota">Cálculo de referencia; al guardar, la base fija las cifras. El costo vigente puede cambiar entre hoy y el envío.</p>
        <pre className="rtm-texto-copiable" data-testid="ds-orden-previa">{renglones.length ? vistaPrevia : 'La orden para el proveedor aparece aquí al agregar renglones.'}</pre>
      </section>

      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <div className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={crear} disabled={ocupado} data-testid="ds-crear">{ocupado ? 'Guardando' : 'Crear pedido y armar la orden'}</button>
      </div>
    </div>
  );
}
