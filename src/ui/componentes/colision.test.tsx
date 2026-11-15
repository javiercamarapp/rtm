// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { colocarPanel } from './colision';
import { atajosPeriodo } from './periodo';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

const rect = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => ({}) }) as DOMRect;

function panelEn(r: (alin: string | undefined, vert: string | undefined) => DOMRect, ancla = rect(700, 100, 80, 32)) {
  const caja = document.createElement('div');
  const panel = document.createElement('div');
  caja.appendChild(panel);
  document.body.appendChild(caja);
  vi.spyOn(caja, 'getBoundingClientRect').mockReturnValue(ancla);
  Object.defineProperty(panel, 'offsetParent', { value: caja });
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => r(panel.dataset.alin, panel.dataset.vert));
  return panel;
}

describe('colocarPanel', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });

  it('anclado a la izquierda cuando cabe', () => {
    const p = panelEn((a) => (a === 'izq' ? rect(100, 140, 300, 120) : rect(0, 140, 300, 120)), rect(100, 100, 80, 32));
    colocarPanel(p);
    expect(p.dataset.alin).toBe('izq');
    expect(p.dataset.vert).toBe('abajo');
  });
  it('se ancla a la derecha cuando se sale por el borde derecho (caso Periodo de Dropshipping)', () => {
    const p = panelEn((a) => (a === 'izq' ? rect(700, 140, 380, 160) : rect(400, 140, 380, 160)));
    colocarPanel(p);
    expect(p.dataset.alin).toBe('der');
  });
  it('ocupa el ancho util si no cabe en ninguna alineacion', () => {
    const p = panelEn(() => rect(-50, 140, 900, 160));
    colocarPanel(p);
    expect(p.dataset.alin).toBe('ancho');
  });
  it('voltea hacia arriba cuando abajo no cabe y arriba hay mas espacio', () => {
    const p = panelEn(() => rect(100, 520, 300, 200), rect(100, 480, 80, 32));
    colocarPanel(p);
    expect(p.dataset.vert).toBe('arriba');
  });
  it('respeta la alineacion preferida a la derecha cuando cabe', () => {
    const p = panelEn((a) => (a === 'der' ? rect(420, 140, 360, 100) : rect(700, 140, 360, 100)));
    colocarPanel(p, 'der');
    expect(p.dataset.alin).toBe('der');
  });
});

describe('atajosPeriodo', () => {
  it('Hoy, 7 dias, 30 dias y Este mes con fechas locales', () => {
    const a = atajosPeriodo(new Date(2026, 10, 14));
    expect(a.map((x) => [x.id, x.desde, x.hasta])).toEqual([
      ['hoy', '2026-11-14', '2026-11-14'],
      ['7d', '2026-11-08', '2026-11-14'],
      ['30d', '2026-10-16', '2026-11-14'],
      ['mes', '2026-11-01', '2026-11-14'],
    ]);
  });
});
