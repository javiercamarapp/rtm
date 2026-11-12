'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Tooltip HTML (no SVG) de las graficas: ancho 160 a 280 px, junto al punto, volteado y acotado al contenedor. En pantalla tactil se oculta y la
 *  lectura pasa a la cinta fija (`CintaLectura`). La posicion se asigna por propiedades del elemento (no por estilo en linea del arbol de React). */
export function TooltipGrafica({ x, y, ancho, visible, children }: { x: number; y: number; ancho: number; visible: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 80;
    const izq = x + 12 + w > ancho ? Math.max(0, x - 12 - w) : x + 12;
    el.style.left = `${Math.max(0, izq)}px`;
    el.style.top = `${Math.max(0, y - h - 8)}px`;
  }, [x, y, ancho, visible, children]);
  return (
    <div ref={ref} className="rtm-g-tip" role="status" hidden={!visible}>
      {children}
    </div>
  );
}

/** Lectura fija para pantallas tactiles: >= 40 px, "Toca o desliza para ver el valor". */
export function CintaLectura({ children }: { children: ReactNode | null }) {
  return <p className="rtm-g-cinta" aria-live="polite">{children ?? 'Toca o desliza para ver el valor'}</p>;
}

export function ContenidoTip({ titulo, cifra, variacion, detalle, parcial }: { titulo: string; cifra: string; variacion?: string; detalle?: string; parcial?: boolean }) {
  return (
    <>
      <span className="rtm-g-tip-titulo">{titulo}{parcial && <em className="rtm-g-tip-parcial">parcial</em>}</span>
      <strong className="rtm-g-tip-cifra">{cifra}</strong>
      {variacion && <span className="rtm-g-tip-var">{variacion}</span>}
      {detalle && <span className="rtm-g-tip-detalle">{detalle}</span>}
    </>
  );
}
