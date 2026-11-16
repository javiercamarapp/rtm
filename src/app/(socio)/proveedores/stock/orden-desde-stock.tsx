'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { formatearMoneda, formatearPiezas, marcaMayus, nombreVape, saborMayus } from '@/dominio/formato';
import { lineasDeOrden, type ModeloOrden } from '@/dominio/proveedores/orden';
import { useAccion } from '../../operacion/usar-accion';

interface Props { proveedor: 'Karen' | 'Isaac'; modelos: ModeloOrden[]; conLectura: boolean }

/** Lista por modelo y sabor con cantidades; "Generar orden de compra" crea la orden (borrador, sin mover dinero hasta confirmarla) y abre su PDF. */
export function OrdenDesdeStock({ proveedor, modelos, conLectura }: Props) {
  const router = useRouter();
  const { correr, ocupado, error } = useAccion();
  const [q, setQ] = useState('');
  const [soloDisp, setSoloDisp] = useState(conLectura);
  const [cant, setCant] = useState<Map<number, number>>(new Map());
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const t = normalizar(q);
  const visibles = useMemo(() => modelos
    .map((m) => ({ ...m, sabores: m.sabores.filter((s) => (!soloDisp || s.disponible !== false) && (t === '' || normalizar(`${m.marca} ${m.modelo} ${s.sabor}`).includes(t))) }))
    .filter((m) => m.sabores.length > 0), [modelos, soloDisp, t]);

  const lineas = lineasDeOrden(cant);
  const piezas = lineas.reduce((a, l) => a + l.pagadas, 0);
  const costoDe = new Map(modelos.flatMap((m) => m.sabores.map((s) => [s.skuId, s.costoCent] as const)));
  const sinCosto = lineas.some((l) => costoDe.get(l.sku_id) === null);
  const estimado = lineas.reduce((a, l) => a + BigInt(l.pagadas) * (costoDe.get(l.sku_id) ?? 0n), 0n);

  const poner = (skuId: number, valor: string) => {
    const n = valor.trim() === '' ? 0 : Math.trunc(Number(valor));
    setCant((c) => { const x = new Map(c); if (Number.isFinite(n) && n > 0) x.set(skuId, Math.min(n, 99999)); else x.delete(skuId); return x; });
  };
  const alternar = (clave: string) => setAbiertos((a) => { const x = new Set(a); if (x.has(clave)) x.delete(clave); else x.add(clave); return x; });

  const generar = () => {
    if (lineas.length === 0 || sinCosto) return;
    correr('crear_compra', { p_proveedor: proveedor, p_guia_cent: 0, p_seguro_cent: 0, p_guia_pagada_por: null, p_socio_excedente: null, p_lineas: lineas },
      (datos) => {
        const id = String(datos['compra_id']);
        window.open(`/proveedores/compras/${id}/pdf`, '_blank', 'noopener');
        router.push(`/proveedores/compras/${id}`);
      });
  };

  return (
    <section className="rtm-os" aria-label={`Orden de compra a ${proveedor}`} data-testid="orden-stock">
      <header className="rtm-os-cab">
        <div><h2>Pedir a {proveedor}</h2><p className="rtm-nota">Pon la cantidad por sabor y genera la orden: queda como borrador con su PDF; el dinero se mueve hasta confirmarla.</p></div>
        <div className="rtm-os-filtros">
          <label className="rtm-solo-lectores" htmlFor="os-q">Buscar modelo o sabor</label>
          <input id="os-q" type="search" className="rtm-campo" placeholder="Buscar modelo o sabor" value={q} onChange={(e) => setQ(e.target.value)} data-testid="os-buscar" />
          {conLectura && <label className="rtm-st-check"><input type="checkbox" checked={soloDisp} onChange={(e) => setSoloDisp(e.target.checked)} data-testid="os-solo-disp" /><span>Solo disponibles</span></label>}
        </div>
      </header>

      {visibles.length === 0 ? <p className="rtm-os-vacio" data-testid="os-vacio">Nada que pedir con ese filtro.</p> : (
        <ul className="rtm-os-lista">
          {visibles.map((m) => {
            const abierto = abiertos.has(m.clave) || t !== '';
            const pedidas = m.sabores.reduce((a, s) => a + (cant.get(s.skuId) ?? 0), 0);
            return (
              <li key={m.clave} className="rtm-os-modelo rtm-entra" data-abierto={abierto || undefined} data-testid={`os-modelo-${m.clave}`}>
                <button type="button" className="rtm-os-cabecera" aria-expanded={abierto} onClick={() => alternar(m.clave)}>
                  <span className="rtm-os-nombre"><b>{nombreVape(m.modelo)}</b><span className="rtm-nota">{marcaMayus(m.marca)}</span></span>
                  <span className="rtm-os-meta">{conLectura ? `${m.disponibles} de ${m.sabores.length} sabores disponibles` : `${m.sabores.length} sabores`}</span>
                  {pedidas > 0 && <span className="rtm-os-pedidas" data-testid={`os-pedidas-${m.clave}`}>{formatearPiezas(pedidas)}</span>}
                  <span className="rtm-os-flecha" aria-hidden="true" />
                </button>
                {abierto && (
                  <ul className="rtm-os-sabores">
                    {m.sabores.map((s) => (
                      <li key={s.skuId} data-agotado={s.disponible === false || undefined}>
                        <label htmlFor={`os-${s.skuId}`}>
                          <span>{saborMayus(s.sabor)}</span>
                          <span className="rtm-nota">{s.disponible === false ? 'Agotado' : s.disponible === true ? 'Disponible' : 'Por confirmar'}{s.costoCent === null ? ' · sin costo vigente' : ''}</span>
                        </label>
                        <input id={`os-${s.skuId}`} className="rtm-campo rtm-campo-num" inputMode="numeric" placeholder="0" value={cant.get(s.skuId) ?? ''} disabled={s.costoCent === null} onChange={(e) => poner(s.skuId, e.target.value)} aria-label={`Piezas de ${saborMayus(s.sabor)} de ${nombreVape(m.modelo)}`} data-testid={`os-cant-${s.skuId}`} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="rtm-os-pie" data-activo={piezas > 0 || undefined}>
        <div><b data-testid="os-piezas">{formatearPiezas(piezas)}</b><span className="rtm-nota"> · {lineas.length} {lineas.length === 1 ? 'sabor' : 'sabores'}{estimado > 0n ? ` · costo de lista estimado ${formatearMoneda(estimado)}` : ''}</span></div>
        {(error) && <p className="rtm-error" role="alert">{error}</p>}
        <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado || piezas === 0 || sinCosto} onClick={generar} data-testid="os-generar">{ocupado ? 'Generando' : 'Generar orden de compra'}</button>
      </footer>
    </section>
  );
}
