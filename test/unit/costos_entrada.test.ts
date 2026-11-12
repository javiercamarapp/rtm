import { describe, expect, it } from 'vitest';
import { microDeTexto, pesosDeExactoE6, ppmDeTexto, textoMicro, textoPct } from '@/dominio/costos/entrada';

describe('lectura y presentacion de costos', () => {
  it('lee montos en millonesimas sin flotantes', () => {
    expect(microDeTexto('75')).toBe(75_000_000n);
    expect(microDeTexto('1,234.123456')).toBe(1_234_123_456n);
    expect(microDeTexto('0.5')).toBe(500_000n);
    expect(microDeTexto('-1')).toBeNull();
    expect(microDeTexto('1.1234567')).toBeNull();
    expect(microDeTexto('abc')).toBeNull();
  });
  it('lee porcentajes en ppm', () => {
    expect(ppmDeTexto('17')).toBe(170_000n);
    expect(ppmDeTexto('16.6666')).toBe(166_666n);
    expect(ppmDeTexto('100')).toBe(1_000_000n);
    expect(ppmDeTexto('101')).toBeNull();
  });
  it('muestra el exacto con sus decimales y el redondeado aparte', () => {
    expect(pesosDeExactoE6(23_587_500_000n)).toBe('235.875');
    expect(pesosDeExactoE6(23_600_000_000n)).toBe('236.00');
    expect(textoMicro(75_000_000n)).toBe('75.00');
    expect(textoMicro(1_234_567n)).toBe('1.234567');
    expect(textoPct(166_666n)).toBe('16.67');
  });
});
