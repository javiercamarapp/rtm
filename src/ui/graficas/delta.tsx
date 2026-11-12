import { palabraSentido } from './formato';
import type { SentidoDelta } from './geo';
import type { DeltaTexto } from './tipos';

const FLECHAS: Record<SentidoDelta, string> = { sube: '▲', baja: '▼', igual: '■' };

export function flechaDe(sentido: SentidoDelta): string {
  return FLECHAS[sentido];
}

/** Cambio entre periodos: flecha, signo (en el texto) y palabra. Sin semaforo por omision; con `bueno` explicito se tine de ok o malo (el sentido siempre va tambien en flecha y signo). */
export function Delta({ delta }: { delta: DeltaTexto }) {
  return (
    <span className="rtm-g-delta" data-sentido={delta.sentido} data-valor={delta.bueno === undefined ? undefined : delta.bueno ? 'bueno' : 'malo'}>
      <span aria-hidden="true" className="rtm-g-delta-flecha">{flechaDe(delta.sentido)}</span>
      <span className="rtm-num">{delta.texto}</span>
      <span className="rtm-solo-lectores">{palabraSentido(delta.sentido)}</span>
    </span>
  );
}
