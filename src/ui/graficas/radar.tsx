'use client';

import { Marcador, formaDeSerie, useNavegacionTeclado } from './piezas';
import { MarcoGrafica } from './marco';
import { ErrorGrafica, MAX_EJES_RADAR, acotar, exigirNoNegativos, puntoRadar, r2, rutaPoligonal, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface SerieRadar {
  id: string;
  etiqueta: string;
  valores: readonly number[];
  textos: readonly string[];
}

interface Props extends BaseGrafica {
  /** Hasta 8 ejes (por ejemplo las 8 marcas). */
  ejes: readonly string[];
  /** Una o dos series: la primera trazo continuo con circulos; la segunda discontinuo con cuadrados. */
  series: readonly SerieRadar[];
  /** Valor que cierra el aro exterior; por omision el maximo de los datos. */
  maximo?: number;
  tablaAbierta?: boolean;
}

const W = 560;
const H = 320;
const CX = W / 2;
const CY = H / 2 + 6;
const R = 112;
const ANILLOS = [0.25, 0.5, 0.75, 1];

/** Radar (hasta 8 ejes, 1 o 2 series). Es el menos defendible de los 12 tipos, por eso siempre trae su tabla. */
export function Radar({ ejes, series, maximo, tablaAbierta, ...base }: Props) {
  const nav = useNavegacionTeclado(ejes.length, 1);
  const calculo = seguro(() => {
    if (ejes.length < 3) throw new ErrorGrafica('datos_vacios', 'El radar necesita al menos 3 ejes.');
    if (ejes.length > MAX_EJES_RADAR) throw new ErrorGrafica('demasiados_ejes', `El radar admite como máximo ${MAX_EJES_RADAR} ejes.`);
    if (series.length === 0) throw new ErrorGrafica('datos_vacios', 'El radar necesita una serie.');
    if (series.length > 2) throw new ErrorGrafica('demasiadas_series', 'El radar admite como máximo 2 series.');
    for (const s of series) {
      if (s.valores.length !== ejes.length || s.textos.length !== ejes.length) throw new ErrorGrafica('longitud_distinta', `La serie ${s.etiqueta} no coincide con los ejes.`);
      exigirNoNegativos(s.valores, 'radar');
    }
    const tope = maximo ?? Math.max(1, ...series.flatMap((s) => s.valores));
    const poligonos = series.map((s) => s.valores.map((v, i) => puntoRadar(i, ejes.length, (acotar(v, 0, tope) / tope) * R, CX, CY)));
    return { tope, poligonos };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'e', titulo: 'Eje' }, ...series.map((s, i) => ({ id: `s${i}`, titulo: s.etiqueta, numerica: true }))],
    filas: ejes.map((e, i) => ({ clave: e, celdas: [e, ...series.map((s) => s.textos[i] ?? 'Sin dato')] })),
  };
  return (
    <MarcoGrafica {...base} forma="radar" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={calculo.ok ? (
        <ul className="rtm-g-leyenda" aria-label="Series">
          {series.map((s, si) => (
            <li key={s.id}>
              <svg viewBox="0 0 28 12" width="28" height="12" aria-hidden="true" focusable="false">
                <line x1="1" x2="27" y1="6" y2="6" className={si === 0 ? 'rtm-g-traza-leyenda' : 'rtm-g-traza-leyenda rtm-g-traza-leyenda-disc'} />
                <Marcador forma={formaDeSerie(si)} x={14} y={6} r={3} className={si === 0 ? 'rtm-g-punto-foco' : 'rtm-g-punto-segunda'} />
              </svg>
              {s.etiqueta}
            </li>
          ))}
        </ul>
      ) : undefined}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={base.descripcion} focusable="false">
            {ANILLOS.map((a) => (
              <polygon key={a} points={ejes.map((_, i) => puntoRadar(i, ejes.length, R * a, CX, CY).map(r2).join(',')).join(' ')} className="rtm-g-anillo" fill="none" />
            ))}
            {ejes.map((_, i) => {
              const [x, y] = puntoRadar(i, ejes.length, R, CX, CY);
              return <line key={i} x1={CX} y1={CY} x2={r2(x)} y2={r2(y)} className="rtm-g-eje" />;
            })}
            {series.map((s, si) => (
              <path key={s.id} d={`${rutaPoligonal(calculo.valor.poligonos[si]!)} Z`} pathLength={1} fill="none" className={si === 0 ? 'rtm-g-traza rtm-g-radar-1' : 'rtm-g-traza-estimada rtm-g-radar-2 rtm-g-aparece'} />
            ))}
            {ejes.map((e, i) => {
              const [lx, ly] = puntoRadar(i, ejes.length, R + 18, CX, CY);
              const [px, py] = puntoRadar(i, ejes.length, R + 6, CX, CY);
              return (
                <g key={e} role="img" aria-label={`${e}: ${series.map((s) => `${s.etiqueta} ${s.textos[i]}`).join(', ')}`} data-marca={e} className="rtm-g-marca" {...nav.props(i)}>
                  {series.map((s, si) => {
                    const [x, y] = calculo.valor.poligonos[si]![i]!;
                    return <Marcador key={s.id} forma={formaDeSerie(si)} x={x} y={y} r={3.5} className={si === 0 ? 'rtm-g-punto-foco' : 'rtm-g-punto-segunda'} />;
                  })}
                  <circle cx={r2(px)} cy={r2(py)} r="8" className="rtm-g-zona" />
                  <text x={r2(lx)} y={r2(ly + 4)} textAnchor={Math.abs(lx - CX) < 4 ? 'middle' : lx > CX ? 'start' : 'end'} className="rtm-g-texto-fuerte">{e}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
