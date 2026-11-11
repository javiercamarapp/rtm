'use client';

import type { ReactNode } from 'react';
import { Contador } from './contador';
import { Delta, MarcaProcedencia } from './piezas';
import type { TipoCifra } from './formato';
import type { DeltaTexto, Procedencia } from './tipos';
import { useAnimacionActiva } from '../movimiento/cliente';
import { claseEscalonado } from './geo';

export type Severidad = 'Informa' | 'Atención' | 'Acción';

interface Props {
  etiqueta: string;
  cifra: { valor: number; tipo?: TipoCifra; decimales?: number; unidad?: string };
  /** Frase de una linea de plantilla determinista (nunca texto libre de IA). */
  frase: string;
  delta?: DeltaTexto;
  procedencia: Procedencia;
  severidad: Severidad;
  /** Minigrafica (por ejemplo un Sparkline). */
  minigrafica?: ReactNode;
  /** Enlace a la evidencia. */
  evidencia?: { href: string; texto?: string };
  /** Posicion en la entrada escalonada (maximo 6 elementos se retrasan). */
  indice?: number;
}

/** Tarjeta de insight: etiqueta, cifra heroe, frase, flecha de cambio, marca de procedencia y evidencia. La severidad va en texto. */
export function TarjetaInsight({ etiqueta, cifra, frase, delta, procedencia, severidad, minigrafica, evidencia, indice = 0 }: Props) {
  const anima = useAnimacionActiva();
  return (
    <article className={anima ? `rtm-g-insight rtm-entra ${claseEscalonado(indice)}` : 'rtm-g-insight'} data-severidad={severidad} data-anim={anima ? 'on' : 'off'} aria-label={etiqueta}>
      <header className="rtm-g-insight-cabeza">
        <h3 className="rtm-g-insight-etiqueta">{etiqueta}</h3>
        <span className="rtm-g-severidad">{severidad}</span>
      </header>
      <p className="rtm-g-insight-cifra">
        <Contador valor={cifra.valor} tipo={cifra.tipo} decimales={cifra.decimales} />
        {cifra.unidad && <span className="rtm-g-insight-unidad">{cifra.unidad}</span>}
        {delta && <Delta delta={delta} />}
      </p>
      <p className="rtm-g-insight-frase">{frase}</p>
      {minigrafica && <div className="rtm-g-insight-mini">{minigrafica}</div>}
      <footer className="rtm-g-insight-pie">
        <MarcaProcedencia procedencia={procedencia} />
        {evidencia && <a className="rtm-g-insight-enlace" href={evidencia.href}>{evidencia.texto ?? 'Ver evidencia'}</a>}
      </footer>
    </article>
  );
}
