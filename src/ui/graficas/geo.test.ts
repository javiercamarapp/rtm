import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ErrorGrafica, seguro, exigirFinitos, exigirNoNegativos, r2, acotar, escala, extremos, rutaPoligonal, rutaEscalon, rutaBanda,
  calcularCascada, calcularPareto, elementosHasta, calcularTreemap, nivelCalor, NIVELES_CALOR, puntoRadar, radioBurbuja, apilar,
  easeOutCubic, interpolar, sentidoDelta, siguienteIndice, partirEtiqueta, claseEscalonado, muestraSuficiente,
} from './geo';

const entero = fc.integer({ min: -1_000_000, max: 1_000_000 });
const positivo = fc.integer({ min: 0, max: 5_000_000 });

describe('errores tipados y utilidades', () => {
  it('seguro devuelve el error tipado y deja pasar lo que no es de grafica', () => {
    const r = seguro(() => extremos([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('datos_vacios');
    expect(seguro(() => 7)).toEqual({ ok: true, valor: 7 });
    expect(() => seguro(() => { throw new TypeError('x'); })).toThrow(TypeError);
  });
  it('rechaza no finitos y negativos con ErrorGrafica', () => {
    expect(() => exigirFinitos([1, Number.NaN], 'a')).toThrow(ErrorGrafica);
    expect(() => exigirFinitos([Infinity], 'a')).toThrow(/finito/);
    expect(() => exigirNoNegativos([1, -1], 'a')).toThrow(/negativos/);
    expect(() => exigirNoNegativos([0, 1], 'a')).not.toThrow();
  });
  it('r2 y acotar', () => {
    expect(r2(1.23456)).toBe(1.23);
    expect(acotar(5, 0, 3)).toBe(3);
    expect(acotar(-5, 0, 3)).toBe(0);
    fc.assert(fc.property(entero, entero, entero, (n, a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const v = acotar(n, lo, hi);
      return v >= lo && v <= hi;
    }));
  });
  it('escala es monotona y respeta los extremos; dominio degenerado = punto medio', () => {
    fc.assert(fc.property(entero, fc.integer({ min: 1, max: 1000 }), entero, (d0, ancho, v) => {
      const e = escala(d0, d0 + ancho, 0, 100);
      return e(d0) === 0 && e(d0 + ancho) === 100 && e(v) <= e(v + 1);
    }));
    expect(escala(5, 5, 10, 30)(99)).toBe(20);
  });
  it('extremos', () => {
    fc.assert(fc.property(fc.array(entero, { minLength: 1 }), (xs) => {
      const { min, max } = extremos(xs);
      return min === Math.min(...xs) && max === Math.max(...xs);
    }));
  });
  it('rutas', () => {
    expect(rutaPoligonal([[0, 0], [1, 2]])).toBe('M 0 0 L 1 2');
    expect(rutaEscalon([[0, 0], [10, 5]])).toBe('M 0 0 H 10 V 5');
    expect(rutaBanda([[0, 1], [2, 1]], [[0, 5], [2, 5]])).toBe('M 0 1 L 2 1 L 2 5 L 0 5 Z');
  });
});

describe('cascada', () => {
  it('cada escalon arranca donde termino el anterior y el total cuadra con la suma (propiedad)', () => {
    fc.assert(fc.property(entero, fc.array(entero, { minLength: 1, maxLength: 12 }), (inicio, deltas) => {
      const pasos = [
        { id: 'i', etiqueta: 'i', valor: inicio, tipo: 'inicio' as const },
        ...deltas.map((d, k) => ({ id: `d${k}`, etiqueta: 'd', valor: d, tipo: 'delta' as const })),
      ];
      const suma = inicio + deltas.reduce((s, d) => s + d, 0);
      const barras = calcularCascada([...pasos, { id: 't', etiqueta: 't', valor: suma, tipo: 'total' }]);
      for (let k = 1; k <= deltas.length; k += 1) {
        const prev = barras[k - 1]!;
        const act = barras[k]!;
        if (act.desde !== prev.acumulado) return false;
        if (act.hasta - act.desde !== deltas[k - 1]) return false;
      }
      const t = barras[barras.length - 1]!;
      return t.cuadra && t.acumulado === suma;
    }));
  });
  it('marca el total que no cuadra y el signo de cada escalon', () => {
    const b = calcularCascada([
      { id: 'a', etiqueta: 'a', valor: 100, tipo: 'inicio' },
      { id: 'b', etiqueta: 'b', valor: -30, tipo: 'delta' },
      { id: 'c', etiqueta: 'c', valor: 10, tipo: 'delta' },
      { id: 'd', etiqueta: 'd', valor: 99, tipo: 'total' },
    ]);
    expect(b.map((x) => x.signo)).toEqual(['total', 'menos', 'mas', 'total']);
    expect(b[3]!.cuadra).toBe(false);
  });
  it('sin pasos o con NaN: error tipado', () => {
    expect(() => calcularCascada([])).toThrow(ErrorGrafica);
    expect(() => calcularCascada([{ id: 'a', etiqueta: 'a', valor: Number.NaN, tipo: 'inicio' }])).toThrow(/finito/);
  });
});

describe('pareto', () => {
  it('ordena descendente, el acumulado es no decreciente y termina en 100 % (propiedad)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 30 }), (vs) => {
      const filas = calcularPareto(vs.map((v, k) => ({ id: String(k), etiqueta: String(k), valor: v })));
      for (let k = 1; k < filas.length; k += 1) {
        if (filas[k]!.valor > filas[k - 1]!.valor) return false;
        if (filas[k]!.acumulada < filas[k - 1]!.acumulada) return false;
      }
      const suma = filas.reduce((s, f) => s + f.fraccion, 0);
      return Math.abs(filas[filas.length - 1]!.acumulada - 1) < 1e-9 && Math.abs(suma - 1) < 1e-9;
    }));
  });
  it('total cero no divide y elementosHasta cuenta bien', () => {
    const z = calcularPareto([{ id: 'a', etiqueta: 'a', valor: 0 }]);
    expect(z[0]!.acumulada).toBe(0);
    const f = calcularPareto([{ id: 'a', etiqueta: 'a', valor: 60 }, { id: 'b', etiqueta: 'b', valor: 30 }, { id: 'c', etiqueta: 'c', valor: 10 }]);
    expect(elementosHasta(f, 0.5)).toBe(1);
    expect(elementosHasta(f, 0.9)).toBe(2);
    expect(elementosHasta(f, 1)).toBe(3);
    expect(elementosHasta(z, 0.8)).toBe(1);
    expect(() => calcularPareto([])).toThrow(ErrorGrafica);
    expect(() => calcularPareto([{ id: 'a', etiqueta: 'a', valor: -1 }])).toThrow(ErrorGrafica);
  });
});

describe('treemap', () => {
  it('la suma de areas es el area total, nada se sale del marco y cada area es proporcional (propiedad)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 25 }), fc.integer({ min: 100, max: 900 }), fc.integer({ min: 100, max: 500 }), (vs, w, h) => {
      const nodos = calcularTreemap(vs.map((v, k) => ({ id: String(k), valor: v })), w, h);
      const total = vs.reduce((s, v) => s + v, 0);
      let area = 0;
      for (const n of nodos) {
        area += n.ancho * n.alto;
        if (n.x < -1e-6 || n.y < -1e-6 || n.x + n.ancho > w + 1e-6 || n.y + n.alto > h + 1e-6) return false;
        if (Math.abs(n.ancho * n.alto - (n.valor / total) * w * h) > 1e-6 * w * h) return false;
      }
      return nodos.length === vs.length && Math.abs(area - w * h) < 1e-6 * w * h;
    }));
  });
  it('descarta ceros y falla sin datos positivos', () => {
    expect(calcularTreemap([{ id: 'a', valor: 0 }, { id: 'b', valor: 5 }], 100, 100)).toHaveLength(1);
    expect(() => calcularTreemap([{ id: 'a', valor: 0 }], 10, 10)).toThrow(/positivo/);
    expect(() => calcularTreemap([], 10, 10)).toThrow(ErrorGrafica);
    expect(() => calcularTreemap([{ id: 'a', valor: -1 }], 10, 10)).toThrow(ErrorGrafica);
  });
});

describe('mapa de calor, radar, burbujas, apiladas', () => {
  it('nivelCalor siempre cae en 0 a 4 y es monotono (propiedad)', () => {
    fc.assert(fc.property(entero, fc.integer({ min: 0, max: 1000 }), entero, (min, ancho, v) => {
      const n = nivelCalor(v, min, min + ancho);
      return n >= 0 && n < NIVELES_CALOR && nivelCalor(v + 1, min, min + ancho) >= n;
    }));
    expect(nivelCalor(3, 3, 3)).toBe(2);
    expect(nivelCalor(0, 0, 10)).toBe(0);
    expect(nivelCalor(10, 0, 10)).toBe(4);
  });
  it('puntoRadar: el primer eje apunta arriba y todos estan a la misma distancia', () => {
    const [x0, y0] = puntoRadar(0, 8, 100, 200, 200);
    expect(Math.round(x0)).toBe(200);
    expect(Math.round(y0)).toBe(100);
    for (let i = 0; i < 8; i += 1) {
      const [x, y] = puntoRadar(i, 8, 100, 0, 0);
      expect(Math.hypot(x, y)).toBeCloseTo(100, 6);
    }
  });
  it('radioBurbuja: el area es proporcional al tamano', () => {
    expect(radioBurbuja(0, 100, 4, 24)).toBe(4);
    expect(radioBurbuja(100, 100, 4, 24)).toBe(24);
    expect(radioBurbuja(5, 0, 4, 24)).toBe(4);
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (a, b) => {
      const max = 1000;
      return a <= b ? radioBurbuja(a, max, 3, 20) <= radioBurbuja(b, max, 3, 20) : true;
    }));
  });
  it('apilar: tramos consecutivos que suman la proporcion del total', () => {
    fc.assert(fc.property(fc.array(positivo, { minLength: 1, maxLength: 6 }), (vs) => {
      const total = vs.reduce((s, v) => s + v, 0);
      const t = apilar(vs, Math.max(total, 1), 300);
      for (let k = 1; k < t.length; k += 1) if (Math.abs(t[k]!.desde - (t[k - 1]!.desde + t[k - 1]!.ancho)) > 1e-9) return false;
      const fin = t.length ? t[t.length - 1]!.desde + t[t.length - 1]!.ancho : 0;
      return Math.abs(fin - (total / Math.max(total, 1)) * 300) < 1e-6;
    }));
    expect(apilar([5], 0, 100)[0]!.ancho).toBe(0);
    expect(() => apilar([-1], 10, 100)).toThrow(ErrorGrafica);
  });
});

describe('animacion, delta, teclado, texto', () => {
  it('easeOutCubic e interpolar: extremos exactos y monotonia', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(5)).toBe(1);
    expect(interpolar(10, 20, 0)).toBe(10);
    expect(interpolar(10, 20, 1)).toBe(20);
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => (a <= b ? easeOutCubic(a) <= easeOutCubic(b) + 1e-12 : true)));
  });
  it('sentidoDelta', () => {
    expect(sentidoDelta(1, 2)).toBe('sube');
    expect(sentidoDelta(2, 1)).toBe('baja');
    expect(sentidoDelta(2, 2)).toBe('igual');
  });
  it('siguienteIndice nunca sale del rango (propiedad)', () => {
    const teclas = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    fc.assert(fc.property(fc.integer({ min: 1, max: 50 }), fc.nat(60), fc.constantFrom(...teclas), fc.integer({ min: 1, max: 8 }), (n, a, t, c) => {
      const s = siguienteIndice(Math.min(a, n - 1), n, t, c);
      return s !== null && s >= 0 && s < n;
    }));
    expect(siguienteIndice(0, 5, 'a')).toBeNull();
    expect(siguienteIndice(0, 0, 'Home')).toBeNull();
    expect(siguienteIndice(2, 10, 'ArrowDown', 4)).toBe(6);
    expect(siguienteIndice(2, 10, 'ArrowUp', 4)).toBe(0);
  });
  it('partirEtiqueta respeta el maximo de lineas y de caracteres', () => {
    expect(partirEtiqueta('Utilidad bruta del mes', 10, 2)).toEqual(['Utilidad', 'bruta del…']);
    expect(partirEtiqueta('Extraordinariamente', 8)).toEqual(['Extraor…']);
    expect(partirEtiqueta('', 8)).toEqual([]);
    fc.assert(fc.property(fc.string({ maxLength: 60 }), fc.integer({ min: 4, max: 20 }), (s, max) => {
      const l = partirEtiqueta(s, max, 2);
      return l.length <= 2 && l.every((x) => x.length <= max);
    }));
  });
  it('escalonado y muestra minima', () => {
    expect(claseEscalonado(2)).toBe('rtm-i-2');
    expect(claseEscalonado(40)).toBe('rtm-i-6');
    expect(muestraSuficiente(4, 4)).toBe(true);
    expect(muestraSuficiente(3, 4)).toBe(false);
  });
});
