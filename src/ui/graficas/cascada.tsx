'use client';

import { DefsPatrones, urlPatron, useNavegacionTeclado, useUidSvg } from './piezas';
import { MarcoGrafica } from './marco';
import { calcularCascada, claseEscalonado, escala, partirEtiqueta, r2, seguro, type PasoCascada } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface PasoCascadaVista extends PasoCascada {
  /** Texto ya formateado, con signo: "+$1,200.00", "−$300.00". */
  texto: string;
}

interface Props extends BaseGrafica {
  pasos: readonly PasoCascadaVista[];
  unidad: string;
  tablaAbierta?: boolean;
}

const W = 560;
const H = 260;
const M = { i: 16, d: 16, s: 30, b: 52 };

/** Cascada (waterfall): venta a utilidad, cuenta con el proveedor, saldo con Omar. El total final va en el acento. Negativos con trama y signo escrito. */
export function Cascada({ pasos, unidad, tablaAbierta, ...base }: Props) {
  const uid = useUidSvg();
  const nav = useNavegacionTeclado(pasos.length, 1);
  const calculo = seguro(() => {
    const barras = calcularCascada(pasos);
    const topes = barras.flatMap((b) => [b.desde, b.hasta, 0]);
    const min = Math.min(...topes);
    const max = Math.max(...topes);
    const y = escala(min, max, H - M.b, M.s);
    const paso = (W - M.i - M.d) / barras.length;
    return { barras, y, paso, y0: y(0) };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'p', titulo: 'Paso' }, { id: 'v', titulo: unidad, numerica: true }, { id: 'a', titulo: 'Efecto' }, { id: 'c', titulo: 'Comprobación' }],
    filas: pasos.map((p, i) => {
      const b = calculo.ok ? calculo.valor.barras[i]! : null;
      return {
        clave: p.id,
        celdas: [p.etiqueta, p.texto, p.tipo === 'delta' ? (p.valor >= 0 ? 'Suma' : 'Resta') : p.tipo === 'inicio' ? 'Inicio' : 'Total', b && p.tipo === 'total' ? (b.cuadra ? 'Cuadra' : 'No cuadra') : 'No aplica'],
      };
    }),
  };
  return (
    <MarcoGrafica {...base} forma="cascada" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={base.descripcion} focusable="false">
            <DefsPatrones uid={uid} />
            <line x1={M.i} x2={W - M.d} y1={r2(calculo.valor.y0)} y2={r2(calculo.valor.y0)} className="rtm-g-eje" />
            {calculo.valor.barras.map((b, i) => {
              const p = pasos[i]!;
              const x = M.i + i * calculo.valor.paso + calculo.valor.paso * 0.15;
              const ancho = calculo.valor.paso * 0.7;
              const yA = calculo.valor.y(Math.max(b.desde, b.hasta));
              const yB = calculo.valor.y(Math.min(b.desde, b.hasta));
              const alto = Math.max(2, yB - yA);
              const esTotal = b.signo === 'total';
              const ultimoTotal = esTotal && i === calculo.valor.barras.length - 1;
              const siguiente = calculo.valor.barras[i + 1];
              return (
                <g key={b.id} role="img" aria-label={`${p.etiqueta}: ${p.texto}${esTotal && p.tipo === 'total' ? (b.cuadra ? ', cuadra' : ', no cuadra con la suma') : ''}`} data-marca={b.id} data-signo={b.signo} className="rtm-g-marca" {...nav.props(i)}>
                  <rect x={r2(x)} y={r2(yA)} width={r2(ancho)} height={r2(alto)} rx="3" className={`rtm-g-crece-y ${claseEscalonado(i)} ${ultimoTotal ? 'rtm-g-foco' : esTotal ? 'rtm-g-total' : 'rtm-g-base'}`} />
                  {b.signo === 'menos' && <rect x={r2(x)} y={r2(yA)} width={r2(ancho)} height={r2(alto)} rx="3" fill={urlPatron(uid, 'rayas')} className="rtm-g-trama-capa" />}
                  <text x={r2(x + ancho / 2)} y={r2(yA - 6)} textAnchor="middle" className="rtm-g-texto-fuerte rtm-num">{p.texto}</text>
                  {partirEtiqueta(p.etiqueta, 12, 2).map((l, k) => (
                    <text key={k} x={r2(x + ancho / 2)} y={H - 30 + k * 14} textAnchor="middle" className="rtm-g-texto">{l}</text>
                  ))}
                  {siguiente && <line x1={r2(x + ancho)} x2={r2(x + calculo.valor.paso)} y1={r2(calculo.valor.y(b.acumulado))} y2={r2(calculo.valor.y(b.acumulado))} className="rtm-g-conector" />}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </MarcoGrafica>
  );
}
