import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guarda de contraste de los tokens (WCAG 2.2): borde de campos >= 3:1 (1.4.11) y texto secundario >= 4.5:1 (1.4.3),
// contra TODAS las superficies donde puede caer un campo, en claro y en oscuro.
const css = readFileSync(join(__dirname, '../../src/ui/estilos/tokens.css'), 'utf8');
const componentes = readFileSync(join(__dirname, '../../src/ui/estilos/componentes.css'), 'utf8');
const bloque = (selector: string) => {
  const i = css.indexOf(selector);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};
const temas = { claro: bloque(':root {'), oscuro: bloque(":root[data-tema='oscuro'] {") } as const;

const valor = (tema: keyof typeof temas, token: string): string => {
  const m = new RegExp(`--rtm-${token}:\\s*(#[0-9a-fA-F]{6});`).exec(temas[tema]);
  expect(m, `${tema} --rtm-${token}`).not.toBeNull();
  return m![1]!;
};

function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SUPERFICIES = ['surface', 'panel', 'tint', 'chrome'];

describe('contraste de tokens', () => {
  for (const tema of ['claro', 'oscuro'] as const) {
    for (const s of SUPERFICIES) {
      it(`${tema}: borde de campo >= 3:1 sobre ${s}`, () => {
        expect(contraste(valor(tema, 'campo-borde'), valor(tema, s))).toBeGreaterThanOrEqual(3);
      });
      it(`${tema}: texto secundario (ink-3, placeholder) >= 4.5:1 sobre ${s}`, () => {
        expect(contraste(valor(tema, 'ink-3'), valor(tema, s))).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${tema}: estados ok, atencion y malo >= 4.5:1 sobre el panel`, () => {
      for (const t of ['ok', 'warn', 'bad']) expect(contraste(valor(tema, t), valor(tema, 'panel')), t).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('el borde viejo de campo (line-2) ya no sirve: no llega a 3:1 y los campos no lo usan', () => {
    expect(contraste(valor('claro', 'line-2'), valor('claro', 'surface'))).toBeLessThan(3);
    const regla = /\.rtm-campo \{[^}]*\}/.exec(componentes)![0];
    expect(regla).toContain('var(--rtm-campo-borde)');
    expect(regla).not.toContain('line-2');
  });
  it('placeholder con color de token y foco visible en campos', () => {
    expect(componentes).toMatch(/\.rtm-campo::placeholder \{ color: var\(--rtm-ink-3\); opacity: 1; \}/);
    expect(componentes).toMatch(/\.rtm-campo:focus-visible \{[^}]*outline: 2px solid var\(--rtm-ink\)/);
    expect(componentes).toMatch(/\.rtm-campo:disabled/);
  });
});
