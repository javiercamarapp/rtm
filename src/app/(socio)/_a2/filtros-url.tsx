'use client';

import { useRef, type ReactNode } from 'react';

/** Barra de filtros en UNA linea: formulario GET (la URL es la fuente de verdad). Filtra al cambiar un campo; sin JavaScript queda el boton Aplicar. */
export function FiltrosUrl({ etiquetaAria, children, restablecer }: { etiquetaAria: string; children: ReactNode; restablecer: string }) {
  const f = useRef<HTMLFormElement>(null);
  return (
    <form ref={f} className="rtm-a2-filtros" method="get" role="group" aria-label={etiquetaAria}
      onChange={(e) => { if ((e.target as HTMLElement).dataset.noauto === undefined) f.current?.requestSubmit(); }}>
      {children}
      <button type="submit" className="rtm-boton rtm-boton-chico rtm-a2-aplicar">Aplicar</button>
      <a className="rtm-boton rtm-boton-chico" href={restablecer}>Restablecer</a>
    </form>
  );
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return <label className="rtm-a2-campo"><span>{etiqueta}</span>{children}</label>;
}
