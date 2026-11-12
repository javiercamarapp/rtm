'use client';

// Indicador de scroll horizontal de una DataTable: si la caja desborda, muestra un desvanecido en el borde con mas contenido y un boton
// "Mas columnas" (o "Atras") que desplaza; ademas vuelve enfocable la caja con teclado. Sin desborde no pinta nada.
import { useCallback, useEffect, useRef, useState } from 'react';

export function IndicadorScroll() {
  const ancla = useRef<HTMLSpanElement>(null);
  const [estado, setEstado] = useState<{ izq: boolean; der: boolean }>({ izq: false, der: false });
  const caja = useCallback((): HTMLElement | null => (ancla.current?.parentElement?.querySelector<HTMLElement>('.rtm-dt-caja') ?? null), []);

  useEffect(() => {
    const el = caja();
    const env = ancla.current?.parentElement;
    if (!el || !env) return;
    const medir = () => {
      const max = el.scrollWidth - el.clientWidth;
      const izq = max > 1 && el.scrollLeft > 2;
      const der = max > 1 && el.scrollLeft < max - 2;
      setEstado((a) => (a.izq === izq && a.der === der ? a : { izq, der }));
      env.dataset.scrollIzq = izq ? 'true' : 'false';
      env.dataset.scrollDer = der ? 'true' : 'false';
      if (max > 1) el.setAttribute('tabindex', '0');
      else el.removeAttribute('tabindex');
    };
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const o = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    o?.observe(el);
    const tabla = el.querySelector('[role=table]');
    if (tabla) o?.observe(tabla);
    return () => {
      el.removeEventListener('scroll', medir);
      o?.disconnect();
    };
  }, [caja]);

  const mover = (dir: 1 | -1) => {
    const el = caja();
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return (
    <span ref={ancla} className="rtm-dt-indicador">
      {estado.izq && <button type="button" className="rtm-dt-mas rtm-dt-mas-izq" onClick={() => mover(-1)} aria-label="Ver columnas anteriores de la tabla">← Atrás</button>}
      {estado.der && <button type="button" className="rtm-dt-mas rtm-dt-mas-der" onClick={() => mover(1)} aria-label="Ver más columnas de la tabla">Más columnas →</button>}
    </span>
  );
}
