import Link from 'next/link';
import type { ReactNode } from 'react';

export type Tono = 'neutro' | 'ok' | 'atencion' | 'malo' | 'info' | 'apagado';

/** Chip de filtro o etiqueta: alto 24, radio pildora. Con href es enlace; `activo` marca la seleccion. `categoria` (1 a 8) pone un punto de la paleta de datos. */
export function Chip({ tono = 'neutro', categoria, activo, href, testid, children }: { tono?: Tono; categoria?: number; activo?: boolean; href?: string; testid?: string; children: ReactNode }) {
  const contenido = (
    <>
      {categoria && <i className="rtm-chip-punto" data-categoria={categoria} aria-hidden="true" />}
      {children}
    </>
  );
  const props = { className: 'rtm-chip-v2', 'data-tono': tono, 'aria-current': activo ? ('true' as const) : undefined, 'data-testid': testid };
  return href ? <Link href={href} {...props}>{contenido}</Link> : <span {...props}>{contenido}</span>;
}

/** Estado en palabra con punto y tinte (alto 22). El color nunca va solo. */
export function ChipEstado({ tono, children }: { tono: Exclude<Tono, 'neutro'>; children: ReactNode }) {
  return (
    <span className="rtm-chip-estado" data-tono={tono}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

/** Filtro de periodo o vista en pildora segmentada. Enlaces reales con aria-current. */
export function Segmentado({ etiquetaAria, opciones, tamano = 'normal' }: { etiquetaAria: string; opciones: { valor: string; etiqueta: string; href: string; activa: boolean; contador?: number; testid?: string }[]; tamano?: 'normal' | 'chico' }) {
  return (
    <nav className="rtm-seg" data-tamano={tamano} aria-label={etiquetaAria}>
      {opciones.map((o) => (
        <Link key={o.valor} href={o.href} aria-current={o.activa ? 'true' : undefined} data-testid={o.testid}>
          {o.etiqueta}
          {o.contador !== undefined && <small>{o.contador}</small>}
        </Link>
      ))}
    </nav>
  );
}

export { Pestanas, type ItemPestana } from './pestanas';

/** Una sola linea de 32 px: filtros a la izquierda, `extras` a la derecha; en movil desplaza en horizontal. */
export function BarraFiltros({ children, extras, etiquetaAria }: { children: ReactNode; extras?: ReactNode; etiquetaAria: string }) {
  return (
    <div className="rtm-barra-filtros-v2" role="group" aria-label={etiquetaAria}>
      {children}
      {extras && <><span className="rtm-barra-filtros-espacio" />{extras}</>}
    </div>
  );
}

/** Aviso en banda compacta de UNA linea para la fila de filtros (extras de BarraFiltros): marca, titular y texto cortado con puntos suspensivos; el texto completo va en title. */
export function AvisoLinea({ tono = 'atencion', titulo, texto, detalle, testid }: { tono?: 'info' | 'atencion' | 'error'; titulo: string; texto: string; detalle?: string; testid?: string }) {
  return (
    <span className="rtm-aviso-linea" data-tono={tono} role={tono === 'error' ? 'alert' : 'status'} title={`${titulo} ${texto}${detalle ? ` ${detalle}` : ''}`}>
      <span className="rtm-aviso-v2-marca" aria-hidden="true">{tono === 'error' ? '!' : tono === 'atencion' ? '•' : 'i'}</span>
      <strong>{titulo}</strong>
      <span data-testid={testid}>{texto}</span>
    </span>
  );
}

/** Monograma: iniciales sobre fondo suave en cuadrado de radio 8 (no circulo). El matiz sale de la paleta de datos segun el texto. */
const MATICES = ['lila', 'verde-azulado', 'azul-marino', 'terracota', 'malva', 'ocre'] as const;
export function Monograma({ nombre, tam = 28 }: { nombre: string; tam?: 28 | 36 }) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const ini = ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase() || '·';
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className="rtm-monograma" data-matiz={MATICES[h % MATICES.length]} data-tam={tam >= 36 ? 'grande' : undefined} aria-hidden="true">
      {ini}
    </span>
  );
}

/** Celda de persona o entidad: monograma, nombre (enlace opcional) y subtitulo gris. */
export function CeldaPersona({ nombre, subtitulo, href, testid }: { nombre: string; subtitulo?: ReactNode; href?: string; testid?: string }) {
  return (
    <span className="rtm-persona">
      <Monograma nombre={nombre} />
      <span className="rtm-persona-texto">
        {href ? <Link href={href} data-testid={testid}>{nombre}</Link> : <strong data-testid={testid}>{nombre}</strong>}
        {subtitulo && <small>{subtitulo}</small>}
      </span>
    </span>
  );
}

/** Aviso en linea: tono info, atencion o error. Nunca del color de su fondo. */
export function Aviso({ tono = 'info', titulo, acciones, children }: { tono?: 'info' | 'atencion' | 'error'; titulo?: string; acciones?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rtm-aviso-v2" data-tono={tono} role={tono === 'error' ? 'alert' : 'status'}>
      <span className="rtm-aviso-v2-marca" aria-hidden="true">{tono === 'error' ? '!' : tono === 'atencion' ? '•' : 'i'}</span>
      <div className="rtm-aviso-v2-texto">{titulo && <strong>{titulo}</strong>}{children && <span>{children}</span>}</div>
      {acciones}
    </div>
  );
}
