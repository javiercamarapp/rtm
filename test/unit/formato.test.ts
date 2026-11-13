import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { etiquetaDia, etiquetaRango, formatearMoneda, formatearPiezas, MENOS } from '@/dominio/formato';

describe('formato (modulo unico)', () => {
  it('moneda $1,234.50 con signo real U+2212', () => {
    expect(formatearMoneda(123_450n)).toBe('$1,234.50');
    expect(formatearMoneda(1_359_000n)).toBe('$13,590.00');
    expect(formatearMoneda(-26_000n)).toBe(`${MENOS}$260.00`);
    expect(formatearMoneda(-26_000n).charCodeAt(0)).toBe(0x2212);
    expect(formatearMoneda(5n)).toBe('$0.05');
    expect(formatearMoneda(25_600n, { conSigno: true })).toBe('+$256.00');
  });
  it('piezas 1,524 pz', () => {
    expect(formatearPiezas(1524)).toBe('1,524 pz');
    expect(formatearPiezas(62)).toBe('62 pz');
    expect(formatearPiezas(-12)).toBe(`${MENOS}12 pz`);
    expect(() => formatearPiezas(1.5)).toThrow(RangeError);
  });
  it('etiquetas de semana y dia', () => {
    expect(etiquetaRango('2026-11-09', '2026-11-15')).toBe('9 a 15 nov');
    expect(etiquetaRango('2026-10-26', '2026-11-01')).toBe('26 oct a 1 nov');
    expect(etiquetaDia('2026-11-10', 1)).toBe('martes 10 nov');
  });
  it('ninguna pantalla vuelve a anteponer "$" a una cifra ya formateada (daba "$-100.00" en lugar de "−$100.00")', () => {
    const recorrer = (d: string): string[] => readdirSync(d).flatMap((n) => { const r = join(d, n); return statSync(r).isDirectory() ? recorrer(r) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [r] : []; });
    const patron = /`\$\$\{formatear(Moneda|PesosCorto)\([^`]*\)\.replace\('\$',/;
    const culpables = recorrer('src').filter((f) => patron.test(readFileSync(f, 'utf8')));
    expect(culpables).toEqual([]);
  });
});
