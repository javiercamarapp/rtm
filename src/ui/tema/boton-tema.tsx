'use client';

import { useSyncExternalStore } from 'react';
import { IconoLuna, IconoSol } from '../iconos';

type Tema = 'claro' | 'oscuro';

function leer(): Tema {
  return document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro';
}

function suscribir(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
  return () => obs.disconnect();
}

/** Boton sol/luna. El tema ya esta aplicado por el script bloqueante del <head>, asi que no hay parpadeo al hidratar. */
export function BotonTema() {
  const tema = useSyncExternalStore(suscribir, leer, () => 'claro' as Tema);
  const alternar = () => {
    const siguiente: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
    document.documentElement.dataset.tema = siguiente;
    try {
      localStorage.setItem('rtm-tema', siguiente);
    } catch {
      /* sin almacenamiento: vale solo para esta visita */
    }
  };
  return (
    <button type="button" className="rtm-icono-boton" onClick={alternar} aria-label={tema === 'oscuro' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'} data-testid="boton-tema">
      {tema === 'oscuro' ? <IconoSol /> : <IconoLuna />}
    </button>
  );
}
