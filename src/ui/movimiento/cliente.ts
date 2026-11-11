'use client';

// Lectura reactiva del modo de movimiento (full | reduced | off) para los componentes que deciden en JavaScript (contadores, clases de entrada).
// Misma fuente que el CSS: atributo data-movimiento de <html>; sin el, la preferencia del sistema. Parte del modulo unico de movimiento.
import { useSyncExternalStore } from 'react';
import { modoInicial, type ModoMovimiento } from './index';

const CONSULTA_REDUCIDO = '(prefers-reduced-motion: reduce)';

export function leerModoMovimiento(): ModoMovimiento {
  if (typeof document === 'undefined') return 'full';
  const prefiere = typeof matchMedia === 'function' && matchMedia(CONSULTA_REDUCIDO).matches;
  return modoInicial(document.documentElement.dataset.movimiento ?? null, prefiere);
}

function suscribir(avisar: () => void): () => void {
  const observador = new MutationObserver(avisar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-movimiento'] });
  const lista = typeof matchMedia === 'function' ? matchMedia(CONSULTA_REDUCIDO) : null;
  lista?.addEventListener('change', avisar);
  return () => {
    observador.disconnect();
    lista?.removeEventListener('change', avisar);
  };
}

/** Modo vigente. En el servidor es `full`; el cliente se corrige al hidratar sin aviso de desajuste. */
export function useModoMovimiento(): ModoMovimiento {
  return useSyncExternalStore(suscribir, leerModoMovimiento, () => 'full');
}

/** Solo `full` anima. `reduced` y `off` pintan el estado final de inmediato. */
export function useAnimacionActiva(): boolean {
  return useModoMovimiento() === 'full';
}
