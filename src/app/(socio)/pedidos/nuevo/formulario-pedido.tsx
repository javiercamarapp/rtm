'use client';

import { plazoDeFormulario, type CondicionPago } from '@/dominio/operacion/plazo_pedido';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { bigintACentavos } from '@/dominio/operacion/json';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { CatalogoPedido, Origen } from '@/dominio/operacion/tipos';
import { ModeloTarjeta } from '@/ui/componentes/modelo';
import { ORIGEN } from '../../operacion/etiquetas';
import { centavosDeTexto, useAccion } from '../../operacion/usar-accion';

interface Renglon { sku_id: number; modelo: string; sabor: string; piezas: number; precio: string; motivo: string; tab: bigint | null }

const textoPesos = (c: bigint | null) => (c === null ? '' : formatearMoneda(c).replace('$', ''));

export function FormularioPedido({ clienteId, clienteNombre, catalogo }: { clienteId: number; clienteNombre: string; catalogo: CatalogoPedido }) {
  const router = useRouter();
  const { correr, ocupado, error } = useAccion();
  const modelos = useMemo(() => {
    const m = new Map<number, { id: number; marca: string; nombre: string; estado: string }>();
    for (const s of catalogo.skus) if (!m.has(s.modelo_id)) m.set(s.modelo_id, { id: s.modelo_id, marca: s.marca, nombre: s.modelo, estado: s.estado });
    return [...m.values()];
  }, [catalogo.skus]);

  const [origen, setOrigen] = useState<Origen>('bodega_omar');
  const [modeloId, setModeloId] = useState<number | ''>('');
  const [skuId, setSkuId] = useState<number | ''>('');
  const [piezas, setPiezas] = useState('');
  const [precio, setPrecio] = useState('');
  const [motivo, setMotivo] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [envio, setEnvio] = useState(textoPesos(catalogo.envio_default_cent));
  const [descuento, setDescuento] = useState('');
  const [recargo, setRecargo] = useState('');
  const [condicion, setCondicion] = useState<CondicionPago>('');
  const [plazo, setPlazo] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const sabores = catalogo.skus.filter((s) => s.modelo_id === modeloId);
  const sku = catalogo.skus.find((s) => s.sku_id === skuId);

  const elegirModelo = (id: number | '') => {
    setModeloId(id);
    setSkuId('');
    const primero = catalogo.skus.find((s) => s.modelo_id === id);
    setPrecio(textoPesos(primero?.precio_cent ?? null));
  };
  const agregar = () => {
    if (!sku) return setLocal('Elige modelo y sabor.');
    const n = Number(piezas);
    if (!Number.isInteger(n) || n <= 0) return setLocal('Las piezas deben ser un entero positivo.');
    if (centavosDeTexto(precio) === null || centavosDeTexto(precio) === 0) return setLocal('Escribe el precio por pieza (por ejemplo 250 o 250.00).');
    setLocal(null);
    setRenglones((r) => [...r, { sku_id: sku.sku_id, modelo: sku.modelo, sabor: sku.sabor, piezas: n, precio, motivo, tab: sku.precio_cent }]);
    setPiezas('');
    setMotivo('');
  };

  const crear = () => {
    if (renglones.length === 0) return setLocal('Agrega al menos un renglón.');
    const e = centavosDeTexto(envio || '0');
    const d = centavosDeTexto(descuento || '0');
    const r = centavosDeTexto(recargo || '0');
    if (e === null || d === null || r === null) return setLocal('Revisa envío, descuento y recargo: deben ser montos como 300 o 300.00.');
    const pz = plazoDeFormulario(condicion, plazo);
    if (!pz.ok) return setLocal(pz.mensaje);
    setLocal(null);
    correr('crear_pedido', {
      p_cliente_id: clienteId, p_origen: origen, p_envio_cent: e, p_descuento_cent: d, p_recargo_cent: r, p_plazo_dias: pz.plazo_dias,
      p_lineas: renglones.map((x) => ({ sku_id: x.sku_id, piezas: x.piezas, precio_cent: centavosDeTexto(x.precio), motivo_precio: x.motivo || undefined })),
    }, (datos) => router.push(`/pedidos/${String(datos['pedido_id'])}`));
  };

  return (
    <div className="rtm-form" aria-label={`Pedido de ${clienteNombre}`}>
      <section className="rtm-seccion" aria-label="Origen">
        <h2>Origen del pedido</h2>
        <label className="rtm-etiqueta-campo rtm-campo-ancho">Sale de
          <select className="rtm-campo" value={origen} onChange={(e) => setOrigen(e.target.value as Origen)} data-testid="origen">
            {(Object.keys(ORIGEN) as Origen[]).map((o) => <option key={o} value={o}>{ORIGEN[o]}</option>)}
          </select>
        </label>
        <p className="rtm-nota">Desde la Bodega Omar el pedido descuenta inventario y devenga la renta de bodega al marcarlo enviado. Un pedido directo de Isaac o Karen no pasa por Mérida: no mueve inventario ni genera renta.</p>
      </section>

      <section className="rtm-seccion" aria-label="Renglones">
        <h2>Renglones</h2>
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Modelo
            <select className="rtm-campo" value={modeloId} onChange={(e) => elegirModelo(e.target.value === '' ? '' : Number(e.target.value))} data-testid="modelo">
              <option value="">Elige un modelo</option>
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.marca} · {m.nombre}{m.estado === 'sin_disponibilidad' ? ' (sin disponibilidad)' : ''}</option>)}
            </select>
          </label>
          {modeloId !== '' && (() => { const x = modelos.find((y) => y.id === modeloId); return x ? <ModeloTarjeta modelo={x.nombre} marca={x.marca} tam="s" testid="modelo-elegido" /> : null; })()}
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Sabor
            <select className="rtm-campo" value={skuId} onChange={(e) => setSkuId(e.target.value === '' ? '' : Number(e.target.value))} disabled={modeloId === ''} data-testid="sabor">
              <option value="">Elige un sabor</option>
              {sabores.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sabor} · disponibles {formatearPiezas(Math.max(s.disponible, 0))}</option>)}
            </select>
          </label>
          <label className="rtm-etiqueta-campo">Piezas
            <input className="rtm-campo rtm-campo-num" inputMode="numeric" value={piezas} onChange={(e) => setPiezas(e.target.value)} data-testid="piezas" />
          </label>
          <label className="rtm-etiqueta-campo">Precio por pieza
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} data-testid="precio" />
          </label>
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Motivo si cambias el precio
            <input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="motivo" />
          </label>
          <button type="button" className="rtm-boton" onClick={agregar} data-testid="agregar-renglon">Agregar renglón</button>
        </div>
        {sku && <p className="rtm-nota">Tabulador del cliente: {sku.precio_cent === null ? 'sin precio (escríbelo a mano)' : formatearMoneda(sku.precio_cent)} · existencia {formatearPiezas(sku.existencia)} · disponible {formatearPiezas(Math.max(sku.disponible, 0))}</p>}
        {renglones.length > 0 && (
          <ul className="rtm-lineas-form" aria-label="Renglones agregados">
            {renglones.map((x, i) => (
              <li key={`${x.sku_id}-${i}`} className="rtm-acciones-fila">
                <span>{x.modelo} · {x.sabor} · {formatearPiezas(x.piezas)} a ${x.precio}{x.tab !== null && centavosDeTexto(x.precio) !== bigintACentavos(x.tab) ? ' (distinto del tabulador)' : ''}</span>
                <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setRenglones((r) => r.filter((_, j) => j !== i))}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rtm-seccion" aria-label="Cargos">
        <h2>Envío y ajustes</h2>
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo">Envío cobrado
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={envio} onChange={(e) => setEnvio(e.target.value)} data-testid="envio" />
          </label>
          <label className="rtm-etiqueta-campo">Descuento
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} />
          </label>
          <label className="rtm-etiqueta-campo">Recargo
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={recargo} onChange={(e) => setRecargo(e.target.value)} />
          </label>
          <label className="rtm-etiqueta-campo">Condición de pago (obligatoria)
            <select className="rtm-campo" value={condicion} onChange={(e) => setCondicion(e.target.value as CondicionPago)} data-testid="condicion-pago" aria-required="true">
              <option value="">Elige…</option>
              <option value="contado">De contado</option>
              <option value="credito">A crédito</option>
            </select>
          </label>
          {condicion === 'credito' && (
            <label className="rtm-etiqueta-campo">Plazo (días)
              <input className="rtm-campo rtm-campo-num" inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value)} data-testid="plazo-dias" aria-required="true" />
            </label>
          )}
        </div>
        <p className="rtm-nota">Envío en 0 = no se cobra. El total se calcula al enviar, sobre lo que realmente salga. Todo pedido lleva condición de pago: a crédito exige el plazo en días (el vencimiento se cuenta desde el envío).</p>
      </section>

      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <div className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={crear} disabled={ocupado} data-testid="crear-pedido">{ocupado ? 'Guardando' : 'Crear pedido'}</button>
      </div>
    </div>
  );
}
