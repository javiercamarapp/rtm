'use client';

import { Delta, useNavegacionTeclado } from './piezas';
import { MarcoGrafica } from './marco';
import { claseEscalonado, exigirNoNegativos, extremos, r2, seguro } from './geo';
import { palabraSentido } from './formato';
import type { BaseGrafica, DeltaTexto, TablaAlterna } from './tipos';

export interface DatoBarraDelta { id: string; etiqueta: string; valor: number; texto: string; delta?: DeltaTexto; destacado?: boolean }

interface Props extends BaseGrafica {
  datos: readonly DatoBarraDelta[];
  /** Encabezado de la columna de valor en la tabla (Piezas, Utilidad...). */
  unidad: string;
  /** Ordena de mayor a menor (ranking). Por omision, si. */
  ordenar?: boolean;
  tablaAbierta?: boolean;
}

function etiquetaFila(d: DatoBarraDelta, pos: number): string {
  const cambio = d.delta ? `, ${palabraSentido(d.delta.sentido).toLowerCase()} ${d.delta.texto}` : '';
  return `${pos}. ${d.etiqueta}: ${d.texto}${cambio}`;
}

/** Barras horizontales con delta y ranking. Una serie = gris tinta con foco en el acento (maximo 1 destacado). Eje en cero. */
export function BarrasDelta({ datos, unidad, ordenar = true, tablaAbierta, ...base }: Props) {
  const calculo = seguro(() => {
    exigirNoNegativos(datos.map((d) => d.valor), 'barras');
    const filas = ordenar ? [...datos].sort((a, b) => b.valor - a.valor) : [...datos];
    return { filas, max: Math.max(1, extremos(filas.map((f) => f.valor)).max) };
  });
  const filas = calculo.ok ? calculo.valor.filas : [];
  const nav = useNavegacionTeclado(filas.length, 1);
  const tabla: TablaAlterna = {
    columnas: [{ id: 'p', titulo: 'Posición', numerica: true }, { id: 'c', titulo: 'Concepto' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'd', titulo: 'Cambio', numerica: true }],
    filas: filas.map((d, i) => ({ clave: d.id, celdas: [String(i + 1), d.etiqueta, d.texto, d.delta ? `${palabraSentido(d.delta.sentido)} ${d.delta.texto}` : 'Sin comparación'] })),
  };
  return (
    <MarcoGrafica {...base} forma="barras" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}>
      {calculo.ok && (
        <ul className="rtm-g-ranking" aria-label={base.descripcion}>
          {filas.map((d, i) => (
            <li key={d.id} className="rtm-g-fila" aria-label={etiquetaFila(d, i + 1)} data-marca={d.id} data-destacado={d.destacado || undefined} {...nav.props(i)}>
              <span className="rtm-g-rango rtm-num" aria-hidden="true">{i + 1}</span>
              <span className="rtm-g-etiqueta" aria-hidden="true">{d.etiqueta}</span>
              <svg className="rtm-g-barra" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <rect x="0" y="0" width="100" height="10" className="rtm-g-fondo" />
                <rect x="0" y="0" width={r2(Math.max(0.8, (d.valor / calculo.valor.max) * 100))} height="10" className={`rtm-g-crece-x ${claseEscalonado(i)} ${d.destacado ? 'rtm-g-foco' : 'rtm-g-base'}`} />
              </svg>
              <span className="rtm-g-valor rtm-num" aria-hidden="true">{d.texto}</span>
              <span className="rtm-g-cambio" aria-hidden="true">{d.delta ? <Delta delta={d.delta} /> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </MarcoGrafica>
  );
}
