'use client';

import { Marcador, formaDeSerie, useNavegacionTeclado } from './piezas';
import { MarcoGrafica } from './marco';
import { ErrorGrafica, escala, exigirFinitos, r2, rutaPoligonal, seguro } from './geo';
import { flechaDe } from './piezas';
import { sentidoDelta } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface SerieBump {
  id: string;
  etiqueta: string;
  /** Posicion en el ranking por periodo (1 = primero), decidida por el servidor. */
  posiciones: readonly number[];
  destacada?: boolean;
}

interface Props extends BaseGrafica {
  periodos: readonly string[];
  series: readonly SerieBump[];
  tablaAbierta?: boolean;
}

const W = 560;
const M = { i: 110, d: 110, s: 28, b: 36 };

/** Bump chart: quien sube y baja de lugar. Cada serie lleva forma de marcador distinta y su nombre en los dos extremos. */
export function Bump({ periodos, series, tablaAbierta, ...base }: Props) {
  const nav = useNavegacionTeclado(series.length, 1);
  const calculo = seguro(() => {
    if (periodos.length < 2) throw new ErrorGrafica('datos_vacios', 'El bump chart necesita al menos 2 periodos.');
    if (series.length === 0) throw new ErrorGrafica('datos_vacios', 'El bump chart necesita series.');
    for (const s of series) {
      if (s.posiciones.length !== periodos.length) throw new ErrorGrafica('longitud_distinta', `La serie ${s.etiqueta} no coincide con los periodos.`);
      exigirFinitos(s.posiciones, 'bump');
    }
    const maxPos = Math.max(...series.flatMap((s) => s.posiciones));
    const alto = M.s + M.b + Math.max(1, maxPos - 1) * 38 + 20;
    const x = escala(0, periodos.length - 1, M.i, W - M.d);
    const y = escala(1, Math.max(2, maxPos), M.s + 10, alto - M.b);
    return { alto, x, y };
  });
  const cambio = (s: SerieBump): string => {
    const a = s.posiciones[0]!;
    const z = s.posiciones[s.posiciones.length - 1]!;
    const sentido = sentidoDelta(z, a); // subir de lugar = numero menor
    const lugares = Math.abs(a - z);
    return sentido === 'igual' ? 'Sin cambio de lugar' : `${sentido === 'sube' ? 'Sube' : 'Baja'} ${lugares} ${lugares === 1 ? 'lugar' : 'lugares'}`;
  };
  const tabla: TablaAlterna = {
    columnas: [{ id: 's', titulo: 'Serie' }, ...periodos.map((p, i) => ({ id: `p${i}`, titulo: p, numerica: true })), { id: 'c', titulo: 'Cambio' }],
    filas: series.map((s) => {
      const sentido = sentidoDelta(s.posiciones[s.posiciones.length - 1]!, s.posiciones[0]!);
      return { clave: s.id, celdas: [s.etiqueta, ...s.posiciones.map(String), `${sentido === 'igual' ? '' : `${flechaDe(sentido)} `}${cambio(s)}`] };
    }),
  };
  return (
    <MarcoGrafica {...base} forma="bump" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${calculo.valor.alto}`} role="group" aria-label={base.descripcion} focusable="false">
            {periodos.map((p, i) => (
              <text key={p} x={r2(calculo.valor.x(i))} y={16} textAnchor="middle" className="rtm-g-texto">{p}</text>
            ))}
            {series.map((s, si) => {
              const pts = s.posiciones.map((pos, i) => [calculo.valor.x(i), calculo.valor.y(pos)] as const);
              const forma = formaDeSerie(si);
              return (
                <g key={s.id} role="img" aria-label={`${s.etiqueta}: ${s.posiciones.map((p, i) => `${periodos[i]} lugar ${p}`).join(', ')}. ${cambio(s)}`} data-marca={s.id} data-destacada={s.destacada || undefined} className={`rtm-g-marca rtm-g-bump ${s.destacada ? 'rtm-g-bump-foco' : ''}`} {...nav.props(si)}>
                  <path d={rutaPoligonal(pts)} pathLength={1} fill="none" className="rtm-g-traza-bump" />
                  {pts.map(([x, y], i) => <Marcador key={i} forma={forma} x={x} y={y} r={4.5} className={s.destacada ? 'rtm-g-punto-foco' : 'rtm-g-punto'} />)}
                  <text x={M.i - 12} y={r2(pts[0]![1] + 4)} textAnchor="end" className="rtm-g-texto-fuerte">{`${s.posiciones[0]}. ${s.etiqueta}`}</text>
                  <text x={W - M.d + 12} y={r2(pts[pts.length - 1]![1] + 4)} className="rtm-g-texto-fuerte">{`${s.posiciones[s.posiciones.length - 1]}. ${s.etiqueta}`}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
