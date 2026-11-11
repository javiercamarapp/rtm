import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Spec 17, 3.4: sin number con decimales ni float en el modulo de costos; sin console; sin any.
const raiz = join(__dirname, '../../src');
const carpetas = ['dominio/costos', 'aplicacion/costos', 'infra/costos'];
const sueltos = ['dominio/dinero/techo.ts'];

const archivos = [
  ...carpetas.flatMap((c) => readdirSync(join(raiz, c)).filter((n) => n.endsWith('.ts')).map((n) => join(c, n))),
  ...sueltos,
];

/** Quita comentarios y cadenas para que el texto de ayuda no dispare falsos positivos. */
function codigo(txt: string): string {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('modulo de costos: sin flotantes, sin console, sin any', () => {
  it('hay archivos que revisar', () => {
    expect(archivos.length).toBeGreaterThan(10);
  });
  for (const rel of archivos) {
    it(rel, () => {
      const c = codigo(readFileSync(join(raiz, rel), 'utf8'));
      expect(c, 'literal decimal').not.toMatch(/(?<![\w.])\d+\.\d+/);
      expect(c, 'redondeo de flotantes').not.toMatch(/Math\.(ceil|floor|round|trunc|fround)/);
      expect(c, 'conversion a flotante').not.toMatch(/\b(parseFloat|toFixed|Number\()/);
      expect(c, 'console').not.toMatch(/\bconsole\./);
      expect(c, 'any explicito').not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    });
  }
});
