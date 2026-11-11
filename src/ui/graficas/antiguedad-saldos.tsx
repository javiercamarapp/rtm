'use client';

import { DefsPatrones, MuestraLeyenda, patronDeSerie, urlPatron, useNavegacionTeclado, useUidSvg } from './piezas';
import { MarcoGrafica } from './marco';
import { ErrorGrafica, apilar, claseEscalonado, exigirNoNegativos, r2, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface FilaAntiguedad {
  id: string;
  etiqueta: string;
  /** Saldo por tramo, en el mismo orden que `tramos`. */
  valores: readonly number[];
  textos: readonly string[];
  /** Total ya formateado. */
  total: string;
}

interface Props extends BaseGrafica {
  filas: readonly FilaAntiguedad[];
  /** Tramos de antiguedad: por omision 0 a 7, 8 a 30, 31 a 60 y mas de 60 dias. */
  tramos?: readonly string[];
  tablaAbierta?: boolean;
}

export const TRAMOS_ANTIGUEDAD = ['0 a 7 d', '8 a 30 d', '31 a 60 d', 'Más de 60 d'] as const;

const ANCHO = 300;

/** Antiguedad de saldos: barras apiladas por cliente. Cada tramo tiene su trama y su nombre en la leyenda y en la tabla; el total va escrito. */
export function AntiguedadSaldos({ filas, tramos = TRAMOS_ANTIGUEDAD, tablaAbierta, ...base }: Props) {
  const uid = useUidSvg();
  const nav = useNavegacionTeclado(filas.length, 1);
  const calculo = seguro(() => {
    if (filas.length === 0) throw new ErrorGrafica('datos_vacios', 'No hay saldos que mostrar.');
    for (const f of filas) {
      if (f.valores.length !== tramos.length || f.textos.length !== tramos.length) throw new ErrorGrafica('longitud_distinta', `La fila ${f.etiqueta} no coincide con los tramos.`);
      exigirNoNegativos(f.valores, 'antiguedad');
    }
    const totales = filas.map((f) => f.valores.reduce((s, v) => s + v, 0));
    const max = Math.max(1, ...totales);
    return filas.map((f) => apilar(f.valores, max, ANCHO));
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'c', titulo: 'Cliente' }, ...tramos.map((t, i) => ({ id: `t${i}`, titulo: t, numerica: true })), { id: 'tot', titulo: 'Total', numerica: true }],
    filas: filas.map((f) => ({ clave: f.id, celdas: [f.etiqueta, ...f.textos, f.total] })),
  };
  return (
    <MarcoGrafica {...base} forma="apilada" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={calculo.ok ? (
        <ul className="rtm-g-leyenda" aria-label="Tramos de antigüedad">
          {tramos.map((t, ti) => <li key={t}><MuestraLeyenda uid={uid} indice={ti} />{t}</li>)}
        </ul>
      ) : undefined}>
      {calculo.ok && (
        <ul className="rtm-g-ranking" aria-label={base.descripcion}>
          {filas.map((f, i) => (
            <li key={f.id} className="rtm-g-fila rtm-g-fila-apilada" aria-label={`${f.etiqueta}: ${tramos.map((t, k) => `${t} ${f.textos[k]}`).join(', ')}. Total ${f.total}`} data-marca={f.id} {...nav.props(i)}>
              <span className="rtm-g-etiqueta" aria-hidden="true">{f.etiqueta}</span>
              <svg className="rtm-g-barra rtm-g-barra-apilada" viewBox={`0 0 ${ANCHO} 14`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                {i === 0 && <DefsPatrones uid={uid} />}
                <rect x="0" y="0" width={ANCHO} height="14" className="rtm-g-fondo" />
                {calculo.valor[i]!.map((t, k) => (
                  <g key={k} data-tramo={tramos[k]}>
                    <rect x={r2(t.desde)} y="0" width={r2(t.ancho)} height="14" className={`rtm-g-crece-x ${claseEscalonado(i)} rtm-g-s${k % 8}`} />
                    {patronDeSerie(k) !== 'liso' && t.ancho > 0 && <rect x={r2(t.desde)} y="0" width={r2(t.ancho)} height="14" fill={urlPatron(uid, patronDeSerie(k))} className="rtm-g-trama-capa" />}
                  </g>
                ))}
              </svg>
              <span className="rtm-g-valor rtm-num" aria-hidden="true">{f.total}</span>
            </li>
          ))}
        </ul>
      )}
    </MarcoGrafica>
  );
}
