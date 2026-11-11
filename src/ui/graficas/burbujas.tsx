'use client';

import { DefsPatrones, MuestraLeyenda, patronDeSerie, urlPatron, useNavegacionTeclado, useUidSvg } from './piezas';
import { MarcoGrafica } from './marco';
import { ErrorGrafica, claseEscalonado, escala, exigirNoNegativos, extremos, radioBurbuja, r2, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface PuntoBurbuja {
  id: string;
  etiqueta: string;
  x: number;
  y: number;
  tamano: number;
  textoX: string;
  textoY: string;
  textoTamano: string;
  /** Clasificacion ya decidida por el servidor (Estrella, Vaca, Nicho, Revisar...). */
  grupo: string;
}

interface Props extends BaseGrafica {
  puntos: readonly PuntoBurbuja[];
  ejeX: string;
  ejeY: string;
  ejeTamano: string;
  /** Orden de los grupos: define el patron de cada uno. */
  grupos: readonly string[];
  umbralX?: number;
  umbralY?: number;
  tablaAbierta?: boolean;
}

const W = 560;
const H = 300;
const M = { i: 44, d: 24, s: 20, b: 44 };

/** Burbujas: dos variables continuas mas tamano (area proporcional). Cada grupo se distingue por trama y por su palabra en la etiqueta. */
export function Burbujas({ puntos, ejeX, ejeY, ejeTamano, grupos, umbralX, umbralY, tablaAbierta, ...base }: Props) {
  const uid = useUidSvg();
  const nav = useNavegacionTeclado(puntos.length, 1);
  const calculo = seguro(() => {
    if (puntos.length === 0) throw new ErrorGrafica('datos_vacios', 'No hay puntos para dibujar.');
    exigirNoNegativos(puntos.map((p) => p.tamano), 'burbujas');
    const ex = extremos(puntos.flatMap((p) => [p.x, ...(umbralX === undefined ? [] : [umbralX])]));
    const ey = extremos(puntos.flatMap((p) => [p.y, ...(umbralY === undefined ? [] : [umbralY])]));
    const x = escala(ex.min, ex.max, M.i + 20, W - M.d - 20);
    const y = escala(ey.min, ey.max, H - M.b - 20, M.s + 20);
    const maxT = Math.max(...puntos.map((p) => p.tamano));
    return { x, y, maxT };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'p', titulo: 'Concepto' }, { id: 'g', titulo: 'Clasificación' }, { id: 'x', titulo: ejeX, numerica: true }, { id: 'y', titulo: ejeY, numerica: true }, { id: 't', titulo: ejeTamano, numerica: true }],
    filas: puntos.map((p) => ({ clave: p.id, celdas: [p.etiqueta, p.grupo, p.textoX, p.textoY, p.textoTamano] })),
  };
  return (
    <MarcoGrafica {...base} forma="burbujas" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={calculo.ok ? (
        <ul className="rtm-g-leyenda" aria-label="Clasificaciones">
          {grupos.map((g, gi) => (
            <li key={g}><MuestraLeyenda uid={uid} indice={gi} redonda />{g}</li>
          ))}
        </ul>
      ) : undefined}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={base.descripcion} focusable="false">
            <DefsPatrones uid={uid} />
            <line x1={M.i} x2={W - M.d} y1={H - M.b} y2={H - M.b} className="rtm-g-eje" />
            <line x1={M.i} x2={M.i} y1={M.s} y2={H - M.b} className="rtm-g-eje" />
            {umbralX !== undefined && <line x1={r2(calculo.valor.x(umbralX))} x2={r2(calculo.valor.x(umbralX))} y1={M.s} y2={H - M.b} className="rtm-g-referencia" />}
            {umbralY !== undefined && <line x1={M.i} x2={W - M.d} y1={r2(calculo.valor.y(umbralY))} y2={r2(calculo.valor.y(umbralY))} className="rtm-g-referencia" />}
            <text x={W - M.d} y={H - 8} textAnchor="end" className="rtm-g-texto">{ejeX}</text>
            <text x={M.i + 4} y={14} className="rtm-g-texto">{ejeY}</text>
            {puntos.map((p, i) => {
              const gi = Math.max(0, grupos.indexOf(p.grupo));
              const cx = calculo.valor.x(p.x);
              const cy = calculo.valor.y(p.y);
              const r = radioBurbuja(p.tamano, calculo.valor.maxT, 6, 26);
              return (
                <g key={p.id} role="img" aria-label={`${p.etiqueta}, ${p.grupo}: ${ejeX} ${p.textoX}, ${ejeY} ${p.textoY}, ${ejeTamano} ${p.textoTamano}`} data-marca={p.id} data-grupo={p.grupo} className="rtm-g-marca" {...nav.props(i)}>
                  <circle cx={r2(cx)} cy={r2(cy)} r={r2(r)} className={`rtm-g-escala ${claseEscalonado(i)} rtm-g-s${gi % 8}`} />
                  {patronDeSerie(gi) !== 'liso' && <circle cx={r2(cx)} cy={r2(cy)} r={r2(r)} fill={urlPatron(uid, patronDeSerie(gi))} className="rtm-g-trama-capa" />}
                  <text x={r2(cx)} y={r2(cy - r - 5)} textAnchor="middle" className="rtm-g-texto-fuerte">{p.etiqueta}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
