'use client';

import { DefsPatrones, Marcador, useNavegacionTeclado, useUidSvg } from './piezas';
import { MarcoGrafica } from './marco';
import { ErrorGrafica, escala, exigirFinitos, extremos, r2, rutaBanda, rutaPoligonal, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface PuntoLinea {
  id: string;
  etiqueta: string;
  valor: number;
  texto: string;
  /** Observado (por omision) o estimado. Lo estimado va con trazo discontinuo y rombo, nunca interpolado como hecho. */
  tipo?: 'observado' | 'estimado';
  /** Rango de la proyeccion (solo en puntos estimados). */
  bajo?: number;
  alto?: number;
}

interface Props extends BaseGrafica {
  puntos: readonly PuntoLinea[];
  unidad: string;
  /** Anotacion en texto sobre un punto (el hecho principal). Sin rojo. */
  anotacion?: { id: string; texto: string };
  tablaAbierta?: boolean;
}

const W = 560;
const H = 240;
const M = { i: 28, d: 28, s: 36, b: 40 };

/** Linea con anotacion y banda de proyeccion. */
export function LineaProyeccion({ puntos, unidad, anotacion, tablaAbierta, ...base }: Props) {
  const nav = useNavegacionTeclado(puntos.length, 1);
  const uid = useUidSvg();
  const calculo = seguro(() => {
    if (puntos.length < 2) throw new ErrorGrafica('datos_vacios', 'Hace falta más de un punto para dibujar la línea.');
    exigirFinitos(puntos.flatMap((p) => [p.valor, p.bajo ?? p.valor, p.alto ?? p.valor]), 'linea');
    const { min, max } = extremos(puntos.flatMap((p) => [p.valor, p.bajo ?? p.valor, p.alto ?? p.valor]));
    const x = escala(0, puntos.length - 1, M.i, W - M.d);
    const y = escala(min, max, H - M.b, M.s);
    const pts = puntos.map((p, i) => [x(i), y(p.valor)] as const);
    const ultimoObs = puntos.reduce((acc, p, i) => ((p.tipo ?? 'observado') === 'observado' ? i : acc), -1);
    const obs = pts.slice(0, ultimoObs + 1);
    const est = ultimoObs >= 0 ? pts.slice(ultimoObs) : [...pts];
    const conRango = puntos.map((p, i) => ({ p, i })).filter(({ p, i }) => i >= ultimoObs && p.bajo !== undefined && p.alto !== undefined);
    const alto = conRango.map(({ p, i }) => [x(i), y(i === ultimoObs ? p.valor : p.alto!)] as const);
    const bajo = conRango.map(({ p, i }) => [x(i), y(i === ultimoObs ? p.valor : p.bajo!)] as const);
    return { pts, obs, est: est.length >= 2 ? est : [], banda: alto.length >= 2 ? rutaBanda(alto, bajo) : null, puntoMax: puntos.reduce((a, p) => (p.valor > a.valor ? p : a), puntos[0]!), x, y };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'e', titulo: 'Periodo' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'p', titulo: 'Procedencia' }, { id: 'r', titulo: 'Rango', numerica: true }],
    filas: puntos.map((p) => ({ clave: p.id, celdas: [p.etiqueta, p.texto, (p.tipo ?? 'observado') === 'observado' ? 'Observado' : 'Estimado', p.bajo !== undefined && p.alto !== undefined ? `${p.bajo} a ${p.alto}` : 'No aplica'] })),
  };
  const idxNota = anotacion ? puntos.findIndex((p) => p.id === anotacion.id) : -1;
  return (
    <MarcoGrafica {...base} forma="linea" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={base.descripcion} focusable="false">
            <DefsPatrones uid={uid} />
            <line x1={M.i} x2={W - M.d} y1={H - M.b} y2={H - M.b} className="rtm-g-eje" />
            {calculo.valor.banda && (
              <g className="rtm-g-aparece" data-banda="proyeccion">
                <path d={calculo.valor.banda} className="rtm-g-banda" />
                <path d={calculo.valor.banda} fill={`url(#${uid}-rayas)`} className="rtm-g-banda-trama" />
              </g>
            )}
            <path d={rutaPoligonal(calculo.valor.obs)} pathLength={1} className="rtm-g-traza" fill="none" />
            {calculo.valor.est.length > 0 && <path d={rutaPoligonal(calculo.valor.est)} className="rtm-g-traza-estimada rtm-g-aparece" fill="none" />}
            {puntos.map((p, i) => {
              const [px, py] = calculo.valor.pts[i]!;
              const est = (p.tipo ?? 'observado') === 'estimado';
              const ultimo = i === puntos.length - 1;
              return (
                <g key={p.id} role="img" aria-label={`${p.etiqueta}: ${p.texto}, ${est ? 'estimado' : 'observado'}`} data-marca={p.id} data-procedencia={est ? 'estimado' : 'observado'} className="rtm-g-marca" {...nav.props(i)}>
                  <Marcador forma={est ? 'rombo' : 'circulo'} x={px} y={py} r={ultimo ? 5 : 3.5} className={est ? 'rtm-g-punto-estimado' : ultimo ? 'rtm-g-punto-foco' : 'rtm-g-punto'} />
                </g>
              );
            })}
            <text x={M.i} y={H - 16} className="rtm-g-texto">{puntos[0]!.etiqueta}</text>
            <text x={W - M.d} y={H - 16} textAnchor="end" className="rtm-g-texto">{puntos[puntos.length - 1]!.etiqueta}</text>
            <text x={M.i} y={16} className="rtm-g-texto">{`Máx. ${calculo.valor.puntoMax.texto}`}</text>
            {idxNota >= 0 && anotacion && (
              <g className="rtm-g-aparece" data-anotacion={anotacion.id}>
                <line x1={calculo.valor.pts[idxNota]![0]} x2={calculo.valor.pts[idxNota]![0]} y1={r2(calculo.valor.pts[idxNota]![1] - 8)} y2={r2(calculo.valor.pts[idxNota]![1] - 22)} className="rtm-g-guia" />
                <text x={calculo.valor.pts[idxNota]![0]} y={r2(calculo.valor.pts[idxNota]![1] - 28)} textAnchor={idxNota > puntos.length / 2 ? 'end' : 'start'} className="rtm-g-texto-fuerte">{anotacion.texto}</text>
              </g>
            )}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
