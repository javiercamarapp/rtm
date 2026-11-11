'use client';

import { Marcador, useNavegacionTeclado } from './piezas';
import { MarcoGrafica } from './marco';
import { calcularPareto, claseEscalonado, elementosHasta, escala, partirEtiqueta, r2, rutaPoligonal, seguro } from './geo';
import { textoCifra } from './formato';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface DatoPareto { id: string; etiqueta: string; valor: number; texto: string }

interface Props extends BaseGrafica {
  datos: readonly DatoPareto[];
  unidad: string;
  /** Umbral de concentracion que se senala (0 a 1). Por omision 0.8. */
  umbral?: number;
  /** Sustantivo en plural para la lectura: "clientes", "modelos". */
  sustantivo: string;
  tablaAbierta?: boolean;
}

const W = 560;
const H = 260;
const M = { i: 36, d: 40, s: 24, b: 52 };

/** Pareto: barras de mayor a menor y porcentaje acumulado. Los elementos que alcanzan el umbral van en el acento y la lectura lo dice con palabras. */
export function Pareto({ datos, unidad, umbral = 0.8, sustantivo, tablaAbierta, ...base }: Props) {
  const nav = useNavegacionTeclado(datos.length, 1);
  const calculo = seguro(() => {
    const filas = calcularPareto(datos);
    const textos = new Map(datos.map((d) => [d.id, d.texto]));
    const hasta = elementosHasta(filas, umbral);
    const max = Math.max(1, ...filas.map((f) => f.valor));
    const y = escala(0, max, H - M.b, M.s);
    const yPct = escala(0, 1, H - M.b, M.s);
    const paso = (W - M.i - M.d) / filas.length;
    const centro = (i: number) => M.i + i * paso + paso / 2;
    const linea = filas.map((f, i) => [centro(i), yPct(f.acumulada)] as const);
    return { filas, textos, hasta, y, yPct, paso, centro, linea, acumFinal: filas[filas.length - 1]!.acumulada, acumHasta: filas[hasta - 1]!.acumulada };
  });
  const pct = (f: number) => textoCifra(f * 100, 'porcentaje');
  const tabla: TablaAlterna = {
    columnas: [{ id: 'p', titulo: 'Posición', numerica: true }, { id: 'c', titulo: 'Concepto' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'f', titulo: 'Participación', numerica: true }, { id: 'a', titulo: 'Acumulado', numerica: true }],
    filas: calculo.ok ? calculo.valor.filas.map((f, i) => ({ clave: f.id, celdas: [String(i + 1), f.etiqueta, calculo.valor.textos.get(f.id) ?? '', pct(f.fraccion), pct(f.acumulada)] })) : [],
  };
  const lectura = calculo.ok ? `Los ${calculo.valor.hasta} primeros ${sustantivo} concentran ${pct(calculo.valor.acumHasta)} del total.` : '';
  return (
    <MarcoGrafica {...base} forma="pareto" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message} leyenda={calculo.ok ? <p className="rtm-g-lectura">{lectura}</p> : undefined}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={base.descripcion} focusable="false">
            <line x1={M.i} x2={W - M.d} y1={H - M.b} y2={H - M.b} className="rtm-g-eje" />
            <line x1={M.i} x2={W - M.d} y1={r2(calculo.valor.yPct(umbral))} y2={r2(calculo.valor.yPct(umbral))} className="rtm-g-referencia" />
            <text x={W - M.d + 4} y={r2(calculo.valor.yPct(umbral) + 4)} className="rtm-g-texto">{pct(umbral)}</text>
            <text x={W - M.d + 4} y={r2(calculo.valor.yPct(1) + 4)} className="rtm-g-texto">100 %</text>
            <g data-llave="umbral">
              <line x1={r2(calculo.valor.centro(0) - calculo.valor.paso * 0.31)} x2={r2(calculo.valor.centro(calculo.valor.hasta - 1) + calculo.valor.paso * 0.31)} y1={M.s - 12} y2={M.s - 12} className="rtm-g-llave" />
              <text x={r2(calculo.valor.centro(0) - calculo.valor.paso * 0.31)} y={M.s - 16} className="rtm-g-texto">{`Primeros ${calculo.valor.hasta}`}</text>
            </g>
            <path d={rutaPoligonal(calculo.valor.linea)} pathLength={1} className="rtm-g-traza" fill="none" />
            {calculo.valor.filas.map((f, i) => {
              const cx = calculo.valor.centro(i);
              const ancho = calculo.valor.paso * 0.62;
              const yTop = calculo.valor.y(f.valor);
              const dentro = i < calculo.valor.hasta;
              return (
                <g key={f.id} role="img" aria-label={`${i + 1}. ${f.etiqueta}: ${calculo.valor.textos.get(f.id)}, acumulado ${pct(f.acumulada)}`} data-marca={f.id} data-dentro={dentro} className="rtm-g-marca" {...nav.props(i)}>
                  <rect x={r2(cx - ancho / 2)} y={r2(yTop)} width={r2(ancho)} height={r2(Math.max(1, H - M.b - yTop))} rx="3" className={`rtm-g-crece-y ${claseEscalonado(i)} ${dentro ? 'rtm-g-foco' : 'rtm-g-base'}`} />
                  <Marcador forma="circulo" x={cx} y={calculo.valor.yPct(f.acumulada)} r={3.5} className="rtm-g-punto-linea" />
                  <text x={r2(cx)} y={r2(yTop - 6)} textAnchor="middle" className="rtm-g-texto rtm-num">{calculo.valor.textos.get(f.id)}</text>
                  {partirEtiqueta(f.etiqueta, 10, 2).map((l, k) => (
                    <text key={k} x={r2(cx)} y={H - 32 + k * 14} textAnchor="middle" className="rtm-g-texto">{l}</text>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
