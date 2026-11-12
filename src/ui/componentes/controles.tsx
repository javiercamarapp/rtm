import Link from 'next/link';
import type { ReactNode } from 'react';

export type Tono = 'neutro' | 'ok' | 'atencion' | 'malo' | 'info' | 'apagado';

/** Chip de filtro o etiqueta: alto 24, radio pildora. Con href es enlace; `activo` marca la seleccion. `categoria` (1 a 8) pone un punto de la paleta de datos. */
export function Chip({ tono = 'neutro', categoria, activo, href, children }: { tono?: Tono; categoria?: number; activo?: boolean; href?: string; children: ReactNode }) {
  const contenido = (
    <>
      {categoria && <i className="rtm-chip-punto" data-categoria={categoria} aria-hidden="true" />}
      {children}
    </>
  );
  const props = { className: 'rtm-chip-v2', 'data-tono': tono, 'aria-current': activo ? ('true' as const) : undefined };
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

/** Pestanas de seccion (maximo 6) con subrayado de 2 px y contador. Sustituye al subnav. */
export function Pestanas({ etiquetaAria, items }: { etiquetaAria: string; items: { id: string; etiqueta: string; href: string; activa: boolean; contador?: number }[] }) {
  return (
    <nav className="rtm-pestanas" aria-label={etiquetaAria}>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} aria-current={i.activa ? 'page' : undefined}>
              {i.etiqueta}
              {i.contador !== undefined && <small>{i.contador}</small>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Una sola linea de 32 px: filtros a la izquierda, `extras` a la derecha; en movil desplaza en horizontal. */
export function BarraFiltros({ children, extras, etiquetaAria }: { children: ReactNode; extras?: ReactNode; etiquetaAria: string }) {
  return (
    <div className="rtm-barra-filtros-v2" role="group" aria-label={etiquetaAria}>
      {children}
      {extras && <><span className="rtm-barra-filtros-espacio" />{extras}</>}
    </div>
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
export function CeldaPersona({ nombre, subtitulo, href }: { nombre: string; subtitulo?: ReactNode; href?: string }) {
  return (
    <span className="rtm-persona">
      <Monograma nombre={nombre} />
      <span className="rtm-persona-texto">
        {href ? <Link href={href}>{nombre}</Link> : <strong>{nombre}</strong>}
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
