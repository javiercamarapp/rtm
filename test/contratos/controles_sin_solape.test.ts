import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contrato (hallazgos del verificador, 15-nov): los controles de una barra no se pisan ni miden distinto.
// Se revisa el CSS fuente; la medida real en navegador la hace test/e2e/controles-barras.spec.ts.
const ESTILOS = join(process.cwd(), 'src', 'ui', 'estilos');
const reglas = readdirSync(ESTILOS)
  .filter((n) => n.endsWith('.css'))
  .flatMap((archivo) => {
    const css = readFileSync(join(ESTILOS, archivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ archivo, selector: m[1]!.trim(), cuerpo: m[2]! }));
  });
const regla = (sel: string) => reglas.filter((r) => r.selector.split(',').map((t) => t.trim()).includes(sel));

describe('filtros en linea: el campo ocupa su celda y no la desborda', () => {
  it('el campo dentro de .rtm-filtros-linea tiene min-width 0 y ancho 100 % (gana al min-width del buscador)', () => {
    const r = regla('.rtm-filtros-linea .rtm-etiqueta-campo > .rtm-campo');
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((x) => /min-width:\s*0\b/.test(x.cuerpo) && /width:\s*100%/.test(x.cuerpo))).toBe(true);
  });
  it('las celdas de la linea encogen (min-width acotado) en vez de empujar a la siguiente', () => {
    const r = regla('.rtm-filtros-linea > .rtm-etiqueta-campo')[0]!;
    expect(r.cuerpo).toMatch(/flex:\s*1 1 auto/);
    expect(r.cuerpo).toMatch(/min-width:\s*1[0-9]{2}px/);
  });
  it('la regla del campo pesa mas que la del buscador (3 clases contra 2): no depende del orden', () => {
    const r = regla('.rtm-filtros-linea .rtm-etiqueta-campo > .rtm-campo')[0]!;
    const clases = (r.selector.match(/\.[\w-]+/g) ?? []).length;
    expect(clases).toBeGreaterThanOrEqual(3);
  });
});

describe('barras de tabla y paginadores: misma altura de controles', () => {
  it('buscador, selector y botones miden el token de altura (no 28 px sueltos)', () => {
    const r = reglas.filter((x) => x.selector === ':is(.rtm-dt-barra, .rtm-paginador) :is(.rtm-boton, .rtm-boton-chico, .rtm-campo, .rtm-dt-busqueda)');
    expect(r.length).toBe(1);
    expect(r[0]!.cuerpo).toMatch(/height:\s*var\(--rtm-ctl-alto\)/);
  });
});

describe('campos sueltos de formulario vertical: ancho acotado', () => {
  it('un campo de texto directo del formulario no pasa de 560 px (costos, fuente, motivo)', () => {
    const r = regla(".rtm-form > .rtm-etiqueta-campo:has(> input.rtm-campo)");
    expect(r.length).toBe(1);
    expect(r[0]!.cuerpo).toMatch(/max-width:\s*min\(100%,\s*560px\)/);
  });
});
