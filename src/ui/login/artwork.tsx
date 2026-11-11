'use client';

import { useEffect, useRef, useState } from 'react';

/** Ancho mínimo (px) desde el que el panel del arte se muestra; debajo, el CSS lo oculta y aquí no se monta nada (como Vexa). */
export const ANCHO_MINIMO_ARTE = 1024;
/** Equipos modestos: menos partículas (el motor pasa de 4200 a 2400). */
export function equipoModesto(nav: { hardwareConcurrency?: number; deviceMemory?: number }): boolean {
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

/**
 * El arte animado del login (la esfera de números y símbolos, portada de Vexa). Decorativo: `aria-hidden`, sin `style=` (el tamaño del canvas lo fija el motor por atributos y el CSS del panel).
 *
 * No estorba al formulario: el motor se importa DIFERIDO (`import()`), en tiempo ocioso y solo si el panel se muestra (≥ 1024 px); mientras tanto el panel ya tiene su cuadro estático de respaldo (un degradado
 * de CSS) y el canvas entra con un fundido cuando el motor termina. Con `prefers-reduced-motion` el motor pinta un solo cuadro; se pausa con la pestaña oculta o el panel fuera de pantalla
 * (IntersectionObserver + visibilitychange dentro del motor) y la densidad de pantalla se limita a 1.5.
 */
export function LoginArtwork() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    const media = matchMedia(`(min-width: ${ANCHO_MINIMO_ARTE}px)`);
    let dispose: (() => void) | undefined;
    let cancelado = false;
    let espera: number | undefined;
    const apagar = () => { dispose?.(); dispose = undefined; setListo(false); };
    const montar = async () => {
      const lienzo = canvas.current;
      if (!lienzo || cancelado || !media.matches) return;
      try {
        // El atlas de glifos se arma con la fuente real (también en una visita en frío); si no carga, el motor usa la monoespaciada del sistema.
        await document.fonts?.load('36px "IBM Plex Mono"').catch(() => undefined);
        const { mountLoginParticles } = await import('./particle-engine');
        if (cancelado || !media.matches || !canvas.current) return;
        dispose = mountLoginParticles(lienzo, 'sphere', true, false, equipoModesto(navigator as Navigator & { deviceMemory?: number }));
        setListo(true);
      } catch { /* sin arte el login funciona igual: queda el cuadro estático */ }
    };
    const sincronizar = () => {
      apagar();
      if (!media.matches) return;
      const ocioso = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ocioso) espera = ocioso(() => void montar(), { timeout: 1500 });
      else espera = window.setTimeout(() => void montar(), 250);
    };
    sincronizar();
    media.addEventListener('change', sincronizar);
    return () => {
      cancelado = true;
      media.removeEventListener('change', sincronizar);
      if (espera !== undefined) { (window as Window & { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(espera); window.clearTimeout(espera); }
      dispose?.();
    };
  }, []);
  return (
    <div className="login-artwork" aria-hidden="true" data-listo={listo ? '1' : undefined}>
      <canvas ref={canvas} />
      <div className="login-artwork-floor" />
    </div>
  );
}
