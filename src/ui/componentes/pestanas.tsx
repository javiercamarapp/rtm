'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

export interface ItemPestana { id: string; etiqueta: string; href: string; activa: boolean; contador?: number; testid?: string; /** Nombre completo cuando la etiqueta visible es corta. */ titulo?: string }

/**
 * Pestanas o subnavegacion de seccion: SIEMPRE una sola linea (nunca se parten en dos renglones). Si no caben al ancho disponible,
 * la tira se desliza en horizontal con la barra oculta y un desvanecido en el borde que tiene mas contenido; al montar (y al cambiar
 * de pestana) la activa queda visible. Enlaces reales con aria-current="page".
 */
export function Pestanas({ etiquetaAria, items }: { etiquetaAria: string; items: ItemPestana[] }) {
  const ref = useRef<HTMLElement>(null);
  const activa = items.find((i) => i.activa)?.id;

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const marcar = () => {
      const max = nav.scrollWidth - nav.clientWidth;
      nav.dataset.izq = max > 1 && nav.scrollLeft > 2 ? 'true' : 'false';
      nav.dataset.der = max > 1 && nav.scrollLeft < max - 2 ? 'true' : 'false';
    };
    // Centra la activa sin mover la pagina (scrollIntoView tambien desplazaria en vertical).
    const a = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (a && nav.scrollWidth > nav.clientWidth) {
      const dentro = a.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
      nav.scrollLeft = Math.max(0, dentro - (nav.clientWidth - a.offsetWidth) / 2);
    }
    marcar();
    nav.addEventListener('scroll', marcar, { passive: true });
    const o = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(marcar);
    o?.observe(nav);
    return () => { nav.removeEventListener('scroll', marcar); o?.disconnect(); };
  }, [activa]);

  return (
    <nav ref={ref} className="rtm-pestanas" aria-label={etiquetaAria}>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} aria-current={i.activa ? 'page' : undefined} data-testid={i.testid} title={i.titulo}>
              {i.etiqueta}
              {i.contador !== undefined && <small>{i.contador}</small>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
