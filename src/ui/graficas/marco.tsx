'use client';

// Marco comun de toda grafica: titulo, marca de procedencia, estados (cargando con esqueleto de la forma real, error, muestra insuficiente),
// tabla alterna con los mismos datos ("Ver como tabla") y pie de corte y fuente.
import { useId, type ReactNode } from 'react';
import { DataTable } from '../componentes/data-table';
import { useAnimacionActiva } from '../movimiento/cliente';
import { MarcaProcedencia } from './piezas';
import { muestraSuficiente, r2 } from './geo';
import type { BaseGrafica, EstadoGrafica, TablaAlterna } from './tipos';

/** Estado efectivo: cargando manda sobre un error de datos (aun no hay datos que validar); un error de calculo pasa a error. */
export function estadoDe(pedido: EstadoGrafica | undefined, calculoOk: boolean): EstadoGrafica {
  if (pedido === 'cargando') return 'cargando';
  return calculoOk ? (pedido ?? 'listo') : 'error';
}

export type FormaEsqueleto = 'barras' | 'linea' | 'cascada' | 'pareto' | 'calor' | 'burbujas' | 'treemap' | 'radar' | 'bump' | 'apilada' | 'cobertura' | 'sparkline';

const BARRAS_ESQ = [0.9, 0.72, 0.58, 0.44, 0.3];

/** Esqueleto con la forma final de cada grafica (mismas proporciones y radios); estatico, sin brillo, con movimiento reducido. */
export function EsqueletoGrafica({ forma }: { forma: FormaEsqueleto }) {
  const W = 560;
  const H = 220;
  const cuerpo = (() => {
    switch (forma) {
      case 'barras':
      case 'apilada':
      case 'cobertura':
        return BARRAS_ESQ.map((f, i) => (
          <g key={i}>
            <rect x="0" y={10 + i * 40} width="90" height="12" rx="6" className="rtm-g-esq" />
            <rect x="110" y={10 + i * 40} width={r2(f * 340)} height="12" rx="6" className="rtm-g-esq" />
            <rect x="480" y={10 + i * 40} width="70" height="12" rx="6" className="rtm-g-esq" />
          </g>
        ));
      case 'linea':
      case 'sparkline':
        return <path d="M 20 170 L 120 120 L 220 140 L 320 80 L 420 100 L 540 40" fill="none" className="rtm-g-esq-trazo" />;
      case 'cascada':
        return [0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={20 + i * 90} y={20 + (i % 3) * 20} width="60" height={140 - (i % 3) * 20} rx="5" className="rtm-g-esq" />);
      case 'pareto':
        return (
          <>
            {BARRAS_ESQ.map((f, i) => <rect key={i} x={30 + i * 100} y={r2(190 - f * 170)} width="70" height={r2(f * 170)} rx="5" className="rtm-g-esq" />)}
            <path d="M 65 120 L 165 70 L 265 45 L 365 32 L 465 26" fill="none" className="rtm-g-esq-trazo" />
          </>
        );
      case 'calor':
        return [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4, 5].map((c) => <rect key={`${r}-${c}`} x={20 + c * 88} y={10 + r * 50} width="80" height="42" rx="5" className="rtm-g-esq" />));
      case 'burbujas':
        return [[100, 150, 26], [220, 80, 18], [330, 130, 34], [430, 60, 14], [500, 140, 22]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} className="rtm-g-esq" />);
      case 'treemap':
        return (
          <>
            <rect x="0" y="0" width="300" height="220" rx="5" className="rtm-g-esq" />
            <rect x="306" y="0" width="254" height="120" rx="5" className="rtm-g-esq" />
            <rect x="306" y="126" width="120" height="94" rx="5" className="rtm-g-esq" />
            <rect x="432" y="126" width="128" height="94" rx="5" className="rtm-g-esq" />
          </>
        );
      case 'radar':
        return <polygon points="280,24 360,60 396,110 360,170 280,200 200,170 164,110 200,60" fill="none" className="rtm-g-esq-trazo" />;
      case 'bump':
        return [0, 1, 2, 3].map((i) => <path key={i} d={`M 40 ${40 + i * 40} L 200 ${40 + ((i + 1) % 4) * 40} L 360 ${40 + ((i + 2) % 4) * 40} L 520 ${40 + ((i + 3) % 4) * 40}`} fill="none" className="rtm-g-esq-trazo" />);
    }
  })();
  return (
    <svg className="rtm-g-svg rtm-g-esqueleto" data-forma={forma} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      {cuerpo}
    </svg>
  );
}

/** Tabla alterna: los mismos datos que la grafica, con roles ARIA (nunca <table> crudo). */
export function TablaDeGrafica({ titulo, tabla }: { titulo: string; tabla: TablaAlterna }) {
  return (
    <DataTable
      etiqueta={`${titulo} (tabla equivalente)`}
      clave={(f) => f.clave}
      filas={[...tabla.filas]}
      columnas={tabla.columnas.map((c, idx) => ({ id: c.id, titulo: c.titulo, numerica: c.numerica, celda: (f: { celdas: readonly string[] }) => f.celdas[idx] ?? '' }))}
    />
  );
}

interface PropsMarco extends BaseGrafica {
  forma: FormaEsqueleto;
  tabla: TablaAlterna;
  /** Mensaje cuando el estado es error (por omision uno generico). */
  mensajeError?: string;
  /** Tabla abierta desde el inicio (la usan las pruebas y el catalogo). */
  tablaAbierta?: boolean;
  /** Leyenda o lectura adicional bajo la grafica. */
  leyenda?: ReactNode;
  children: ReactNode;
}

export function MarcoGrafica({ titulo, estado = 'listo', procedencia, pie, muestra, forma, tabla, mensajeError, tablaAbierta, leyenda, children }: PropsMarco) {
  const uid = useId();
  const animacion = useAnimacionActiva();
  const sinMuestra = muestra !== undefined && !muestraSuficiente(muestra.actual, muestra.requerida);
  const cargando = estado === 'cargando';
  const anima = animacion && estado === 'listo' && !sinMuestra;

  let cuerpo: ReactNode;
  if (estado === 'error') {
    cuerpo = (
      <div className="rtm-g-aviso" role="alert">
        <strong>No se pudo dibujar</strong>
        <p>{mensajeError ?? 'Intenta de nuevo en un momento.'}</p>
      </div>
    );
  } else if (cargando) {
    cuerpo = (
      <>
        <EsqueletoGrafica forma={forma} />
        <p role="status" className="rtm-solo-lectores">Cargando gráfica</p>
      </>
    );
  } else if (sinMuestra && muestra) {
    cuerpo = (
      <div className="rtm-g-aviso">
        <strong>Pocos datos para hablar de esto</strong>
        <p>{`Hay ${muestra.actual} ${muestra.unidad} y hacen falta ${muestra.requerida} para dibujar la gráfica.`}</p>
      </div>
    );
  } else {
    cuerpo = (
      <>
        {children}
        {leyenda}
        <details className="rtm-grafica-tabla" open={tablaAbierta || undefined}>
          <summary>Ver como tabla</summary>
          <TablaDeGrafica titulo={titulo} tabla={tabla} />
        </details>
      </>
    );
  }

  return (
    <figure className="rtm-grafica rtm-g" aria-labelledby={`${uid}-t`} aria-busy={cargando || undefined} data-estado={estado} data-anim={anima ? 'on' : 'off'} data-grafica={forma}>
      <figcaption className="rtm-g-cabeza">
        <span id={`${uid}-t`} className="rtm-grafica-titulo">{titulo}</span>
        {procedencia && <MarcaProcedencia procedencia={procedencia} />}
      </figcaption>
      {cuerpo}
      {pie && estado === 'listo' && <p className="rtm-g-pie">{pie}</p>}
    </figure>
  );
}
