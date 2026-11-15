import { Fragment, type ReactNode } from 'react';
import { Pestanas } from './controles';
import { IndicadorScroll } from './indicador-scroll';
import { TablaInteractiva, type OpcionesInteractiva } from './tabla-interactiva';

export interface Columna<T> {
  id: string;
  titulo: string;
  celda: (fila: T) => ReactNode;
  /** Cifras: alineadas a la derecha y tabulares. */
  numerica?: boolean;
  /** Oculta la columna en pantallas angostas. */
  secundaria?: boolean;
  /** Ancho minimo por tipo de dato: xs 56, s 72, m 96, l 120, xl 200 px. */
  ancho?: 'xs' | 's' | 'm' | 'l' | 'xl';
  /** Etiqueta de bloque (ENTRADAS, SALIDAS, EXISTENCIAS): se pinta en una fila de cabecera de grupo sobre las columnas consecutivas que la comparten. */
  bloque?: string;
  /** Recorta el texto largo con puntos suspensivos (el texto completo queda en el atributo title): s 120, m 200, l 280 px. */
  truncar?: 's' | 'm' | 'l';
  /** Tarjeta-fila en movil (<= 767 px): titulo = linea principal (izquierda), principal = cifra clave a la derecha, normal = dato con etiqueta en rejilla de 3 columnas,
   *  detalle = fila a todo el ancho, oculta = no se muestra. Si alguna columna lo declara, la tabla pasa a tarjetas en movil. */
  prioridadMovil?: 'titulo' | 'principal' | 'detalle' | 'normal' | 'oculta';
  /** Oculta la columna en pantallas de hasta ese ancho (px). Solo para valores derivables de otros visibles (el CSV los conserva). */
  ocultarBajo?: 1360;
  /** Etiqueta del dato en la tarjeta movil (por omision, el titulo de la columna). */
  etiquetaMovil?: string;
  /** Resalta existencia en cero (ambar, "Agotado") o negativa (rojo, "Negativa"): palabra y color, nunca solo color. */
  resaltar?: (fila: T) => 'cero' | 'negativo' | null;
}

export interface AgrupacionTabla<T> {
  clave: (fila: T) => string;
  /** Texto de la fila de grupo (modelo, mes) y, por columna, su subtotal. */
  cabecera: (clave: string, filas: T[]) => { titulo: ReactNode; subtotales?: Record<string, ReactNode> };
  cerradosPorDefecto?: boolean;
}

export interface PestanaTabla { id: string; etiqueta: string; href: string; activa: boolean; contador?: number }

interface Props<T> {
  etiqueta: string;
  columnas: Columna<T>[];
  filas: T[];
  clave: (fila: T) => string | number;
  estado?: 'listo' | 'cargando' | 'error';
  vacio?: { titulo: string; texto: string; accion?: ReactNode };
  error?: { texto: string; accion?: ReactNode };
  /** v2: 40 / 32 / 28 px de fila. */
  densidad?: 'normal' | 'densa' | 'libro';
  /** v2: sin borde propio (dentro de una Tarjeta plana). */
  plana?: boolean;
  /** v2: encabezado fijo con scroll interno (max 62 % de la ventana, 640 px). */
  pegajosa?: boolean;
  /** v2: primera columna fija al desplazar en horizontal. */
  primeraFija?: boolean;
  /** v2: fila de totales al final de la tabla, en el flujo (nunca sticky); los totales deben ser los del filtro completo, no los de la pagina. */
  totales?: { etiqueta: string; /** Complemento del rotulo (p. ej. "de los enviados"): va como ayuda y para lectores, no ensancha el pie. */ detalle?: string; celdas: Record<string, ReactNode> };
  /** v2: grupos colapsables con subtotal en la fila del grupo. */
  agrupar?: AgrupacionTabla<T>;
  /** v2: pestanas de filtro con contador sobre la tabla. */
  pestanas?: { etiquetaAria: string; items: PestanaTabla[] };
  /** v2: busqueda, paginacion y exportacion CSV en el navegador. */
  interactiva?: OpcionesInteractiva;
}

/** Claves de `totales.celdas` que no corresponden a ningun id de columna (el total caeria en otra columna o se perderia sin avisar). */
export function clavesTotalesHuerfanas(columnas: readonly { id: string }[], celdas: Record<string, unknown>): string[] {
  const ids = new Set(columnas.map((c) => c.id));
  return Object.keys(celdas).filter((k) => !ids.has(k));
}

/** Tabla de datos con roles ARIA (nunca la etiqueta de tabla cruda): cifras a la derecha, estados de carga (esqueleto con la forma final), vacio y error con accion.
 *  v2 enterprise (todo opcional): densidad, encabezado y primera columna fijos, bloques de columnas, grupos colapsables, pie de totales, resaltado de cero y negativos,
 *  pestanas con contador, busqueda, paginacion y exportacion. */
export function DataTable<T>({ etiqueta, columnas, filas, clave, estado = 'listo', vacio, error, densidad = 'normal', plana, pegajosa, primeraFija, totales, agrupar, pestanas, interactiva }: Props<T>) {
  if (totales && process.env.NODE_ENV !== 'production') {
    const huerfanas = clavesTotalesHuerfanas(columnas, totales.celdas);
    if (huerfanas.length) console.error(`DataTable "${etiqueta}": totales sin columna (${huerfanas.join(', ')})`);
  }
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
      <>
        {pestanas && <Pestanas etiquetaAria={pestanas.etiquetaAria} items={pestanas.items.map((p) => ({ ...p }))} />}
        <div className="rtm-dt-aviso">
          <strong>{vacio?.titulo ?? 'Sin datos'}</strong>
          <p>{vacio?.texto ?? 'Todavía no hay nada que mostrar.'}</p>
          {vacio?.accion}
        </div>
      </>
    );
  }
  const cargando = estado === 'cargando';
  // Tarjeta-fila movil: si la tabla no declara prioridades se deducen (primera columna = titulo, ultima cifra = principal, el resto con etiqueta).
  const declarada = columnas.some((c) => c.prioridadMovil !== undefined);
  const ultimaCifra = declarada ? -1 : columnas.map((c) => c.numerica).lastIndexOf(true);
  const prioridadDe = (c: Columna<T>, i: number) => c.prioridadMovil ?? (declarada ? undefined : i === 0 ? 'titulo' : i === ultimaCifra && ultimaCifra > 0 ? 'principal' : 'normal');
  const atributosCelda = (c: Columna<T>, i = columnas.indexOf(c)) => ({ 'data-num': c.numerica || undefined, 'data-secundaria': c.secundaria || undefined, 'data-ancho': c.ancho, 'data-mov': prioridadDe(c, i), 'data-label': c.etiquetaMovil ?? c.titulo, 'data-oculta-bajo': c.ocultarBajo });
  const tarjetaMovil = columnas.length > 1;
  const celdaContenido = (c: Columna<T>, f: T) => {
    const v = c.celda(f);
    return c.truncar ? <span className="rtm-dt-trunc" data-trunc={c.truncar} title={typeof v === 'string' ? v : undefined}>{v}</span> : v;
  };
  const hayBloques = columnas.some((c) => c.bloque);

  const filaDe = (f: T, grupo?: string) => (
    <div key={clave(f)} className="rtm-dt-fila" role="row" data-fila="true" data-en-grupo={grupo}>
      {columnas.map((c) => {
        const r = c.resaltar?.(f) ?? null;
        return (
          <div key={c.id} role="cell" className="rtm-dt-celda" {...atributosCelda(c)} data-resalte={r ?? undefined}>
            {celdaContenido(c, f)}
            {r && <span className="rtm-dt-marca">{r === 'cero' ? 'Agotado' : 'Negativa'}</span>}
          </div>
        );
      })}
    </div>
  );

  let cuerpo: ReactNode;
  if (cargando) {
    cuerpo = [0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="rtm-dt-fila" role="row" data-esqueleto="true">
        {columnas.map((c) => (
          <div key={c.id} role="cell" className="rtm-dt-celda" {...atributosCelda(c)}>
            <span className="rtm-esqueleto" aria-hidden="true" />
          </div>
        ))}
      </div>
    ));
  } else if (agrupar) {
    const grupos = new Map<string, T[]>();
    for (const f of filas) {
      const k = agrupar.clave(f);
      (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(f);
    }
    cuerpo = [...grupos.entries()].map(([k, fs]) => {
      const cab = agrupar.cabecera(k, fs);
      return (
        <Fragment key={`g:${k}`}>
          <div className="rtm-dt-fila rtm-dt-fila-grupo" role="row" data-fila="true" data-grupo-cab={k} data-abierto={agrupar.cerradosPorDefecto ? 'false' : 'true'}>
            {columnas.map((c, i) => (
              <div key={c.id} role="cell" className="rtm-dt-celda" {...atributosCelda(c)}>
                {i === 0 ? (
                  <button type="button" className="rtm-dt-grupo-boton" aria-expanded={!agrupar.cerradosPorDefecto} aria-label={`Mostrar u ocultar ${k}`}>
                    <span aria-hidden="true" className="rtm-dt-flecha" />
                    {cab.titulo}
                  </button>
                ) : (
                  (cab.subtotales?.[c.id] ?? null)
                )}
              </div>
            ))}
          </div>
          {fs.map((f) => filaDe(f, k))}
        </Fragment>
      );
    });
  } else {
    cuerpo = filas.map((f) => filaDe(f));
  }

  const caja = (
    <div className="rtm-dt-caja" data-desliza="99999" data-estado={estado} data-densidad={densidad} data-plana={plana || undefined} data-pegajosa={pegajosa || undefined} data-primera-fija={primeraFija || undefined} data-tarjeta-movil={tarjetaMovil || undefined} aria-busy={cargando || undefined}>
      <div className="rtm-dt" role="table" aria-label={etiqueta} aria-rowcount={cargando ? undefined : filas.length + 1}>
        <div className="rtm-dt-grupo" role="rowgroup">
          {hayBloques && (
            <div className="rtm-dt-fila rtm-dt-cabecera rtm-dt-bloques" role="row" aria-hidden="true">
              {columnas.map((c, i) => (
                <div key={c.id} className="rtm-dt-celda" {...atributosCelda(c)} data-bloque-inicio={c.bloque && c.bloque !== columnas[i - 1]?.bloque ? true : undefined}>
                  {c.bloque && c.bloque !== columnas[i - 1]?.bloque ? c.bloque : ''}
                </div>
              ))}
            </div>
          )}
          <div className="rtm-dt-fila rtm-dt-cabecera" role="row">
            {columnas.map((c, i) => (
              <div key={c.id} role="columnheader" className="rtm-dt-celda" {...atributosCelda(c)} data-bloque-inicio={c.bloque && c.bloque !== columnas[i - 1]?.bloque ? true : undefined}>
                {c.titulo}
              </div>
            ))}
          </div>
        </div>
        <div className="rtm-dt-grupo rtm-dt-cuerpo" role="rowgroup">{cuerpo}</div>
        {totales && !cargando && (
          <div className="rtm-dt-grupo rtm-dt-pie" role="rowgroup">
            <div className="rtm-dt-fila" role="row">
              {columnas.map((c, i) => (
                <div key={c.id} role="cell" className="rtm-dt-celda" {...atributosCelda(c)}>
                  {i === 0 ? <strong title={totales.detalle ? `${totales.etiqueta} ${totales.detalle}` : undefined}>{totales.etiqueta}{totales.detalle && <span className="rtm-solo-lectores"> {totales.detalle}</span>}</strong> : (totales.celdas[c.id] ?? null)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {cargando && <span className="rtm-solo-lectores">Cargando</span>}
    </div>
  );
  const tabla = (
    <div className="rtm-dt-env">
      {caja}
      <IndicadorScroll />
    </div>
  );

  const envuelto = interactiva || agrupar ? <TablaInteractiva etiqueta={etiqueta} opciones={interactiva ?? {}} cerradosPorDefecto={agrupar?.cerradosPorDefecto}>{tabla}</TablaInteractiva> : tabla;
  return pestanas ? (
    <>
      <Pestanas etiquetaAria={pestanas.etiquetaAria} items={pestanas.items.map((p) => ({ ...p }))} />
      {envuelto}
    </>
  ) : (
    envuelto
  );
}
