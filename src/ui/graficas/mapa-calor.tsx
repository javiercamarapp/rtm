'use client';

import { useNavegacionTeclado } from './piezas';
import { MarcoGrafica } from './marco';
import { ErrorGrafica, NIVELES_CALOR, claseEscalonado, exigirFinitos, extremos, nivelCalor, r2, seguro } from './geo';
import type { BaseGrafica, TablaAlterna } from './tipos';

export interface CeldaCalor { valor: number; texto: string }

interface Props extends BaseGrafica {
  filas: readonly string[];
  columnas: readonly string[];
  /** celdas[fila][columna]; null = sin dato (celda punteada, nunca un cero inventado). */
  celdas: ReadonlyArray<ReadonlyArray<CeldaCalor | null>>;
  unidad: string;
  tablaAbierta?: boolean;
}

const ANCHO_ETIQUETA = 120;
const CELDA_W = 64;
const CELDA_H = 34;
const CABEZA = 34;

/** Mapa de calor de un solo matiz en 5 niveles. Cada celda trae su numero exacto; la celda sin dato es punteada y dice "Sin dato". */
export function MapaCalor({ filas, columnas, celdas, unidad, tablaAbierta, ...base }: Props) {
  const total = filas.length * columnas.length;
  const nav = useNavegacionTeclado(total, columnas.length);
  const calculo = seguro(() => {
    if (filas.length === 0 || columnas.length === 0) throw new ErrorGrafica('datos_vacios', 'El mapa de calor necesita filas y columnas.');
    if (celdas.length !== filas.length || celdas.some((f) => f.length !== columnas.length)) throw new ErrorGrafica('longitud_distinta', 'Las celdas no coinciden con las filas y columnas.');
    const valores = celdas.flatMap((f) => f.flatMap((c) => (c ? [c.valor] : [])));
    exigirFinitos(valores, 'mapa de calor');
    const { min, max } = valores.length ? extremos(valores) : { min: 0, max: 0 };
    return { min, max, ancho: ANCHO_ETIQUETA + columnas.length * CELDA_W, alto: CABEZA + filas.length * CELDA_H };
  });
  const tabla: TablaAlterna = {
    columnas: [{ id: 'f', titulo: 'Fila' }, ...columnas.map((c, i) => ({ id: `c${i}`, titulo: c, numerica: true }))],
    filas: filas.map((f, r) => ({ clave: f, celdas: [f, ...columnas.map((_, c) => celdas[r]?.[c]?.texto ?? 'Sin dato')] })),
  };
  return (
    <MarcoGrafica {...base} forma="calor" tabla={tabla} tablaAbierta={tablaAbierta} estado={calculo.ok ? base.estado : 'error'} mensajeError={calculo.ok ? undefined : calculo.error.message}
      leyenda={calculo.ok ? (
        <p className="rtm-g-leyenda" aria-hidden="true">
          <span>Menos</span>
          {Array.from({ length: NIVELES_CALOR }, (_, n) => <span key={n} className={`rtm-g-calor-muestra rtm-g-calor-${n}`} />)}
          <span>Más</span>
          <span className="rtm-g-calor-muestra rtm-g-calor-vacia" />
          <span>Sin dato</span>
        </p>
      ) : undefined}>
      {calculo.ok && (
        <div className="rtm-g-lienzo">
          <svg className="rtm-g-svg" viewBox={`0 0 ${calculo.valor.ancho} ${calculo.valor.alto}`} role="group" aria-label={base.descripcion} focusable="false">
            {columnas.map((c, ci) => (
              <text key={c} x={ANCHO_ETIQUETA + ci * CELDA_W + CELDA_W / 2} y={20} textAnchor="middle" className="rtm-g-texto">{c}</text>
            ))}
            {filas.map((f, ri) => (
              <g key={f}>
                <text x={0} y={CABEZA + ri * CELDA_H + CELDA_H / 2 + 4} className="rtm-g-texto">{f}</text>
                {columnas.map((c, ci) => {
                  const celda = celdas[ri]![ci] ?? null;
                  const i = ri * columnas.length + ci;
                  const x = ANCHO_ETIQUETA + ci * CELDA_W + 2;
                  const y = CABEZA + ri * CELDA_H + 2;
                  const nivel = celda ? nivelCalor(celda.valor, calculo.valor.min, calculo.valor.max) : -1;
                  return (
                    <g key={c} role="img" aria-label={`${f}, ${c}: ${celda ? celda.texto : 'sin dato'}`} data-marca={`${ri}-${ci}`} data-nivel={nivel} className="rtm-g-marca" {...nav.props(i)}>
                      <rect x={x} y={y} width={CELDA_W - 4} height={CELDA_H - 4} rx="4" className={`rtm-g-aparece ${claseEscalonado(ri)} ${celda ? `rtm-g-calor-${nivel}` : 'rtm-g-calor-vacia'}`} />
                      <text x={r2(x + (CELDA_W - 4) / 2)} y={r2(y + (CELDA_H - 4) / 2 + 4)} textAnchor="middle" className={`rtm-num ${nivel >= 3 ? 'rtm-g-texto-inverso' : 'rtm-g-texto-fuerte'}`}>{celda ? celda.texto : '·'}</text>
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
          <p className="rtm-solo-lectores">{`Unidad: ${unidad}`}</p>
        </div>
      )}
    </MarcoGrafica>
  );
}
