'use client';

import { useExplicar } from './explicar';

interface Props {
  /** Texto ya formateado por el servidor ($1,234.50, 1,524 pz). null = no hay dato. */
  texto: string | null;
  /** Identificador de la cifra para "Explicar este número" (existencia:modelo:12, margen:3:7). */
  cifra: string;
  comprobacion?: 'cuadra' | 'no_cuadra' | 'sin_comprobar';
}

/** Toda cifra monetaria o de piezas se muestra con este componente: abre el cajon "Explicar este número". Sin dato: palabra, nunca un cero inventado. */
export function CifraComprobada({ texto, cifra, comprobacion = 'sin_comprobar' }: Props) {
  const { abrir } = useExplicar();
  if (texto === null) return <span className="rtm-sin-dato">Sin dato</span>;
  return (
    <button type="button" className="rtm-cifra rtm-num" aria-label={`${texto}. Explicar este número`} data-comprobacion={comprobacion} data-cifra={cifra} onClick={(e) => abrir(cifra, e.currentTarget)}>
      {texto}
    </button>
  );
}
