// Ayudas de prueba (jsdom): montar un componente, cambiar el modo de movimiento y auditar con axe. No se importa desde codigo de produccion.
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import axe from 'axe-core';
import { vi } from 'vitest';
import type { ModoMovimiento } from '@/ui/movimiento';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Montaje { cont: HTMLElement; html: () => string; desmontar: () => void }

export function fijarModo(modo: ModoMovimiento | null): void {
  if (modo === null) delete document.documentElement.dataset.movimiento;
  else document.documentElement.dataset.movimiento = modo;
}

export function montar(el: ReactElement, modo: ModoMovimiento | null = 'full'): Montaje {
  fijarModo(modo);
  const cont = document.createElement('div');
  document.body.append(cont);
  const raiz = createRoot(cont);
  act(() => raiz.render(el));
  return {
    cont,
    html: () => cont.innerHTML,
    desmontar: () => {
      act(() => raiz.unmount());
      cont.remove();
    },
  };
}

/** Violaciones de axe en el contenedor. El contraste lo mide el motor del navegador, no jsdom: se valida aparte contra los tokens. */
export async function auditar(cont: Element): Promise<Array<{ id: string; impact?: string | null; nodes: number }>> {
  const r = await axe.run(cont, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
  return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
}

export function teclear(el: Element, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/** El HTML con lo unico que cambia entre modos (el atributo de animacion y los identificadores de useId) normalizado: sirve para comparar el estado final. */
export function sinAtributoDeModo(html: string): string {
  return html.replace(/data-anim="(on|off)"/g, 'data-anim="x"').replace(/_r_[0-9a-z]+_/g, 'ID');
}

/** requestAnimationFrame controlado a mano: cada paso entrega un instante en ms. Quien lo use debe llamar vi.unstubAllGlobals() al terminar. */
export function cuadrosManuales() {
  const pendientes = new Map<number, (ts: number) => void>();
  let id = 0;
  const raf = vi.fn((cb: (ts: number) => void) => {
    id += 1;
    pendientes.set(id, cb);
    return id;
  });
  const cancelar = vi.fn((n: number) => {
    pendientes.delete(n);
  });
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', cancelar);
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = cancelar;
  return {
    raf,
    cancelar,
    avanzar: (ts: number) => {
      const cbs = [...pendientes.values()];
      pendientes.clear();
      act(() => cbs.forEach((cb) => cb(ts)));
    },
  };
}
