// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { FiltrosPlegables } from './filtros-plegables';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });

const filtros = (activos = 0) => (
  <form>
    <FiltrosPlegables etiqueta="Filtros" activos={activos}><label className="rtm-etiqueta-campo">Desde<input name="desde" type="date" /></label></FiltrosPlegables>
  </form>
);

describe('FiltrosPlegables', () => {
  it('nace cerrado, abre y cierra con el disparador y con Escape devolviendo el foco', () => {
    const m = abrir(montar(filtros()));
    const disparo = m.cont.querySelector<HTMLButtonElement>('[data-testid="filtros-plegables"]')!;
    const panel = m.cont.querySelector<HTMLElement>('.rtm-ba-fp-panel')!;
    expect(panel.hidden).toBe(true);
    expect(disparo.getAttribute('aria-expanded')).toBe('false');
    act(() => disparo.click());
    expect(panel.hidden).toBe(false);
    expect(disparo.getAttribute('aria-expanded')).toBe('true');
    act(() => { panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(disparo);
  });
  it('los campos siguen montados al cerrar (el formulario los envia) y el contador muestra lo aplicado', () => {
    const m = abrir(montar(filtros(2)));
    expect(m.cont.querySelector('input[name="desde"]')).not.toBeNull();
    expect(m.cont.querySelector('.rtm-ba-fp-disparo small')?.textContent).toBe('2');
  });
});
