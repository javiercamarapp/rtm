'use client';

import { useEffect, useLayoutEffect, useRef, type DetailsHTMLAttributes, type KeyboardEvent as TeclaReact, type RefObject } from 'react';

/** Margen minimo entre un panel flotante y el borde del viewport (px). Coincide con --rtm-flota-margen de flotantes.css. */
export const MARGEN_VIEWPORT = 8;

export type AlineacionPanel = 'izq' | 'der' | 'ancho';
export type SentidoPanel = 'abajo' | 'arriba';

const useLayoutIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Mecanismo unico de colision de los paneles flotantes (menus, desplegables, popovers). Mide el panel contra el viewport y fija
 * `data-alin` (izq | der | ancho) y `data-vert` (abajo | arriba); flotantes.css los traduce a posicion. Pantallas angostas: hoja inferior por CSS.
 * Es el contrato de test/contratos/paneles_flotantes.test.ts: todo panel con `position: absolute` bajo su disparador debe usarlo.
 */
export function colocarPanel(panel: HTMLElement, preferir: 'izq' | 'der' = 'izq'): void {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const m = MARGEN_VIEWPORT;
  panel.dataset.vert = 'abajo';
  panel.dataset.alin = preferir;
  if (window.matchMedia?.('(max-width: 767px)').matches) return; // hoja inferior: la fija el CSS
  const desborde = (r: DOMRect) => Math.max(0, r.right - (vw - m)) + Math.max(0, m - r.left);
  let alin: AlineacionPanel = preferir;
  let d = desborde(panel.getBoundingClientRect());
  if (d > 0) {
    const otro = preferir === 'izq' ? 'der' : 'izq';
    panel.dataset.alin = otro;
    const d2 = desborde(panel.getBoundingClientRect());
    if (d2 < d) { alin = otro; d = d2; }
    panel.dataset.alin = alin;
  }
  if (d > 0) panel.dataset.alin = 'ancho'; // no cabe en ninguna alineacion: ocupa el ancho util del viewport
  const ancla = (panel.offsetParent as HTMLElement | null) ?? panel.parentElement;
  const r = panel.getBoundingClientRect();
  if (ancla && r.bottom > vh - m) {
    const a = ancla.getBoundingClientRect();
    if (a.top - m > vh - a.bottom - m) panel.dataset.vert = 'arriba';
  }
}

/** Reposiciona el panel al abrirlo y cuando cambia el tamano de la ventana. */
export function useColision(abierto: boolean, panel: RefObject<HTMLElement | null>, preferir: 'izq' | 'der' = 'izq'): void {
  useLayoutIso(() => {
    const el = panel.current;
    if (!abierto || !el) return;
    const colocar = () => colocarPanel(el, preferir);
    colocar();
    window.addEventListener('resize', colocar);
    return () => window.removeEventListener('resize', colocar);
  }, [abierto, panel, preferir]);
}

/** Foco atrapado: Tab en el ultimo campo vuelve al primero y Mayus+Tab en el primero va al ultimo. */
export function atraparTab(e: TeclaReact | KeyboardEvent, panel: HTMLElement | null): void {
  if (e.key !== 'Tab' || !panel) return;
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLES)].filter((x) => !x.hidden && x.getClientRects().length > 0 || x === document.activeElement);
  if (items.length === 0) return;
  const primero = items[0]!;
  const ultimo = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
  else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
}

/** Primer campo enfocable de un panel recien abierto. */
export function enfocarPrimero(panel: HTMLElement | null): void {
  panel?.querySelector<HTMLElement>(FOCUSABLES)?.focus({ preventScroll: true });
}

/** `details` con panel flotante hijo (fieldset): coloca el panel al abrirse, cierra con Escape devolviendo el foco al resumen y al pulsar fuera. */
export function DetallesFlotantes({ children, ...resto }: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const det = ref.current;
    if (!det) return;
    const colocar = () => { if (det.open) { const p = det.querySelector<HTMLElement>(':scope > [data-flota]'); if (p) colocarPanel(p); } };
    const fuera = (e: MouseEvent) => { if (det.open && !det.contains(e.target as Node)) det.open = false; };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && det.open) { det.open = false; det.querySelector<HTMLElement>('summary')?.focus(); } };
    det.addEventListener('toggle', colocar);
    window.addEventListener('resize', colocar);
    document.addEventListener('mousedown', fuera);
    det.addEventListener('keydown', tecla);
    return () => { det.removeEventListener('toggle', colocar); window.removeEventListener('resize', colocar); document.removeEventListener('mousedown', fuera); det.removeEventListener('keydown', tecla); };
  }, []);
  return <details ref={ref} {...resto}>{children}</details>;
}
