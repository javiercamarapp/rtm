'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { formatearMoneda } from '@/dominio/formato';
import type { CatalogoCompra } from '@/dominio/operacion/tipos';
import { centavosDeTexto, useAccion } from '../../../operacion/usar-accion';

interface Renglon { sku_id: number; modelo: string; sabor: string; pagadas: number; facturadas: number | null; costo: string; lista: bigint | null; motivo: string }
const textoPesos = (c: bigint | null) => (c === null ? '' : formatearMoneda(c).replace('$', ''));

export function FormularioCompra({ proveedor, catalogo, modeloInicial, disponibles }: { proveedor: string; catalogo: CatalogoCompra; modeloInicial?: string; disponibles?: string[] }) {
  const router = useRouter();
  const { correr, ocupado, error } = useAccion();
  const modelos = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const s of catalogo.skus) if (!vistos.has(s.modelo)) vistos.set(s.modelo, s.marca);
    return [...vistos.entries()].map(([modelo, marca]) => ({ marca, modelo }));
  }, [catalogo.skus]);
  const [modelo, setModelo] = useState(modeloInicial && catalogo.skus.some((x) => x.modelo === modeloInicial) ? modeloInicial : '');
  const [skuId, setSkuId] = useState<number | ''>('');
  const [pagadas, setPagadas] = useState('');
  const [facturadas, setFacturadas] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [guia, setGuia] = useState('');
  const [seguro, setSeguro] = useState('');
  const [guiaPagadaPor, setGuiaPagadaPor] = useState('');
  const [socioExceso, setSocioExceso] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const sabores = catalogo.skus.filter((s) => s.modelo === modelo);
  const sku = catalogo.skus.find((s) => s.sku_id === skuId);

  const agregar = () => {
    if (!sku) return setLocal('Elige modelo y sabor.');
    const p = Number(pagadas);
    const f = facturadas.trim() === '' ? null : Number(facturadas);
    if (!Number.isInteger(p) || p <= 0 || (f !== null && (!Number.isInteger(f) || f <= 0))) return setLocal('Las piezas deben ser enteros positivos.');
    const c = costo.trim() === '' ? null : centavosDeTexto(costo);
    if (costo.trim() !== '' && (c === null || c === 0)) return setLocal('El costo debe ser un monto como 110 o 110.50.');
    if (sku.costo_cent === null && c === null) return setLocal('Este modelo no tiene costo vigente con el proveedor: escribe el costo y el motivo.');
    const distinto = c !== null && (sku.costo_cent === null || BigInt(c) !== sku.costo_cent);
    if (distinto && motivo.trim() === '') return setLocal('El costo no es el de lista: el motivo es obligatorio.');
    setLocal(null);
    setRenglones((r) => [...r, { sku_id: sku.sku_id, modelo: sku.modelo, sabor: sku.sabor, pagadas: p, facturadas: f, costo: distinto ? costo : '', lista: sku.costo_cent, motivo: distinto ? motivo.trim() : '' }]);
    setPagadas('');
    setFacturadas('');
    setMotivo('');
  };

  const crear = () => {
    if (renglones.length === 0) return setLocal('Agrega al menos un renglón.');
    const g = centavosDeTexto(guia || '0');
    const s = centavosDeTexto(seguro || '0');
    if (g === null || s === null) return setLocal('Revisa guía y seguro: deben ser montos.');
    setLocal(null);
    correr('crear_compra', {
      p_proveedor: proveedor, p_guia_cent: g, p_seguro_cent: s, p_guia_pagada_por: guiaPagadaPor || null, p_socio_excedente: socioExceso || null,
      p_lineas: renglones.map((r) => ({ sku_id: r.sku_id, pagadas: r.pagadas, ...(r.facturadas !== null ? { facturadas: r.facturadas } : {}), ...(r.costo ? { costo_cent: centavosDeTexto(r.costo), motivo_costo: r.motivo } : {}) })),
    }, (datos) => router.push(`/proveedores/compras/${String(datos['compra_id'])}`));
  };

  return (
    <div className="rtm-form">
      <section className="rtm-seccion" aria-label="Renglones">
        <h2>Renglones</h2>
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Modelo
            <select className="rtm-campo" value={modelo} onChange={(e) => { setModelo(e.target.value); setSkuId(''); }} data-testid="oc-modelo">
              <option value="">Elige un modelo</option>
              {modelos.map((m) => <option key={m.modelo} value={m.modelo}>{m.marca} · {m.modelo}</option>)}
            </select>
          </label>
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Sabor
            <select className="rtm-campo" value={skuId} onChange={(e) => { const v = e.target.value === '' ? '' : Number(e.target.value); setSkuId(v); setCosto(textoPesos(catalogo.skus.find((s) => s.sku_id === v)?.costo_cent ?? null)); }} disabled={modelo === ''} data-testid="oc-sabor">
              <option value="">Elige un sabor</option>
              {sabores.map((s) => { const agotado = disponibles !== undefined && !disponibles.some((d) => normalizar(d) === normalizar(s.sabor)); return <option key={s.sku_id} value={s.sku_id} disabled={agotado}>{s.sabor}{agotado ? ' (agotado en Karen)' : ''}</option>; })}
            </select>
          </label>
          <label className="rtm-etiqueta-campo">Pagadas<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={pagadas} onChange={(e) => setPagadas(e.target.value)} data-testid="oc-pagadas" /></label>
          <label className="rtm-etiqueta-campo">Facturadas<input className="rtm-campo rtm-campo-num" inputMode="numeric" value={facturadas} onChange={(e) => setFacturadas(e.target.value)} placeholder="igual" /></label>
          <label className="rtm-etiqueta-campo">Costo por pieza<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} data-testid="oc-costo" /></label>
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Motivo si no es el costo de lista<input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="oc-motivo" /></label>
          <button type="button" className="rtm-boton" onClick={agregar} data-testid="oc-agregar">Agregar renglón</button>
        </div>
        {sku && <p className="rtm-nota">Costo de lista vigente con {proveedor}: {sku.costo_cent === null ? 'sin costo vigente' : formatearMoneda(sku.costo_cent)}</p>}
        {renglones.length > 0 && (
          <ul className="rtm-lineas-form" aria-label="Renglones agregados">
            {renglones.map((r, i) => (
              <li key={`${r.sku_id}-${i}`} className="rtm-acciones-fila">
                <span>{r.modelo} · {r.sabor} · pagadas {r.pagadas}{r.facturadas !== null ? ` · facturadas ${r.facturadas}` : ''}{r.costo ? ` · costo $${r.costo} (${r.motivo})` : ' · costo de lista'}</span>
                <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setRenglones((x) => x.filter((_, j) => j !== i))}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rtm-seccion" aria-label="Guía y seguro">
        <h2>Guía y seguro</h2>
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo">Guía<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={guia} onChange={(e) => setGuia(e.target.value)} aria-label="Costo de la guía" /></label>
          <label className="rtm-etiqueta-campo">Seguro<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={seguro} onChange={(e) => setSeguro(e.target.value)} placeholder={`${textoPesos(catalogo.seguro_reenvio_cent)} por pieza si Isaac reenvía de Karen`} aria-label="Seguro" /></label>
          <label className="rtm-etiqueta-campo">Guía pagada por un socio
            <select className="rtm-campo" value={guiaPagadaPor} onChange={(e) => setGuiaPagadaPor(e.target.value)} aria-label="Guía pagada por"><option value="">No (va a la cuenta del proveedor)</option><option>Angelo</option><option>Javier</option></select>
          </label>
          <label className="rtm-etiqueta-campo">Socio que pagó piezas de más
            <select className="rtm-campo" value={socioExceso} onChange={(e) => setSocioExceso(e.target.value)} aria-label="Socio que pagó de más"><option value="">Ninguno</option><option>Angelo</option><option>Javier</option></select>
          </label>
        </div>
        <p className="rtm-nota">Si pagadas supera a facturadas, lo pagado de más queda FUERA de la sociedad, a nombre del socio que lo pagó.</p>
      </section>
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <div className="rtm-acciones-fila"><button type="button" className="rtm-boton rtm-boton-primario" onClick={crear} disabled={ocupado} data-testid="crear-oc">{ocupado ? 'Guardando' : 'Crear orden de compra'}</button></div>
    </div>
  );
}
