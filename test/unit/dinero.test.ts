import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { centavosDesdeTexto, redondearMedioArriba, valorSalida } from '@/dominio/dinero';

// Valores esperados del documento de Angelo (G3/G5), no de la salida del codigo:
// 1,536 piezas, costo puesto 140,615.00 = 14,061,500 centavos.
const V0 = 14_061_500n;
const E0 = 1536;

describe('redondeo medio arriba', () => {
  it('.5 sube, .49 baja, tambien para negativos', () => {
    expect(redondearMedioArriba(1n, 2n)).toBe(1n);
    expect(redondearMedioArriba(1n, 3n)).toBe(0n);
    expect(redondearMedioArriba(5n, 2n)).toBe(3n);
    expect(redondearMedioArriba(-1n, 2n)).toBe(0n); // medio arriba: -0.5 -> 0
    expect(redondearMedioArriba(-3n, 2n)).toBe(-1n); // -1.5 -> -1
    expect(redondearMedioArriba(-4n, 3n)).toBe(-1n); // -1.33 -> -1
  });
  it('rechaza denominador no positivo', () => {
    expect(() => redondearMedioArriba(1n, 0n)).toThrow(RangeError);
    expect(() => redondearMedioArriba(1n, -2n)).toThrow(RangeError);
  });
});

describe('G5 costeo: costo promedio ponderado movil', () => {
  it('salida de 100 piezas = 915,462 centavos; restan 1,436 piezas con 13,146,038', () => {
    const s1 = valorSalida(V0, E0, 100);
    expect(s1).toBe(915_462n);
    expect(V0 - s1).toBe(13_146_038n);
  });
  it('segunda salida de 100 = 13,146,038 x 100 / 1,436 = 915,462.26 -> 915,462', () => {
    expect(valorSalida(13_146_038n, 1436, 100)).toBe(915_462n);
  });
  it('sacar todo en lotes de 100 y 36 deja el inventario en 0.00 exacto (la ultima salida lleva el residuo)', () => {
    let v = V0;
    let e = E0;
    while (e > 36) {
      v -= valorSalida(v, e, 100);
      e -= 100;
    }
    expect(e).toBe(36);
    v -= valorSalida(v, e, 36);
    expect(v).toBe(0n);
  });
  it('1,000 secuencias aleatorias conservan valor inventario = suma de entradas - suma de salidas, y vaciar deja 0', () => {
    const paso = fc.record({ entra: fc.boolean(), piezas: fc.integer({ min: 1, max: 400 }), valor: fc.integer({ min: 100, max: 5_000_000 }) });
    fc.assert(
      fc.property(fc.array(paso, { minLength: 1, maxLength: 30 }), (pasos) => {
        let v = 0n;
        let e = 0;
        let entradas = 0n;
        let salidas = 0n;
        for (const p of pasos) {
          if (p.entra || e === 0) {
            v += BigInt(p.valor);
            entradas += BigInt(p.valor);
            e += p.piezas;
          } else {
            const n = Math.min(p.piezas, e);
            const sale = valorSalida(v, e, n);
            expect(sale >= 0n && sale <= v).toBe(true);
            v -= sale;
            salidas += sale;
            e -= n;
          }
          expect(v).toBe(entradas - salidas);
        }
        if (e > 0) {
          salidas += valorSalida(v, e, e);
        }
        expect(entradas - salidas).toBe(0n);
      }),
      { numRuns: 1000 },
    );
  });
  it('rechaza salidas fuera de existencia', () => {
    expect(() => valorSalida(100n, 5, 6)).toThrow(RangeError);
    expect(() => valorSalida(100n, 5, 0)).toThrow(RangeError);
  });
});

describe('centavos desde texto', () => {
  it('lee pesos con comas y de uno a dos decimales', () => {
    expect(centavosDesdeTexto('138,240.00')).toBe(13_824_000n);
    expect(centavosDesdeTexto('$1,098.5')).toBe(109_850n);
    expect(centavosDesdeTexto('300')).toBe(30_000n);
    expect(centavosDesdeTexto('-260.00')).toBe(-26_000n);
  });
  it('rechaza tres decimales y basura', () => {
    expect(() => centavosDesdeTexto('1.234')).toThrow(RangeError);
    expect(() => centavosDesdeTexto('abc')).toThrow(RangeError);
  });
});
