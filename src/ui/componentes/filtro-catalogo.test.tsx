// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { atajosDeMarcas, marcasDeParam } from '@/dominio/catalogo/filtro';

const reemplazo = vi.fn();
let parametros = new URLSearchParams();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: reemplazo }), usePathname: () => '/catalogo', useSearchParams: () => parametros }));
import { FiltroCatalogo } from './filtro-catalogo';

const MARCAS = [{ nombre: 'Waka', cuenta: 30 }, { nombre: 'Geek Bar', cuenta: 2 }, { nombre: 'Nexa', cuenta: 5 }];
const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
const el = () => <FiltroCatalogo etiquetaAria="Filtrar" marcas={MARCAS} atajos={['Waka', 'Nexa']} segmentos={{ parametro: 'estado', etiquetaAria: 'Disponibilidad', opciones: [{ valor: '', etiqueta: 'Todos' }, { valor: 'disponible', etiqueta: 'Disponibles' }] }} />;

beforeEach(() => { reemplazo.mockClear(); parametros = new URLSearchParams(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

describe('filtro compartido', () => {
  it('helpers: marcas de la URL y maximo 5 atajos por demanda', () => {
    expect(marcasDeParam('Waka, Geek Bar,Waka')).toEqual(['Waka', 'Geek Bar']);
    expect(marcasDeParam(undefined)).toEqual([]);
    const pesos = new Map([['A', 9], ['B', 8], ['C', 7], ['D', 6], ['E', 5], ['F', 4], ['Sin marca', 99], ['Z', 0]]);
    expect(atajosDeMarcas(pesos)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('la busqueda es en vivo (con pausa) y escribe en la URL', () => {
    const m = abrir(montar(el(), 'reduced'));
    const i = m.cont.querySelector<HTMLInputElement>('[data-testid="fc-buscar"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(i, 'waka'); i.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(reemplazo).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(reemplazo).toHaveBeenCalledWith('/catalogo?q=waka', { scroll: false });
  });
  it('el segmentado y los atajos cambian la URL; el desplegable abre, filtra marcas y cierra con Escape', () => {
    const m = abrir(montar(el(), 'reduced'));
    const botones = [...m.cont.querySelectorAll('button')];
    act(() => botones.find((b) => b.textContent === 'Disponibles')!.click());
    expect(reemplazo).toHaveBeenLastCalledWith('/catalogo?estado=disponible', { scroll: false });
    act(() => botones.find((b) => b.textContent === 'Nexa')!.click());
    expect(reemplazo).toHaveBeenLastCalledWith('/catalogo?marca=Nexa', { scroll: false });
    const disparo = m.cont.querySelector<HTMLButtonElement>('[data-testid="fc-marcas"]')!;
    expect(disparo.getAttribute('aria-expanded')).toBe('false');
    act(() => disparo.click());
    expect(disparo.getAttribute('aria-expanded')).toBe('true');
    expect(m.cont.querySelectorAll('.rtm-fc-panel input[type="checkbox"]').length).toBe(3);
    act(() => { m.cont.querySelector('.rtm-fc')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(disparo.getAttribute('aria-expanded')).toBe('false');
  });
  it('con marcas en la URL muestra chips solo de las seleccionadas, con opcion de quitar', () => {
    parametros = new URLSearchParams('marca=Waka,Nexa');
    const m = abrir(montar(el(), 'reduced'));
    const chips = [...m.cont.querySelectorAll('.rtm-fc-chips button')];
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['Quitar la marca Waka', 'Quitar la marca Nexa']);
    act(() => (chips[0] as HTMLButtonElement).click());
    expect(reemplazo).toHaveBeenLastCalledWith('/catalogo?marca=Nexa', { scroll: false });
  });
  it('sin violaciones de axe, cerrado, abierto y con seleccion', async () => {
    parametros = new URLSearchParams('marca=Waka');
    const m = abrir(montar(el(), 'reduced'));
    act(() => m.cont.querySelector<HTMLButtonElement>('[data-testid="fc-marcas"]')!.click());
    vi.useRealTimers();
    expect(await auditar(m.cont)).toEqual([]);
  });
});
