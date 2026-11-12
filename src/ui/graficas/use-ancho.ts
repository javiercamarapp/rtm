'use client';

import { useEffect, useRef, useState } from 'react';

/** Ancho real del contenedor (ResizeObserver). Sin scroll horizontal ni texto escalado: el SVG se dibuja a su tamano de pantalla. */
export function useAnchoReal(inicial = 560): { ref: React.RefObject<HTMLDivElement | null>; ancho: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAncho(Math.max(160, Math.floor(el.getBoundingClientRect().width)));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return { ref, ancho };
}
