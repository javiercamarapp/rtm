import type { ReactNode } from 'react';

export interface Columna<T> {
  id: string;
  titulo: string;
  celda: (fila: T) => ReactNode;
  /** Cifras: alineadas a la derecha y tabulares. */
  numerica?: boolean;
  /** Oculta la columna en pantallas angostas. */
  secundaria?: boolean;
}

interface Props<T> {
  etiqueta: string;
  columnas: Columna<T>[];
  filas: T[];
  clave: (fila: T) => string | number;
  estado?: 'listo' | 'cargando' | 'error';
  vacio?: { titulo: string; texto: string; accion?: ReactNode };
  error?: { texto: string; accion?: ReactNode };
}

/** Tabla de datos con roles ARIA (nunca <table> crudo): cifras a la derecha, estados de carga (esqueleto con la forma final), vacio y error con accion. */
export function DataTable<T>({ etiqueta, columnas, filas, clave, estado = 'listo', vacio, error }: Props<T>) {
  if (estado === 'error') {
    return (
      <div className="rtm-dt-aviso" role="alert">
        <strong>No se pudo cargar</strong>
        <p>{error?.texto ?? 'Intenta de nuevo en un momento.'}</p>
        {error?.accion}
      </div>
    );
  }
  if (estado === 'listo' && filas.length === 0) {
    return (
      <div className="rtm-dt-aviso">
        <strong>{vacio?.titulo ?? 'Sin datos'}</strong>
        <p>{vacio?.texto ?? 'Todavía no hay nada que mostrar.'}</p>
        {vacio?.accion}
      </div>
    );
  }
  const cargando = estado === 'cargando';
  return (
    <div className="rtm-dt-caja" data-estado={estado} aria-busy={cargando || undefined}>
      <div className="rtm-dt" role="table" aria-label={etiqueta} aria-rowcount={cargando ? undefined : filas.length + 1}>
        <div className="rtm-dt-grupo" role="rowgroup">
          <div className="rtm-dt-fila rtm-dt-cabecera" role="row">
            {columnas.map((c) => (
              <div key={c.id} role="columnheader" className="rtm-dt-celda" data-num={c.numerica || undefined} data-secundaria={c.secundaria || undefined}>
                {c.titulo}
              </div>
            ))}
          </div>
        </div>
        <div className="rtm-dt-grupo" role="rowgroup">
          {cargando
            ? [0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="rtm-dt-fila" role="row" data-esqueleto="true">
                  {columnas.map((c) => (
                    <div key={c.id} role="cell" className="rtm-dt-celda" data-num={c.numerica || undefined} data-secundaria={c.secundaria || undefined}>
                      <span className="rtm-esqueleto" aria-hidden="true" />
                    </div>
                  ))}
                </div>
              ))
            : filas.map((f) => (
                <div key={clave(f)} className="rtm-dt-fila" role="row">
                  {columnas.map((c) => (
                    <div key={c.id} role="cell" className="rtm-dt-celda" data-num={c.numerica || undefined} data-secundaria={c.secundaria || undefined}>
                      {c.celda(f)}
                    </div>
                  ))}
                </div>
              ))}
        </div>
      </div>
      {cargando && <span className="rtm-solo-lectores">Cargando</span>}
    </div>
  );
}
