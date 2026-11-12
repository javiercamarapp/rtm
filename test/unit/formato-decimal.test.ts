import { describe, expect, it } from 'vitest';
import { formatearDecimal } from '@/dominio/formato';

describe('formatearDecimal', () => {
  it('agrupa miles y fija decimales', () => {
    expect(formatearDecimal(1234.5, 1)).toBe('1,234.5');
    expect(formatearDecimal(0.333, 2)).toBe('0.33');
    expect(formatearDecimal(12, 0)).toBe('12');
  });
  it('usa el signo real y no deja -0', () => {
    expect(formatearDecimal(-3.25, 1)).toBe('−3.3');
    expect(formatearDecimal(-0.001, 1)).toBe('0.0');
  });
  it('rechaza no finitos', () => {
    expect(() => formatearDecimal(Number.NaN, 1)).toThrow();
  });
});
