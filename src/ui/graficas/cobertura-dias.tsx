'use client';

import { useNavegacionTeclado } from './piezas';
import { MarcoGrafica, estadoDe } from './marco';
import { ErrorGrafica, claseEscalonado, escala, exigirNoNegativos, r2, seguro } from './geo';
import { ESTADOS_COBERTURA as ESTADOS, type EstadoCobertura } from './cobertura';
import type { BaseGrafica, TablaAlterna } from './tipos';

export type { EstadoCobertura };

export interface FilaCobertura {
  id: string;
  etiqueta: string;
  /** Dias de cobertura; null cuando no hay historia suficiente (se dibuja una barra vacia punteada). */
  dias: number | null;
  textoDias: string;
  estado: EstadoCobertura;
}

export interface UmbralCobertura { id: string; etiqueta: string; dias: number }

interface Props extends BaseGrafica {
  filas: readonly FilaCobertura[];
  /** Marcas de referencia en la escala (tiempo de entrega, siguiente ciclo, objetivo). */
  umbrales: readonly UmbralCobertura[];
  tablaAbierta?: boolean;
}

const ANCHO = 300;

/** Cobertura en dias: barra por modelo contra los umbrales. El estado va en palabra y en un medidor de 5 segmentos; el color nunca va solo. */
export function CoberturaDias({ filas, umbrales, tablaAbierta, ...base }: Props) {
  const nav = useNavegacionTeclado(filas.length, 1);
  const calculo = seguro(() => {
    if (filas.length === 0) throw new ErrorGrafica('datos_vacios', 'No hay modelos que mostrar.');
    exigirNoNegativos([...filas.flatMap((f) => (f.dias === null ? [] : [f.dias])), ...umbrales.map((u) => u.dias)], 'cobertura');
    const tope = Math.max(1, ...filas.map((f) => f.dias ?? 0), ...umbrales.map((u) => u.dias));
    return { x: escala(0, tope, 0, ANCHO) };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'm', titulo: 'Modelo' }, { id: 'd', titulo: 'Días de cobertura', numerica: true }, { id: 'e', titulo: 'Estado' }],
    filas: filas.map((f) => ({ clave: f.id, celdas: [f.etiqueta, f.dias === null ? 'Sin dato' : f.textoDias, ESTADOS[f.estado].palabra] })),
  };
  return (
    <MarcoGrafica {...base} forma="cobertura" tabla={tabla} tablaAbierta={tablaAbierta} estado={estadoDe(base.estado, calculo.ok)} mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={calculo.ok ? (
        <ul className="rtm-g-leyenda" aria-label="Referencias de la escala">
          {umbrales.map((u) => <li key={u.id}><span className="rtm-g-marca-umbral" aria-hidden="true" />{`${u.etiqueta}: ${u.dias} d`}</li>)}
        </ul>
      ) : undefined}>
      {calculo.ok && (
        <ul className="rtm-g-ranking" aria-label={base.descripcion}>
          {filas.map((f, i) => {
            const e = ESTADOS[f.estado];
            return (
              <li key={f.id} className="rtm-g-fila rtm-g-fila-cobertura" aria-label={`${f.etiqueta}: ${f.dias === null ? 'sin dato' : f.textoDias}, ${e.palabra}`} data-marca={f.id} data-estado={f.estado} {...nav.props(i)}>
                <span className="rtm-g-etiqueta" aria-hidden="true">{f.etiqueta}</span>
                <svg className="rtm-g-barra rtm-g-barra-cobertura" viewBox={`0 0 ${ANCHO} 14`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                  <rect x="0" y="0" width={ANCHO} height="14" className="rtm-g-fondo" />
                  {f.dias === null ? (
                    <rect x="1" y="1" width={ANCHO - 2} height="12" rx="3" className="rtm-g-sin-dato" />
                  ) : (
                    <rect x="0" y="0" width={r2(Math.max(2, calculo.valor.x(f.dias)))} height="14" className={`rtm-g-crece-x ${claseEscalonado(i)} ${f.estado === 'urge' || f.estado === 'sobrestock' ? 'rtm-g-foco' : 'rtm-g-base'}`} />
                  )}
                  {umbrales.map((u) => <line key={u.id} x1={r2(calculo.valor.x(u.dias))} x2={r2(calculo.valor.x(u.dias))} y1="0" y2="14" className="rtm-g-umbral" />)}
                </svg>
                <span className="rtm-g-valor rtm-num" aria-hidden="true">{f.dias === null ? 'Sin dato' : f.textoDias}</span>
                <span className="rtm-g-estado" aria-hidden="true">
                  <span className="rtm-g-medidor" data-nivel={e.nivel}>
                    {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= e.nivel ? 'rtm-g-segmento rtm-g-segmento-lleno' : 'rtm-g-segmento'} />)}
                  </span>
                  {e.palabra}
                  {f.estado === 'sobrestock' ? ' +' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </MarcoGrafica>
  );
}
