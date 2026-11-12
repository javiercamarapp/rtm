import { describe, it, expect } from 'vitest';
import { compactoEs, escalaBonita } from './escalas';

describe('escalaBonita', () => {
  it('devuelve tres marcas [0, mitad, tope] con topes de la serie 1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10', () => {
    expect(escalaBonita(604).marcas).toEqual([0, 400, 800]);
    expect(escalaBonita(95).tope).toBe(100);
    expect(escalaBonita(0.42).tope).toBeCloseTo(0.5);
    expect(escalaBonita(1_050_000).tope).toBe(1_200_000);
  });
  it('maximo no positivo o no finito: escala 0 a 1', () => {
    for (const v of [0, -5, NaN, Infinity]) expect(escalaBonita(v).marcas).toEqual([0, 0.5, 1]);
  });
  it('el tope nunca queda por debajo del maximo', () => {
    for (const v of [1, 1.1, 2.9, 7, 13, 99, 101, 12345]) expect(escalaBonita(v).tope).toBeGreaterThanOrEqual(v);
  });
});

describe('compactoEs', () => {
  it('abrevia en millones y miles con un decimal', () => {
    expect(compactoEs(2_100_000)).toBe('2.1 M');
    expect(compactoEs(337_900)).toBe('337.9 mil');
    expect(compactoEs(12_000)).toBe('12 mil');
    expect(compactoEs(999)).toBe('999');
  });
  it('negativos con signo menos tipografico y no finito con raya', () => {
    expect(compactoEs(-4_500)).toBe('−4.5 mil');
    expect(compactoEs(NaN)).toBe('—');
  });
});
