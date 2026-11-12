'use client';

import { useState, type PointerEvent } from 'react';
import { useAnimacionActiva } from '../movimiento/cliente';
import { MarcoGrafica, estadoDe } from './marco';
import { compactoEs, escalaBonita } from './escalas';
import { CintaLectura, ContenidoTip, TooltipGrafica } from './tooltip-grafica';
import { useAnchoReal } from './use-ancho';
import { exigirFinitos, r2, rutaPoligonal, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface PuntoArea { id: string; etiqueta: string; valor: number; texto: string; parcial?: boolean; detalle?: string; variacion?: string }

interface Props extends BaseGrafica {
  puntos: readonly PuntoArea[];
  unidad: string;
  formatoEje?: (n: number) => string;
  alto?: number;
  tablaAbierta?: boolean;
}

const MI = 52;
const MD = 12;
const MS = 14;
const MB = 24;

/** Area con linea de 1.75 px, relleno plano al 12 % (sin degradado), tooltip con cruceta que sigue al cursor, tramo parcial discontinuo con circulo hueco
 *  y punto final en tinta. Con menos de 2 puntos no se dibuja. */
export function AreaSerie({ puntos, unidad, formatoEje = compactoEs, alto = 168, tablaAbierta, ...base }: Props) {
  const { ref, ancho } = useAnchoReal();
  const anima = useAnimacionActiva();
  const [activo, setActivo] = useState<number | null>(null);
  const calculo = seguro(() => {
    exigirFinitos(puntos.map((p) => p.valor), 'area');
    if (puntos.length < 2) throw new RangeError('hacen falta al menos 2 puntos');
    const max = Math.max(0, ...puntos.map((p) => p.valor));
    const { tope, marcas } = escalaBonita(max);
    const x = (i: number) => MI + (i / (puntos.length - 1)) * (ancho - MI - MD);
    const y = (v: number) => alto - MB - (Math.max(0, v) / tope) * (alto - MB - MS);
    const pts = puntos.map((p, i) => [x(i), y(p.valor)] as const);
    const iParcial = puntos.findIndex((p) => p.parcial);
    const firme = iParcial < 0 ? pts : pts.slice(0, Math.max(1, iParcial));
    const tramoParcial = iParcial < 0 ? null : pts.slice(Math.max(0, iParcial - 1));
    return { marcas, x, y, pts, firme, tramoParcial };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'e', titulo: 'Periodo' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'p', titulo: 'Estado' }],
    filas: puntos.map((p) => ({ clave: p.id, celdas: [p.etiqueta, p.texto, p.parcial ? 'Parcial' : 'Completo'] })),
  };
  const c = calculo.ok ? calculo.valor : null;
  const sel = activo !== null ? puntos[activo] : undefined;
  const alMover = (e: PointerEvent<SVGSVGElement>) => {
    if (!c) return;
    const caja = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - caja.left;
    const i = Math.round(((px - MI) / (ancho - MI - MD)) * (puntos.length - 1));
    setActivo(Math.min(puntos.length - 1, Math.max(0, i)));
  };
  const ultimo = c ? c.pts[c.pts.length - 1]! : [0, 0];
  const baseY = alto - MB;
  return (
    <MarcoGrafica {...base} forma="linea" tabla={tabla} tablaAbierta={tablaAbierta} estado={estadoDe(base.estado, calculo.ok)} mensajeError={calculo.ok ? undefined : calculo.error.message}>
      {c && (
        <>
          <CintaLectura>{sel ? <>{sel.etiqueta}: <b>{sel.texto}</b>{sel.parcial ? ' (parcial)' : ''}</> : null}</CintaLectura>
          <div className="rtm-g-rel" ref={ref}>
            <svg className="rtm-g-svg rtm-g-svg-real" width={ancho} height={alto} role="img" aria-label={base.descripcion} focusable="false" data-anim={anima ? 'on' : 'off'}
              onPointerMove={alMover} onPointerLeave={() => setActivo(null)}>
              {c.marcas.map((m) => (
                <g key={m}>
                  <line x1={MI} x2={ancho - MD} y1={r2(c.y(m))} y2={r2(c.y(m))} className={m === 0 ? 'rtm-g-eje-cero' : 'rtm-g-rejilla'} />
                  <text x={MI - 6} y={r2(c.y(m) + 4)} textAnchor="end" className="rtm-g-texto">{formatoEje(m)}</text>
                </g>
              ))}
              <path d={`${rutaPoligonal(c.firme)} L ${r2(c.firme[c.firme.length - 1]![0])} ${baseY} L ${r2(c.firme[0]![0])} ${baseY} Z`} className="rtm-g-area-relleno" />
              <path d={rutaPoligonal(c.firme)} pathLength={1} className="rtm-g-area-linea" fill="none" />
              {c.tramoParcial && <path d={rutaPoligonal(c.tramoParcial)} className="rtm-g-area-parcial" fill="none" />}
              {puntos[0] && <text x={MI} y={alto - 6} className="rtm-g-texto">{puntos[0].etiqueta}</text>}
              {puntos.length > 1 && <text x={ancho - MD} y={alto - 6} textAnchor="end" className="rtm-g-texto">{puntos[puntos.length - 1]!.etiqueta}</text>}
              {puntos[puntos.length - 1]?.parcial
                ? <circle cx={r2(ultimo[0]!)} cy={r2(ultimo[1]!)} r={3} className="rtm-g-punto-hueco" />
                : <circle cx={r2(ultimo[0]!)} cy={r2(ultimo[1]!)} r={3.25} className="rtm-g-punto-final" />}
              {activo !== null && (
                <g>
                  <line x1={r2(c.x(activo))} x2={r2(c.x(activo))} y1={MS} y2={baseY} className="rtm-g-cruceta" />
                  <circle cx={r2(c.x(activo))} cy={r2(c.y(puntos[activo]!.valor))} r={4} className="rtm-g-punto-hover" />
                </g>
              )}
            </svg>
            <TooltipGrafica visible={sel !== undefined} x={activo !== null ? c.x(activo) : 0} y={sel ? c.y(sel.valor) : 0} ancho={ancho}>
              {sel && <ContenidoTip titulo={sel.etiqueta} cifra={sel.texto} variacion={sel.parcial ? undefined : sel.variacion} detalle={sel.detalle} parcial={sel.parcial} />}
            </TooltipGrafica>
          </div>
        </>
      )}
    </MarcoGrafica>
  );
}
