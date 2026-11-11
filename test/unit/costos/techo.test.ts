import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ceilDiv, ppmExactoTruncado, techoCent, techoPct, techoPctDeFraccion } from '@/dominio/dinero/techo';

describe('techoCent (casos dorados de la spec 17, seccion 8)', () => {
  const casos: Array<[bigint, bigint]> = [
    [1n, 100n],
    [99n, 100n],
    [100n, 100n],
    [101n, 200n],
    [0n, 0n],
    [-1n, 0n],
    [-99n, 0n],
    [-100n, -100n],
    [-150n, -100n],
  ];
  for (const [entrada, esperado] of casos) {
    it(`${entrada} centavos -> ${esperado}`, () => {
      expect(techoCent(entrada, 1n)).toBe(esperado);
    });
  }
  it('rechaza denominador y paso invalidos', () => {
    expect(() => techoCent(1n, 0n)).toThrow(RangeError);
    expect(() => ceilDiv(1n, -1n)).toThrow(RangeError);
    expect(() => techoCent(1n, 1n, 0n)).toThrow(RangeError);
  });
});

describe('techoPct', () => {
  it('176000 ppm (17.6 %) -> 180000; 180000 -> 180000; 160001 -> 170000', () => {
    expect(techoPct(176_000n)).toBe(180_000n);
    expect(techoPct(180_000n)).toBe(180_000n);
    expect(techoPct(160_001n)).toBe(170_000n);
    expect(techoPct(0n)).toBe(0n);
  });
  it('techoPctDeFraccion usa la fraccion exacta: 18 % exacto se queda en 18 %, 18.0000001 % sube a 19 %', () => {
    expect(techoPctDeFraccion(18n, 100n)).toBe(180_000n);
    expect(techoPctDeFraccion(180_000_001n, 1_000_000_000n)).toBe(190_000n);
    expect(techoPctDeFraccion(10n, 60n)).toBe(170_000n); // 16.67 % -> 17 %
    expect(techoPctDeFraccion(0n, 60n)).toBe(0n);
    expect(() => techoPctDeFraccion(-1n, 60n)).toThrow(RangeError);
  });
  it('ppmExactoTruncado trunca solo para mostrar', () => {
    expect(ppmExactoTruncado(10n, 60n)).toBe(166_666n);
    expect(() => ppmExactoTruncado(1n, 0n)).toThrow(RangeError);
  });
});

describe('propiedades del redondeo', () => {
  const num = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
  const den = fc.bigInt({ min: 1n, max: 10n ** 9n });
  const paso = fc.constantFrom(1n, 50n, 100n, 1000n);

  it('resultado >= exacto, diferencia < paso y es multiplo del paso', () => {
    fc.assert(
      fc.property(num, den, paso, (n, d, p) => {
        const r = techoCent(n, d, p);
        expect(r * d >= n).toBe(true); // nunca menor que el exacto
        expect((r - p) * d < n).toBe(true); // se queda a menos de un paso
        expect(r % p).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });

  it('la suma de las partes redondeadas nunca es menor que el total exacto', () => {
    fc.assert(
      fc.property(fc.array(num, { minLength: 1, maxLength: 12 }), den, paso, (partes, d, p) => {
        const redondeadas = partes.reduce((acc, n) => acc + techoCent(n, d, p), 0n);
        const totalExactoNumerador = partes.reduce((acc, n) => acc + n, 0n);
        expect(redondeadas * d >= totalExactoNumerador).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('techoPct: >= ppm, a menos de un punto y multiplo de 10_000', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000n }), (ppm) => {
        const r = techoPct(ppm);
        expect(r >= ppm).toBe(true);
        expect(r - ppm < 10_000n).toBe(true);
        expect(r % 10_000n).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });

  it('techoPctDeFraccion nunca queda por debajo de la fraccion exacta', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 12n }), (a, b) => {
        const n = a > b ? b : a;
        const r = techoPctDeFraccion(n, b);
        expect(r * b >= n * 1_000_000n).toBe(true);
        expect(r - 10_000n < (n * 1_000_000n) / b + 1n).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
