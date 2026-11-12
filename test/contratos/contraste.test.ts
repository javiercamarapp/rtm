import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// WCAG 2.x medido sobre tokens.css: texto 4.5:1, marcas de datos y bordes de controles 3:1. Los bordes de tarjetas y separadores son decorativos
// (la informacion no depende de ellos) y no se miden. d-ocre y d-gris nunca van como texto (solo relleno o filete).
const css = readFileSync(join(__dirname, '../../src/ui/estilos/tokens.css'), 'utf8');
const bloque = (sel: string) => { const i = css.indexOf(sel); return css.slice(i, css.indexOf('}', i)); };
const leer = (b: string) => Object.fromEntries([...b.matchAll(/--rtm-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1]!, m[2]!]));
const claro = leer(bloque(':root {'));
const oscuro = { ...claro, ...leer(bloque(":root[data-tema='oscuro'] {")) };
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const cr = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const TEMAS = { claro, oscuro } as const;

describe('contraste de tokens', () => {
  it('el borde de control apunta a line-strong', () => {
    expect(css).toMatch(/--rtm-borde-control:\s*var\(--rtm-line-strong\)/);
  });
  for (const [nombre, t] of Object.entries(TEMAS)) {
    for (const fondo of ['panel', 'surface'] as const) {
      it(`${nombre}: texto (tinta, ok, warn, bad, azul marino, lila) >= 4.5 sobre ${fondo}`, () => {
        for (const k of ['ink', 'ink-2', 'ink-3', 'ok', 'warn', 'bad', 'd-azul-marino', 'd-lila']) expect(cr(t[k]!, t[fondo]!), k).toBeGreaterThanOrEqual(4.5);
      });
      it(`${nombre}: marcas de datos (--rtm-d-*) y borde de control >= 3 sobre ${fondo}`, () => {
        for (const k of Object.keys(t).filter((x) => x.startsWith('d-'))) expect(cr(t[k]!, t[fondo]!), k).toBeGreaterThanOrEqual(3);
        expect(cr(t['line-strong']!, t[fondo]!)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
