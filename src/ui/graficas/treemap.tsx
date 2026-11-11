'use client';

import { DefsPatrones, MuestraLeyenda, patronDeSerie, urlPatron, useNavegacionTeclado, useUidSvg } from './piezas';
import { MarcoGrafica, estadoDe } from './marco';
import { calcularTreemap, claseEscalonado, partirEtiqueta, r2, seguro } from './geo';
import { textoCifra } from './formato';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface NodoTreemap { id: string; etiqueta: string; valor: number; texto: string; grupo?: string }

interface Props extends BaseGrafica {
  nodos: readonly NodoTreemap[];
  unidad: string;
  /** Orden de grupos (fijo/variable...): cada uno con su trama. */
  grupos?: readonly string[];
  tablaAbierta?: boolean;
}

const W = 560;
const H = 280;

/** Treemap: composicion con muchas partes. Area proporcional; cada celda dice su nombre y su porcentaje si cabe, y siempre esta en la tabla. */
export function Treemap({ nodos, unidad, grupos = [], tablaAbierta, ...base }: Props) {
  const uid = useUidSvg();
  const nav = useNavegacionTeclado(nodos.length, 1);
  const calculo = seguro(() => {
    const rects = calcularTreemap(nodos, W, H);
    return new Map(rects.map((r) => [r.id, r]));
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'c', titulo: 'Concepto' }, ...(grupos.length ? [{ id: 'g', titulo: 'Grupo' }] : []), { id: 'v', titulo: unidad, numerica: true }, { id: 'p', titulo: 'Participación', numerica: true }],
    filas: nodos.map((n) => {
      const r = calculo.ok ? calculo.valor.get(n.id) : undefined;
      return { clave: n.id, celdas: [n.etiqueta, ...(grupos.length ? [n.grupo ?? 'Sin grupo'] : []), n.texto, r ? textoCifra(r.fraccion * 100, 'porcentaje', 1) : textoCifra(0, 'porcentaje', 1)] };
    }),
  };
  return (
    <MarcoGrafica {...base} forma="treemap" tabla={tabla} tablaAbierta={tablaAbierta} estado={estadoDe(base.estado, calculo.ok)} mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={calculo.ok && grupos.length ? (
        <ul className="rtm-g-leyenda" aria-label="Grupos">
          {grupos.map((g, gi) => <li key={g}><MuestraLeyenda uid={uid} indice={gi} suave />{g}</li>)}
        </ul>
      ) : undefined}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={base.descripcion} focusable="false">
            <DefsPatrones uid={uid} />
            {nodos.map((n, i) => {
              const r = calculo.valor.get(n.id);
              if (!r) return null;
              const gi = Math.max(0, grupos.indexOf(n.grupo ?? ''));
              const cabe = r.ancho > 70 && r.alto > 38;
              const pct = textoCifra(r.fraccion * 100, 'porcentaje', 1);
              const patron = grupos.length ? patronDeSerie(gi) : 'liso';
              return (
                <g key={n.id} role="img" aria-label={`${n.etiqueta}: ${n.texto}, ${pct}`} data-marca={n.id} data-grupo={n.grupo} className="rtm-g-marca" {...nav.props(i)}>
                  <rect x={r2(r.x + 1)} y={r2(r.y + 1)} width={r2(Math.max(0, r.ancho - 2))} height={r2(Math.max(0, r.alto - 2))} rx="4" className={`rtm-g-escala ${claseEscalonado(i)} ${grupos.length ? `rtm-g-suave rtm-g-s${gi % 8}` : 'rtm-g-calor-1'}`} />
                  {patron !== 'liso' && <rect x={r2(r.x + 1)} y={r2(r.y + 1)} width={r2(Math.max(0, r.ancho - 2))} height={r2(Math.max(0, r.alto - 2))} rx="4" fill={urlPatron(uid, patron, true)} className="rtm-g-trama-capa" />}
                  {cabe && (
                    <>
                      {partirEtiqueta(n.etiqueta, Math.max(6, Math.floor(r.ancho / 7)), 2).map((l, k) => <text key={k} x={r2(r.x + 8)} y={r2(r.y + 18 + k * 14)} className="rtm-g-texto-celda">{l}</text>)}
                      <text x={r2(r.x + 8)} y={r2(r.y + r.alto - 8)} className="rtm-g-texto-celda rtm-num">{pct}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
