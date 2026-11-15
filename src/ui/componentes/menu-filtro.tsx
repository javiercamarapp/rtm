'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useColision } from './colision';

export interface OpcionMenuFiltro { href: string; etiqueta: string; activa: boolean }

interface Props {
  /** Nombre del filtro; el boton muestra "Nombre: opcion activa". */
  nombre: string;
  opciones: OpcionMenuFiltro[];
  testid?: string;
}

/** Filtro de enlaces agrupado en un desplegable de una sola fila (sustituye una fila de chips que se desborda). Escape cierra y devuelve el foco; flechas recorren. */
export function MenuFiltro({ nombre, opciones, testid }: Props) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const disparo = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useColision(abierto, panel);
  const activa = opciones.find((o) => o.activa);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    (panel.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? panel.current?.querySelector<HTMLElement>('a[href]'))?.focus();
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const teclas = (e: KeyboardEvent) => {
    if (!abierto) return;
    if (e.key === 'Escape') { setAbierto(false); disparo.current?.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('a[href]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="rtm-bb-menu-filtro" ref={raiz} onKeyDown={teclas}>
      <button ref={disparo} type="button" className="rtm-boton" aria-expanded={abierto} aria-controls={id} aria-haspopup="true" onClick={() => setAbierto((a) => !a)} data-testid={testid}>
        {nombre}: {activa?.etiqueta ?? 'Todos'}
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" width="12" height="12"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      <div id={id} className="rtm-bb-menu-panel" data-flota role="group" aria-label={nombre} ref={panel} hidden={!abierto} onClick={() => setAbierto(false)}>
        {opciones.map((o) => <Link key={o.href} href={o.href} className="rtm-boton-item" aria-current={o.activa ? 'true' : undefined}>{o.etiqueta}</Link>)}
      </div>
    </div>
  );
}
