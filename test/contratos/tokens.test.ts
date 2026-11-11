import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Tokens de la seccion 8: claro y oscuro, acento con DOS variantes conmutables.
const css = readFileSync(join(__dirname, '../../src/ui/estilos/tokens.css'), 'utf8');
const bloque = (selector: string) => {
  const i = css.indexOf(selector);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};
const claro = bloque(':root {');
const oscuro = bloque(":root[data-tema='oscuro'] {");

const ESPERADOS: Record<string, [string, string]> = {
  chrome: ['#f5f4f0', '#1c1c1b'],
  panel: ['#fcfcfa', '#161615'],
  surface: ['#ffffff', '#222220'],
  tint: ['#f5f4f0', '#262624'],
  'fill-active': ['#ecece4', '#2b2a27'],
  line: ['#ecebe6', '#2e2d2a'],
  'line-2': ['#d9d7d0', '#3a3935'],
  'line-strong': ['#8f8b82', '#7d786e'],
  ink: ['#1a1a1a', '#f3f2ee'],
  'ink-2': ['#555555', '#b9b7b1'],
  'ink-3': ['#666666', '#9c9a94'],
  ok: ['#14663a', '#5fcb8f'],
  warn: ['#7a4f00', '#e0b04c'],
  bad: ['#b3261e', '#ff8a80'],
};

describe('tokens de diseno (spec 8)', () => {
  for (const [k, [c, o]] of Object.entries(ESPERADOS)) {
    it(`--rtm-${k}: ${c} claro | ${o} oscuro`, () => {
      expect(claro).toContain(`--rtm-${k}: ${c};`);
      expect(oscuro).toContain(`--rtm-${k}: ${o};`);
    });
  }
  it('acento: neutro = tinta; lila #6A37A0 claro | #C3A0EE oscuro, soft #F5ECFD | #2E2438', () => {
    expect(css).toMatch(/\[data-acento='neutro'\] \{\s*--rtm-accent: var\(--rtm-ink\);\s*--rtm-accent-soft: var\(--rtm-fill-active\);/);
    expect(css).toMatch(/\[data-acento='lila'\] \{\s*--rtm-accent: var\(--rtm-lila\);\s*--rtm-accent-soft: var\(--rtm-lila-soft\);/);
    expect(claro).toContain('--rtm-lila: #6a37a0;');
    expect(claro).toContain('--rtm-lila-soft: #f5ecfd;');
    expect(oscuro).toContain('--rtm-lila: #c3a0ee;');
    expect(oscuro).toContain('--rtm-lila-soft: #2e2438;');
  });
  it('radios 5/8/12/16/22/pildora y panel de 22', () => {
    for (const r of ['5px', '8px', '12px', '16px', '22px', '999px']) expect(claro).toContain(`: ${r};`);
    expect(claro).toContain('--rtm-r-panel: 22px;');
  });
  it('paleta de datos de 8 matices (ocre nunca como texto)', () => {
    for (const n of ['tinta', 'lila', 'verde-azulado', 'ocre', 'azul-marino', 'terracota', 'malva', 'gris']) {
      expect(claro).toContain(`--rtm-d-${n}:`);
    }
  });
});
