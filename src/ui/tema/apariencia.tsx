'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { useColision } from '../componentes/colision';
import { aplicarModoMovimiento, type ModoMovimiento } from '../movimiento';
import { IconoAjustes } from '../iconos';

type Acento = 'neutro' | 'lila';

function suscribir(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-acento', 'data-movimiento'] });
  return () => obs.disconnect();
}

const leerAcento = (): Acento => (document.documentElement.dataset.acento === 'lila' ? 'lila' : 'neutro');
const leerMovimiento = (): ModoMovimiento => {
  const m = document.documentElement.dataset.movimiento;
  return m === 'reduced' || m === 'off' ? m : 'full';
};

/** Popover de apariencia: acento (neutro | lila) y movimiento (completo | reducido | sin). */
export function Apariencia() {
  const [abierto, setAbierto] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useColision(abierto, panel, 'der');
  const acento = useSyncExternalStore(suscribir, leerAcento, () => 'neutro' as Acento);
  const movimiento = useSyncExternalStore(suscribir, leerMovimiento, () => 'full' as ModoMovimiento);

  const fijarAcento = (a: Acento) => {
    document.documentElement.dataset.acento = a;
    try {
      localStorage.setItem('rtm-acento', a);
    } catch {
      /* solo esta visita */
    }
  };

  return (
    <div className="rtm-popover-ancla">
      <button type="button" className="rtm-icono-boton" aria-label="Apariencia" aria-expanded={abierto} aria-controls="rtm-apariencia" onClick={() => setAbierto((v) => !v)}>
        <IconoAjustes />
      </button>
      {abierto && (
        <div id="rtm-apariencia" ref={panel} className="rtm-popover" data-flota role="dialog" aria-label="Apariencia">
          <fieldset className="rtm-grupo">
            <legend>Acento</legend>
            <div className="rtm-segmentos">
              <button type="button" className="rtm-segmento" aria-pressed={acento === 'neutro'} onClick={() => fijarAcento('neutro')}>Neutro</button>
              <button type="button" className="rtm-segmento" aria-pressed={acento === 'lila'} onClick={() => fijarAcento('lila')}>Lila</button>
            </div>
          </fieldset>
          <fieldset className="rtm-grupo">
            <legend>Movimiento</legend>
            <div className="rtm-segmentos">
              <button type="button" className="rtm-segmento" aria-pressed={movimiento === 'full'} onClick={() => aplicarModoMovimiento('full')}>Completo</button>
              <button type="button" className="rtm-segmento" aria-pressed={movimiento === 'reduced'} onClick={() => aplicarModoMovimiento('reduced')}>Reducido</button>
              <button type="button" className="rtm-segmento" aria-pressed={movimiento === 'off'} onClick={() => aplicarModoMovimiento('off')}>Sin</button>
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
