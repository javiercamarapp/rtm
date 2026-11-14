'use client';

import { useRef, type ReactNode } from 'react';
import { FiltrosPlegables } from '@/ui/componentes/filtros-plegables';

/** Barra de filtros en UNA linea: formulario GET (la URL es la fuente de verdad). Filtra al cambiar un campo; sin JavaScript queda el boton Aplicar. Con `plegable` los campos van en un desplegable flotante (FiltrosPlegables) y siguen montados al cerrar. */
export function FiltrosUrl({ etiquetaAria, children, restablecer, plegable }: { etiquetaAria: string; children: ReactNode; restablecer: string; plegable?: boolean | { etiqueta?: string; activos?: number } }) {
  const f = useRef<HTMLFormElement>(null);
  const formulario = (
    <form ref={f} className="rtm-a2-filtros" method="get" role="group" aria-label={etiquetaAria}
      onChange={(e) => { if ((e.target as HTMLElement).dataset.noauto === undefined) f.current?.requestSubmit(); }}>
      {children}
      <button type="submit" className="rtm-boton rtm-a2-aplicar">Aplicar</button>
      <a className="rtm-boton" href={restablecer}>Restablecer</a>
    </form>
  );
  if (!plegable) return formulario;
  const o = plegable === true ? {} : plegable;
  return <div className="rtm-ba-barra-filtros"><FiltrosPlegables etiqueta={o.etiqueta ?? 'Filtros'} activos={o.activos} titulo={etiquetaAria}>{formulario}</FiltrosPlegables></div>;
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return <label className="rtm-a2-campo"><span>{etiqueta}</span>{children}</label>;
}
