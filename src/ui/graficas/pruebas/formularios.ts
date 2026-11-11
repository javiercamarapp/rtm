// Ayudas de prueba (jsdom) para formularios controlados de React. No se importan desde codigo de produccion.
import { act } from 'react';

/** Escribe en un input/select/textarea controlado por React (setter nativo + evento), como lo haria una persona. */
export function escribir(el: Element | null, valor: string): void {
  if (!el) throw new Error('campo no encontrado');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export async function clic(el: Element | null): Promise<void> {
  if (!el) throw new Error('elemento no encontrado');
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export async function enviar(form: Element | null): Promise<void> {
  if (!form) throw new Error('formulario no encontrado');
  await act(async () => {
    (form as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

/** jsdom aun no implementa <dialog>.showModal: se simula abriendo el atributo. */
export function simularDialogo(): void {
  const p = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  p.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  p.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

export const porTestid = (cont: ParentNode, id: string): Element | null => cont.querySelector(`[data-testid="${id}"]`);
