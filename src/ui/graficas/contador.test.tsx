// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { act } from 'react';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { leerModoMovimiento } from '../movimiento/cliente';
import { CLAVE_MOVIMIENTO, aplicarModoMovimiento, esModo, indiceEscalonado, modoInicial } from '../movimiento';
import { Contador } from './contador';
import { textoCifra, palabraSentido } from './formato';
import { auditar, cuadrosManuales, fijarModo, montar, type Montaje } from './pruebas/ayudas';

const montajes: Montaje[] = [];
afterEach(() => {
  while (montajes.length) montajes.pop()!.desmontar();
  fijarModo(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const visible = (m: Montaje): string => m.cont.querySelector('[aria-hidden="true"]')!.textContent ?? '';
const paraLectores = (m: Montaje): string => m.cont.querySelector('.rtm-solo-lectores')!.textContent ?? '';

describe('Contador (A05)', () => {
  it('modo completo: sube de 0 al valor, a mitad de camino muestra un valor intermedio y termina en el valor exacto', () => {
    const cuadros = cuadrosManuales();
    const m = montar(<Contador valor={152400} tipo="moneda" />, 'full');
    montajes.push(m);
    expect(visible(m)).toBe('$0.00');
    expect(paraLectores(m)).toBe('$1,524.00');
    cuadros.avanzar(0);
    cuadros.avanzar(300);
    const mitad = visible(m);
    expect(mitad).not.toBe('$0.00');
    expect(mitad).not.toBe('$1,524.00');
    cuadros.avanzar(700);
    expect(visible(m)).toBe('$1,524.00');
    expect(paraLectores(m)).toBe('$1,524.00');
    cuadros.avanzar(900);
    expect(cuadros.raf.mock.calls.length).toBeGreaterThan(1);
  });

  it('movimiento reducido y apagado: valor final de inmediato y ni un solo cuadro de animacion', () => {
    for (const modo of ['reduced', 'off'] as const) {
      const cuadros = cuadrosManuales();
      const m = montar(<Contador valor={1524} tipo="piezas" />, modo);
      montajes.push(m);
      expect(visible(m)).toBe('1,524 pz');
      expect(paraLectores(m)).toBe('1,524 pz');
      expect(cuadros.raf).not.toHaveBeenCalled();
      m.desmontar();
      montajes.pop();
    }
  });

  it('el estado final del modo completo es el mismo que el del modo reducido', () => {
    const cuadros = cuadrosManuales();
    const a = montar(<Contador valor={87} tipo="porcentaje" decimales={1} />, 'full');
    montajes.push(a);
    cuadros.avanzar(0);
    cuadros.avanzar(5000);
    const b = montar(<Contador valor={87} tipo="porcentaje" decimales={1} />, 'reduced');
    montajes.push(b);
    expect(visible(a)).toBe(visible(b));
    expect(a.cont.textContent).toBe(b.cont.textContent);
  });

  it('si el valor cambia anima desde el anterior; si se desmonta a mitad cancela el cuadro pendiente', () => {
    const cuadros = cuadrosManuales();
    const m = montar(<Contador valor={100} tipo="entero" />, 'full');
    montajes.push(m);
    cuadros.avanzar(0);
    cuadros.avanzar(5000);
    expect(visible(m)).toBe('100');
    act(() => {
      m.desmontar();
    });
    montajes.pop();
    expect(cuadros.cancelar).toHaveBeenCalled();
  });

  it('mismo valor al re-renderizar no reinicia la animacion', () => {
    const cuadros = cuadrosManuales();
    const m = montar(<Contador valor={0} tipo="entero" />, 'full');
    montajes.push(m);
    expect(visible(m)).toBe('0');
    expect(cuadros.raf).not.toHaveBeenCalled();
  });

  it('axe sin violaciones', async () => {
    const m = montar(<Contador valor={42} tipo="dias" decimales={1} className="x" />, 'reduced');
    montajes.push(m);
    expect(await auditar(m.cont)).toEqual([]);
    expect(m.cont.firstElementChild!.getAttribute('class')).toContain('x');
  });
});

describe('textoCifra', () => {
  it('moneda y piezas coinciden con el formato oficial (propiedad)', () => {
    fc.assert(fc.property(fc.integer({ min: -9_000_000_000, max: 9_000_000_000 }), (n) => textoCifra(n, 'moneda') === formatearMoneda(BigInt(n)) && textoCifra(n, 'piezas') === formatearPiezas(n)));
  });
  it('entero, porcentaje y dias usan el signo real y agrupan miles', () => {
    expect(textoCifra(-1234567, 'entero')).toBe('−1,234,567');
    expect(textoCifra(1234.5, 'porcentaje', 1)).toBe('1,234.5 %');
    expect(textoCifra(-12.25, 'porcentaje', 1)).toBe('−12.3 %');
    expect(textoCifra(-0.04, 'porcentaje', 1)).toBe('0.0 %');
    expect(textoCifra(33, 'dias')).toBe('33 d');
    expect(textoCifra(12, 'entero')).toBe('12');
  });
  it('rechaza valores no finitos', () => {
    expect(() => textoCifra(Number.NaN, 'entero')).toThrow(RangeError);
    expect(() => textoCifra(Infinity, 'moneda')).toThrow(RangeError);
  });
  it('palabras de sentido', () => {
    expect(palabraSentido('sube')).toBe('Sube');
    expect(palabraSentido('baja')).toBe('Baja');
    expect(palabraSentido('igual')).toBe('Sin cambio');
  });
});

describe('leerModoMovimiento', () => {
  it('atributo valido manda; invalido o ausente cae a la preferencia del sistema', () => {
    fijarModo('off');
    expect(leerModoMovimiento()).toBe('off');
    document.documentElement.dataset.movimiento = 'otro';
    expect(leerModoMovimiento()).toBe('full');
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(leerModoMovimiento()).toBe('reduced');
    fijarModo('full');
    expect(leerModoMovimiento()).toBe('full');
  });
  it('un cambio de la preferencia del sistema vuelve a leer el modo', () => {
    let aviso: (() => void) | null = null;
    let reducir = false;
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return reducir;
      },
      addEventListener: (_: string, cb: () => void) => {
        aviso = cb;
      },
      removeEventListener: () => {
        aviso = null;
      },
    }));
    const m = montar(<Contador valor={5} />, null);
    montajes.push(m);
    reducir = true;
    act(() => aviso?.());
    expect(m.cont.textContent).toBe('55');
    m.desmontar();
    montajes.pop();
    expect(aviso).toBeNull();
  });
});

describe('axe detecta de verdad', () => {
  it('una imagen sin texto alternativo SI es violacion (la auditoria no esta vacia)', async () => {
    const m = montar(<img src="x.png" />, null);
    montajes.push(m);
    const v = await auditar(m.cont);
    expect(v.map((x) => x.id)).toContain('image-alt');
  });
});

describe('modulo unico de movimiento (F0) que usan las graficas', () => {
  it('aplicarModoMovimiento fija el atributo de <html> que leen el CSS y los componentes, y lo guarda', () => {
    aplicarModoMovimiento('reduced');
    expect(document.documentElement.dataset.movimiento).toBe('reduced');
    expect(leerModoMovimiento()).toBe('reduced');
    expect(localStorage.getItem(CLAVE_MOVIMIENTO)).toBe('reduced');
  });
  it('sin almacenamiento el modo vale para la visita', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => aplicarModoMovimiento('off')).not.toThrow();
    expect(document.documentElement.dataset.movimiento).toBe('off');
  });
  it('modo inicial, validacion y escalonado maximo de 6', () => {
    expect(modoInicial('off', false)).toBe('off');
    expect(modoInicial(null, true)).toBe('reduced');
    expect(modoInicial('x', false)).toBe('full');
    expect(esModo('full')).toBe(true);
    expect(esModo(3)).toBe(false);
    expect(indiceEscalonado(-3)).toBe(0);
    expect(indiceEscalonado(99)).toBe(6);
  });
});
