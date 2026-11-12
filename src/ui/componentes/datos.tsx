import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chip, type Tono } from './controles';

const pct = (n: number) => Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));

export interface ItemBarList { id: string; etiqueta: string; texto: ReactNode; pct: number | null; nota?: string; tono?: 'ok' | 'atencion' | 'malo'; href?: string; /** Marca de umbral 0-100 sobre la pista. */ umbral?: number }

/** Ranking con barra horizontal proporcional ("Tarjetas  58 %  $745,045"). `pct: null` = sin dato: pista rayada, nunca 0. */
export function BarList({ etiquetaAria, items, mostrarPct = true, columnas = 1 }: { etiquetaAria: string; items: ItemBarList[]; mostrarPct?: boolean; /** 2 = dos columnas en tarjetas anchas (llena el ancho sin alargar la tarjeta). */ columnas?: 1 | 2 }) {
  return (
    <ul className="rtm-barlist" data-columnas={columnas} aria-label={etiquetaAria}>
      {items.map((it) => (
        <li key={it.id} data-tono={it.tono}>
          <span className="rtm-barlist-fila">
            <span className="rtm-barlist-nombre">{it.href ? <Link href={it.href}>{it.etiqueta}</Link> : it.etiqueta}{it.nota && <small>{it.nota}</small>}</span>
            {mostrarPct && <span className="rtm-barlist-pct">{it.pct === null ? '—' : `${Math.round(pct(it.pct))} %`}</span>}
            <span className="rtm-barlist-monto">{it.texto}</span>
          </span>
          <span className="rtm-barlist-pista" data-sin-dato={it.pct === null || undefined} aria-hidden="true">
            <svg width="100%" height="100%" focusable="false">
              {it.pct !== null && <rect x="0" y="0" width={`${Math.max(1.5, pct(it.pct))}%`} height="100%" rx="2" className="rtm-barlist-valor" />}
              {it.umbral !== undefined && <rect x={`${pct(it.umbral)}%`} y="0" width="2" height="100%" className="rtm-barlist-umbral" />}
            </svg>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface Hallazgo { id: string; tono: Exclude<Tono, 'neutro' | 'apagado'>; palabra: string; titulo: ReactNode; detalle?: ReactNode; importe?: ReactNode; accion?: ReactNode; href?: string }

/** Lista de hallazgos ("Requiere tu atencion"): punto de severidad, palabra de severidad, titulo, detalle, importe y accion. */
export function ListaHallazgos({ etiquetaAria, items, vacio }: { etiquetaAria: string; items: Hallazgo[]; vacio: string }) {
  if (items.length === 0) return <p className="rtm-lista-vacia">{vacio}</p>;
  return (
    <ul className="rtm-hallazgos" aria-label={etiquetaAria}>
      {items.map((h) => (
        <li key={h.id}>
          <span className="rtm-hallazgo-punto" data-tono={h.tono} aria-hidden="true" />
          <span className="rtm-hallazgo-texto">
            <strong>{h.href ? <Link href={h.href}>{h.titulo}</Link> : h.titulo}</strong>
            {h.detalle && <small>{h.detalle}</small>}
          </span>
          <Chip tono={h.tono}>{h.palabra}</Chip>
          {h.importe && <span className="rtm-hallazgo-importe">{h.importe}</span>}
          {h.accion}
        </li>
      ))}
    </ul>
  );
}

/** Linea de progreso por pasos (solicitado, aprobado, enviado, recibido). Los pasos anteriores a `actual` estan hechos. */
export function Pasos({ etiquetaAria, items, actual }: { etiquetaAria: string; items: { id: string; etiqueta: string; detalle?: string }[]; actual: number }) {
  return (
    <ol className="rtm-pasos-v2" aria-label={etiquetaAria}>
      {items.map((p, i) => (
        <li key={p.id} data-estado={i < actual ? 'hecho' : i === actual ? 'activo' : 'pendiente'} aria-current={i === actual ? 'step' : undefined}>
          <span className="rtm-pasos-v2-punto" aria-hidden="true">{i < actual ? '✓' : i + 1}</span>
          <strong>{p.etiqueta}</strong>
          {p.detalle && <small>{p.detalle}</small>}
        </li>
      ))}
    </ol>
  );
}

/** Eventos con fecha, vertical, con hilo de 2 px. */
export function LineaTiempo({ eventos, columnas = 1 }: { eventos: { id: string; fecha: string; titulo: ReactNode; detalle?: ReactNode; tono?: 'ok' | 'atencion' | 'malo' }[]; /** 2 = dos columnas en tarjetas de ancho completo. */ columnas?: 1 | 2 }) {
  return (
    <ol className="rtm-ltiempo" data-columnas={columnas}>
      {eventos.map((e) => (
        <li key={e.id} data-tono={e.tono}>
          <time>{e.fecha}</time>
          <strong>{e.titulo}</strong>
          {e.detalle && <small>{e.detalle}</small>}
        </li>
      ))}
    </ol>
  );
}

/** Lista de clave y valor: dt de 12 px gris, dd a su lado. */
export function ListaClaveValor({ items, columnas = 1 }: { items: { k: string; v: ReactNode }[]; columnas?: 1 | 2 }) {
  return (
    <dl className="rtm-ckv" data-columnas={columnas}>
      {items.map((i) => (
        <div key={i.k}>
          <dt>{i.k}</dt>
          <dd>{i.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Pie de paginacion: "Mostrando N de M" y enlaces de pagina anterior y siguiente (URL como fuente de verdad). */
export function Paginador({ mostrados, total, anterior, siguiente }: { mostrados: number; total?: number; anterior?: string; siguiente?: string }) {
  return (
    <div className="rtm-paginador">
      <span>Mostrando {mostrados}{total !== undefined ? ` de ${total}` : ''}</span>
      <span className="rtm-paginador-botones">
        {anterior ? <Link className="rtm-boton rtm-boton-chico" href={anterior}>Anterior</Link> : <span className="rtm-boton rtm-boton-chico" aria-disabled="true">Anterior</span>}
        {siguiente ? <Link className="rtm-boton rtm-boton-chico" href={siguiente}>Siguiente</Link> : <span className="rtm-boton rtm-boton-chico" aria-disabled="true">Siguiente</span>}
      </span>
    </div>
  );
}
