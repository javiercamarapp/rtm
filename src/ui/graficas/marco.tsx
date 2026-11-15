'use client';

// Marco comun de toda grafica: titulo, marca de procedencia, estados (cargando con una linea de texto, error, muestra insuficiente),
// tabla alterna con los mismos datos ("Ver como tabla") y pie de corte y fuente.
import { useId, type ReactNode } from 'react';
import { DataTable } from '../componentes/data-table';
import { useAnimacionActiva } from '../movimiento/cliente';
import { MarcaProcedencia } from './piezas';
import { muestraSuficiente } from './geo';
import type { BaseGrafica, EstadoGrafica, TablaAlterna } from './tipos';

/** Estado efectivo: cargando manda sobre un error de datos (aun no hay datos que validar); un error de calculo pasa a error. */
export function estadoDe(pedido: EstadoGrafica | undefined, calculoOk: boolean): EstadoGrafica {
  if (pedido === 'cargando') return 'cargando';
  return calculoOk ? (pedido ?? 'listo') : 'error';
}

export type FormaEsqueleto = 'barras' | 'linea' | 'cascada' | 'pareto' | 'calor' | 'burbujas' | 'treemap' | 'radar' | 'bump' | 'apilada' | 'cobertura' | 'sparkline';

/** Indicador de carga de una grafica: una sola linea de texto con un punto discreto. Sin cajas ni formas vacias, sin altura reservada. */
export function EsqueletoGrafica({ forma }: { forma: FormaEsqueleto }) {
  return <p className="rtm-g-cargando" data-forma={forma}><span className="rtm-punto-carga" aria-hidden="true" />Cargando gráfica…</p>;
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
