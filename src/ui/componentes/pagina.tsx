import type { ReactNode } from 'react';
import { indiceEscalonado } from '../movimiento';

interface EncabezadoProps {
  eyebrow: string;
  /** Texto del titular; `enfasis` se pinta en cursiva (una sola palabra o cifra). */
  antes?: string;
  enfasis: string;
  despues?: string;
  contexto?: string;
  acciones?: ReactNode;
}

/** Anatomia de pagina: eyebrow, titular serif de 36 px con una palabra en cursiva, linea de contexto y acciones (una primaria). */
export function EncabezadoPagina({ eyebrow, antes, enfasis, despues, contexto, acciones }: EncabezadoProps) {
  return (
    <header className="rtm-entra rtm-i-0">
      <p className="rtm-eyebrow">{eyebrow}</p>
      <h1 className="rtm-titular">
        {antes ? `${antes} ` : ''}
        <em>{enfasis}</em>
        {despues ? ` ${despues}` : ''}
      </h1>
      {contexto && <p className="rtm-contexto">{contexto}</p>}
      {acciones && <div className="rtm-acciones">{acciones}</div>}
    </header>
  );
}

/** Estado vacio con explicacion y, si la hay, una accion. Nunca un cero inventado. */
export function EstadoVacio({ titulo, texto, children, indice = 1 }: { titulo: string; texto: string; children?: ReactNode; indice?: number }) {
  return (
    <section className={`rtm-vacio rtm-entra rtm-i-${indiceEscalonado(indice)}`} aria-labelledby="vacio-titulo">
      <h2 id="vacio-titulo">{titulo}</h2>
      <p>{texto}</p>
      {children}
    </section>
  );
}
