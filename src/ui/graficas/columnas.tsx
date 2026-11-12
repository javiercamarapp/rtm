'use client';

import { useState } from 'react';
import { useAnimacionActiva } from '../movimiento/cliente';
import { MarcoGrafica, estadoDe } from './marco';
import { compactoEs, escalaBonita } from './escalas';
import { CintaLectura, ContenidoTip, TooltipGrafica } from './tooltip-grafica';
import { useAnchoReal } from './use-ancho';
import { useNavegacionTeclado, useUidSvg } from './piezas';
import { exigirFinitos, r2, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface DatoColumna {
  id: string;
  etiqueta: string;
  /** Solo geometria; el texto exacto viaja en `texto`. */
  valor: number;
  texto: string;
  /** Periodo en curso: trama diagonal y sin variacion calculada. */
  parcial?: boolean;
  detalle?: string;
  /** Variacion ya formateada contra el periodo anterior COMPLETO ("▲ +4.2 % contra la semana anterior"). */
  variacion?: string;
}

interface Props extends BaseGrafica {
  datos: readonly DatoColumna[];
  unidad: string;
  /** Formato del eje Y (por omision, abreviatura es-MX). */
  formatoEje?: (n: number) => string;
  alto?: number;
  tablaAbierta?: boolean;
}

const MI = 52; // margen izquierdo para las marcas del eje
const MS = 14;
const MB = 24;

/** Columnas por periodo a ancho real: eje cero, 3 marcas, el maximo y el ultimo periodo completo en tinta plena, el resto al 58 %, parcial con trama,
 *  tooltip en cuatro niveles (cursor y teclado) y cinta fija en pantallas tactiles. */
export function ColumnasPeriodo({ datos, unidad, formatoEje = compactoEs, alto: altoPedido = 168, tablaAbierta, ...base }: Props) {
  // Altura segun los datos: con casi todo en cero la grafica se achata, y con una sola semana con datos se reemplaza por un resumen compacto.
  const conDato = datos.filter((d) => d.valor > 0);
  const alto = conDato.length / Math.max(1, datos.length) < 0.4 ? Math.min(altoPedido, 104) : altoPedido;
  const soloUna = datos.length > 1 && conDato.length <= 1;
  const uid = useUidSvg();
  const { ref, ancho } = useAnchoReal();
  const anima = useAnimacionActiva();
  const nav = useNavegacionTeclado(datos.length, 1);
  const [activo, setActivo] = useState<number | null>(null);
  const calculo = seguro(() => {
    exigirFinitos(datos.map((d) => d.valor), 'columnas');
    const max = Math.max(0, ...datos.map((d) => d.valor));
    const { tope, marcas } = escalaBonita(max);
    const util = ancho - MI - 8;
    const paso = util / Math.max(1, datos.length);
    const grosor = Math.min(22, Math.max(3, paso * 0.6));
    const y = (v: number) => alto - MB - (Math.max(0, v) / tope) * (alto - MB - MS);
    const completos = datos.map((d, i) => (d.parcial ? -1 : i)).filter((i) => i >= 0);
    const ultimoCompleto = completos.length ? completos[completos.length - 1]! : -1;
    const iMax = datos.reduce((m, d, i) => (d.valor > (datos[m]?.valor ?? -Infinity) ? i : m), 0);
    return { marcas, paso, grosor, y, ultimoCompleto, iMax };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'e', titulo: 'Periodo' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'p', titulo: 'Estado' }],
    filas: datos.map((d) => ({ clave: d.id, celdas: [d.etiqueta, d.texto, d.parcial ? 'Parcial' : 'Completo'] })),
  };
  const sel = activo !== null ? datos[activo] : undefined;
  const c = calculo.ok ? calculo.valor : null;
  const cx = (i: number) => (c ? MI + c.paso * i + c.paso / 2 : 0);
  return (
    <MarcoGrafica {...base} forma="barras" tabla={tabla} tablaAbierta={tablaAbierta} estado={estadoDe(base.estado, calculo.ok)} mensajeError={calculo.ok ? undefined : calculo.error.message}>
      {c && soloUna && (
        <p className="rtm-g-resumen">
          {conDato[0] ? <><b>{conDato[0].etiqueta}</b>: {conDato[0].texto}{conDato[0].parcial ? ' (parcial)' : ''}. </> : 'Sin movimiento en el periodo. '}
          Las otras {datos.length - conDato.length} semanas no tienen movimiento.
        </p>
      )}
      {c && !soloUna && (
        <>
          <CintaLectura>{sel ? <>{sel.etiqueta}: <b>{sel.texto}</b>{sel.parcial ? ' (parcial)' : ''}</> : null}</CintaLectura>
          <div className="rtm-g-rel" ref={ref}>
            <svg className="rtm-g-svg rtm-g-svg-real" width={ancho} height={alto} role="group" aria-label={base.descripcion} focusable="false" data-anim={anima ? 'on' : 'off'} onMouseLeave={() => setActivo(null)}>
              <defs>
                <pattern id={`${uid}-h`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="rtm-g-pat-linea" /></pattern>
              </defs>
              {c.marcas.map((m) => (
                <g key={m}>
                  <line x1={MI} x2={ancho - 8} y1={r2(c.y(m))} y2={r2(c.y(m))} className={m === 0 ? 'rtm-g-eje-cero' : 'rtm-g-rejilla'} />
                  <text x={MI - 6} y={r2(c.y(m) + 4)} textAnchor="end" className="rtm-g-texto">{formatoEje(m)}</text>
                </g>
              ))}
              {datos.map((d, i) => {
                const foco = i === c.iMax || i === c.ultimoCompleto;
                const h = Math.max(2, c.y(0) - c.y(d.valor));
                const x = r2(cx(i) - c.grosor / 2);
                const y = r2(c.y(0) - h);
                return (
                  <g key={d.id} className="rtm-g-col" data-activa={activo === i || undefined}>
                    <rect x={r2(cx(i) - c.paso / 2)} y={MS} width={r2(c.paso)} height={alto - MS - MB} className="rtm-g-zona" onMouseEnter={() => setActivo(i)} onClick={() => setActivo(i)} />
                    <rect x={x} y={y} width={r2(c.grosor)} height={r2(h)} rx={3} className={foco ? 'rtm-g-col-barra rtm-g-col-foco' : 'rtm-g-col-barra'} data-barra={i} />
                    {d.parcial && <rect x={x} y={y} width={r2(c.grosor)} height={r2(h)} rx={3} fill={`url(#${uid}-h)`} className="rtm-g-trama-capa" />}
                    <rect {...nav.props(i)} x={r2(cx(i) - c.paso / 2)} y={MS} width={r2(c.paso)} height={alto - MS - MB} className="rtm-g-foco-tecla" role="img" aria-label={`${d.etiqueta}: ${d.texto}${d.parcial ? ' (parcial)' : ''}`}
                      onFocus={() => { nav.props(i).onFocus(); setActivo(i); }} onBlur={() => setActivo(null)} />
                    {(i === 0 || i === datos.length - 1 || datos.length <= 8) && <text x={r2(cx(i))} y={alto - 6} textAnchor="middle" className="rtm-g-texto">{d.etiqueta}</text>}
                    {i === c.iMax && <text x={r2(cx(i))} y={r2(y - 4)} textAnchor="middle" className="rtm-g-texto-fuerte">{d.texto}</text>}
                  </g>
                );
              })}
            </svg>
            <TooltipGrafica visible={sel !== undefined} x={activo !== null ? cx(activo) : 0} y={sel ? c.y(sel.valor) : 0} ancho={ancho}>
              {sel && <ContenidoTip titulo={sel.etiqueta} cifra={sel.texto} variacion={sel.parcial ? undefined : sel.variacion} detalle={sel.detalle} parcial={sel.parcial} />}
            </TooltipGrafica>
          </div>
        </>
      )}
    </MarcoGrafica>
  );
}
