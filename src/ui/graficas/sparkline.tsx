'use client';

import { useId } from 'react';
import { TablaDeGrafica } from './marco';
import { Marcador } from './piezas';
import { escala, exigirFinitos, extremos, r2, rutaPoligonal, seguro } from './geo';
import type { TablaAlterna } from './tipos';

interface Props {
  titulo: string;
  /** Resumen para lectores de pantalla: "De 12 a 20 piezas en 8 semanas". */
  descripcion: string;
  etiquetas: readonly string[];
  valores: readonly number[];
  /** Texto formateado de cada valor (misma longitud que `valores`). */
  textos: readonly string[];
  /** Muestra el ultimo valor junto al punto. */
  mostrarUltimo?: boolean;
  ancho?: number;
  alto?: number;
}

/** Minigrafica de tendencia. Un solo trazo gris tinta con el ultimo punto en el acento; su tabla equivalente viaja para lectores de pantalla. */
export function Sparkline({ titulo, descripcion, etiquetas, valores, textos, mostrarUltimo = false, ancho = 120, alto = 32 }: Props) {
  const uid = useId();
  const calculo = seguro(() => {
    exigirFinitos(valores, 'sparkline');
    const { min, max } = extremos(valores);
    const x = escala(0, Math.max(1, valores.length - 1), 3, ancho - (mostrarUltimo ? 44 : 3));
    const y = escala(min, max, alto - 4, 4);
    return valores.map((v, i) => [x(i), y(v)] as const);
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'e', titulo: 'Periodo' }, { id: 'v', titulo: 'Valor', numerica: true }],
    filas: valores.map((_, i) => ({ clave: `${i}`, celdas: [etiquetas[i] ?? `${i + 1}`, textos[i] ?? ''] })),
  };
  if (!calculo.ok || valores.length < 2) {
    return <span className="rtm-g-spark-vacio rtm-sin-dato">Sin historia</span>;
  }
  const pts = calculo.valor;
  const ultimo = pts[pts.length - 1]!;
  return (
    <span className="rtm-g-spark" data-grafica="sparkline" id={`${uid}-s`}>
      <svg className="rtm-g-spark-svg" viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} role="img" aria-label={descripcion} focusable="false">
        <path d={rutaPoligonal(pts)} pathLength={1} fill="none" className="rtm-g-traza rtm-g-traza-fina" />
        <Marcador forma="circulo" x={ultimo[0]} y={ultimo[1]} r={2.6} className="rtm-g-punto-foco" />
        {mostrarUltimo && <text x={r2(ultimo[0] + 6)} y={r2(ultimo[1] + 4)} className="rtm-g-texto rtm-num">{textos[textos.length - 1]}</text>}
      </svg>
      <span className="rtm-solo-lectores">
        <TablaDeGrafica titulo={titulo} tabla={tabla} />
      </span>
    </span>
  );
}
