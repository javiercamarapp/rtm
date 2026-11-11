import type { ReactNode } from 'react';

/** Estado en PALABRA con tono (ok, atencion, malo, neutro). El color nunca va solo. */
export function EstadoTexto({ tono = 'neutro', children }: { tono?: 'ok' | 'atencion' | 'malo' | 'neutro'; children: ReactNode }) {
  return <span className="rtm-estado-texto" data-tono={tono}>{children}</span>;
}

export function SinDato() {
  return <span className="rtm-sin-dato">Sin dato</span>;
}
