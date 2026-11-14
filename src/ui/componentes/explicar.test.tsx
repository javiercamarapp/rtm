// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import { auditar, montar, teclear, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { CifraComprobada } from './cifra';
import { ExplicarProvider } from './explicar';

const montajes: Montaje[] = [];
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); document.body.style.overflow = ''; });

const r = (concepto: string, montoCent: number) => ({ concepto, montoCent: BigInt(montoCent), saldoCent: null, hora: null, fechaNeg: null, evento: null, canal: null, autor: null, mensajeOrigen: null });
const mov = (n: number, saldo: number) => ({ hora: `2026-11-${10 + n}T10:00:00Z`, fechaNeg: `2026-11-${10 + n}`, tipo: 'entrada_compra', sabor: 'Menta', ubicacion: 'Bodega', cantidad: 5, saldo, valorCent: 0n, evento: `E-${n}`, canal: 'web', mensajeOrigen: null, autor: 'Ana' });
const utilidad: Explicacion = {
  cifra: 'cascada:utilidad:2026-11-01:2026-11-30', titulo: 'Utilidad neta del periodo', unidad: 'mxn', valor: 300000,
  comprobacion: { via1: 'Funcion', via1Valor: 300000, via2: 'Suma', via2Valor: 300000, cuadra: true, diferencia: 0 },
  movimientos: [], precioCent: null, costos: [], renglones: [r('Pedidos enviados', 500000), r('Gastos generales', -200000)], corte: { fecha: '2026-11-14', hora: '2026-11-14T18:00:00Z' },
};
const existencia: Explicacion = { ...utilidad, cifra: 'existencia:modelo:3', titulo: 'Existencia', unidad: 'pz', valor: 55, renglones: [], movimientos: Array.from({ length: 11 }, (_, i) => mov(i + 1, (i + 1) * 5)), comprobacion: { via1: 'a', via1Valor: 55, via2: 'b', via2Valor: 50, cuadra: false } };

function abrir(datos: Explicacion, modo: 'socio' | 'omar' = 'socio') {
  const m = montar(<ExplicarProvider explicar={() => Promise.resolve(datos)} modo={modo}><CifraComprobada texto="$3,000.00" cifra={datos.cifra} /></ExplicarProvider>, 'off');
  montajes.push(m);
  const boton = m.cont.querySelector<HTMLButtonElement>('button.rtm-cifra')!;
  boton.focus();
  return { m, boton };
}
async function clicAbrir(boton: HTMLElement) { await act(async () => { boton.click(); await Promise.resolve(); await Promise.resolve(); }); }
const panel = () => document.querySelector<HTMLElement>('[data-testid="explicar-cajon"]');

describe('ExplicarProvider (panel premium)', () => {
  it('abre como dialogo modal con la cifra, el estado y las secciones con datos', async () => {
    const { boton } = abrir(utilidad);
    await clicAbrir(boton);
    const p = panel()!;
    expect(p.getAttribute('role')).toBe('dialog');
    expect(p.getAttribute('aria-modal')).toBe('true');
    expect(p.querySelector('[data-testid="explicar-cifra"]')!.textContent).toBe('$3,000.00');
    expect(p.querySelector('[data-testid="explicar-estado"]')!.textContent).toBe('Cuadra');
    const titulos = [...p.querySelectorAll('.xp-seccion-t')].map((e) => e.textContent);
    expect(titulos.some((t) => t!.includes('Definición y fórmula'))).toBe(true);
    expect(titulos.some((t) => t!.includes('Comprobación por dos vías'))).toBe(true);
    expect(titulos.some((t) => t!.includes('Detalle de movimientos'))).toBe(false); // sin movimientos no hay seccion vacia
    expect(p.querySelector('[data-testid="explicar-formula"]')).not.toBeNull();
  });
  it('Escape cierra y devuelve el foco a la cifra; clic fuera tambien', async () => {
    const { boton } = abrir(utilidad);
    await clicAbrir(boton);
    teclear(window as unknown as Element, 'Escape');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(boton);
    await clicAbrir(boton);
    act(() => document.querySelector<HTMLButtonElement>('.xp-velo')!.click());
    expect(panel()).toBeNull();
  });
  it('atrapa el foco con Tab desde el ultimo elemento', async () => {
    const { boton } = abrir(utilidad);
    await clicAbrir(boton);
    const p = panel()!;
    const lista = [...p.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter((e) => !e.closest('[hidden]'));
    lista[lista.length - 1]!.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.activeElement!.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lista[0]);
  });
  it('secciones colapsables con aria-expanded y el indice las abre', async () => {
    const { boton } = abrir(utilidad);
    await clicAbrir(boton);
    const gl = document.querySelector<HTMLButtonElement>('#xp-glosario-t button')!;
    expect(gl.getAttribute('aria-expanded')).toBe('false');
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.xp-chip')].find((c) => c.textContent === 'Glosario')!.click());
    expect(gl.getAttribute('aria-expanded')).toBe('true');
    act(() => gl.click());
    expect(gl.getAttribute('aria-expanded')).toBe('false');
  });
  it('detalle: ordena, pagina y exporta CSV; cifra que no cuadra lo dice', async () => {
    const { boton } = abrir(existencia);
    await clicAbrir(boton);
    const p = panel()!;
    expect(p.querySelector('[data-testid="explicar-estado"]')!.textContent).toBe('No cuadra');
    expect(p.querySelectorAll('.xp-tabla-detalle [role="row"]')).toHaveLength(11); // cabecera + 10
    expect(p.textContent).toContain('página 1 de 2');
    act(() => [...p.querySelectorAll<HTMLButtonElement>('.xp-paginas button')].find((b) => b.textContent === 'Siguiente')!.click());
    expect(p.querySelectorAll('.xp-tabla-detalle [role="row"]')).toHaveLength(2);
    const orden = p.querySelector<HTMLButtonElement>('.xp-orden')!;
    act(() => orden.click());
    expect(orden.closest('[role="columnheader"]')!.getAttribute('aria-sort')).toBe('ascending');
    const crear = vi.fn(() => 'blob:x');
    const revocar = vi.fn();
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: revocar });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    act(() => [...p.querySelectorAll<HTMLButtonElement>('.xp-barra-tabla button')][0]!.click());
    expect(crear).toHaveBeenCalledOnce();
    expect(clic).toHaveBeenCalledOnce();
    clic.mockRestore();
  });
  it('error con reintento', async () => {
    const m = montar(<ExplicarProvider explicar={() => Promise.reject(new Error('x'))}><CifraComprobada texto="$1.00" cifra="a:b" /></ExplicarProvider>, 'off');
    montajes.push(m);
    await clicAbrir(m.cont.querySelector<HTMLButtonElement>('button.rtm-cifra')!);
    expect(panel()!.querySelector('[role="alert"]')!.textContent).toContain('No se pudo explicar');
    expect(panel()!.querySelector('.xp-estado button')!.textContent).toBe('Reintentar');
  });
  it('modo Omar: sin cuentas del libro ni enlaces a paginas de socios', async () => {
    const { boton } = abrir({ ...utilidad, cifra: 'omar:saldo' }, 'omar');
    await clicAbrir(boton);
    expect(panel()!.querySelector('#xp-cuentas')).toBeNull();
    expect(panel()!.querySelector('a[href]')).toBeNull();
  });
  it('sin violaciones de accesibilidad (axe) con la composicion y con el detalle', async () => {
    for (const d of [utilidad, existencia]) {
      const { boton } = abrir(d);
      await clicAbrir(boton);
      expect(await auditar(panel()!)).toEqual([]);
      teclear(window as unknown as Element, 'Escape');
    }
  });
});
