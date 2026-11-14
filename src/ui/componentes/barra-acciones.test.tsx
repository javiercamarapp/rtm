// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { BarraAcciones } from './barra-acciones';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

const barra = () => (
  <BarraAcciones
    vistas={[{ href: '/a', etiqueta: 'Angelo', titulo: 'Historial de Angelo' }, { href: '/b', etiqueta: 'Cascada', titulo: 'Cascada y actas' }]}
    primarias={<button type="button" className="rtm-boton rtm-boton-primario" title="Registrar depósito de un socio">Registrar depósito</button>}
    secundarias={<><button type="button" className="rtm-boton-item">Registrar gasto</button><button type="button" className="rtm-boton-item">Registrar pago</button></>}
  />
);

describe('BarraAcciones', () => {
  it('es una sola fila: primarias, vistas y menu en un contenedor sin envoltura', () => {
    const m = abrir(montar(barra()));
    const ba = m.cont.querySelector('.rtm-ba')!;
    expect(ba.children.length).toBe(3);
    expect(m.cont.querySelectorAll('.rtm-ba-primarias button').length).toBe(1);
    expect(m.cont.querySelector('[style]')).toBeNull();
  });
  it('el menu Mas abre con el boton, mueve el foco con flechas y cierra con Escape devolviendo el foco', () => {
    const m = abrir(montar(barra()));
    const disparo = m.cont.querySelector<HTMLButtonElement>('[data-testid="barra-mas"]')!;
    const panel = m.cont.querySelector<HTMLElement>('.rtm-ba-panel')!;
    expect(panel.hasAttribute('data-cerrado')).toBe(true);
    expect(disparo.getAttribute('aria-expanded')).toBe('false');
    act(() => disparo.click());
    expect(panel.hasAttribute('data-cerrado')).toBe(false);
    expect(disparo.getAttribute('aria-expanded')).toBe('true');
    act(() => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel.hasAttribute('data-cerrado')).toBe(true);
    expect(document.activeElement).toBe(disparo);
  });
  it('elegir un elemento cierra el menu', () => {
    const m = abrir(montar(barra()));
    const disparo = m.cont.querySelector<HTMLButtonElement>('[data-testid="barra-mas"]')!;
    act(() => disparo.click());
    act(() => m.cont.querySelector<HTMLButtonElement>('.rtm-ba-panel .rtm-boton-item:not(a)')!.click());
    expect(m.cont.querySelector<HTMLElement>('.rtm-ba-panel')!.hasAttribute('data-cerrado')).toBe(true);
  });
  it('sin violaciones de axe, cerrada y abierta', async () => {
    const m = abrir(montar(barra(), 'reduced'));
    expect(await auditar(m.cont)).toEqual([]);
    act(() => m.cont.querySelector<HTMLButtonElement>('[data-testid="barra-mas"]')!.click());
    expect(await auditar(m.cont)).toEqual([]);
  });
});
