import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Contrato (14-nov, pedido del dueno: "quita el boton de Mas"): la barra de acciones no tiene menu desplegable.
// Las acciones secundarias son botones compactos terciarios en la misma fila; nunca vuelve data-testid="barra-mas".
const SRC = join(process.cwd(), 'src');
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    return statSync(r).isDirectory() ? archivos(r) : /\.(tsx?|css)$/.test(n) ? [r] : [];
  });
}
const todos = archivos(SRC).filter((f) => !f.endsWith('.test.tsx') && !f.endsWith('.test.ts'));
const texto = (f: string) => readFileSync(f, 'utf8');

describe('BarraAcciones sin boton Mas', () => {
  it('ningun archivo de src usa barra-mas ni las clases del menu retirado', () => {
    const malos = todos.filter((f) => /barra-mas|rtm-ba-panel|rtm-ba-mas\b|rtm-ba-disparo|etiquetaMas/.test(texto(f)));
    expect(malos).toEqual([]);
  });
  it('el componente no abre menus: sin estado, sin aria-haspopup ni aria-expanded', () => {
    const c = texto(join(SRC, 'ui', 'componentes', 'barra-acciones.tsx'));
    expect(c).not.toMatch(/useState|aria-haspopup|aria-expanded|'use client'/);
  });
  it('ningun boton o enlace de accion se llama "Mas" (los filtros y la leyenda del mapa de calor no son acciones)', () => {
    const malos = todos.filter((f) => f.endsWith('.tsx') && !f.endsWith(join('graficas', 'mapa-calor.tsx')) && />\s*M[aá]s\s*<\/(button|a|Link)>/.test(texto(f)));
    expect(malos).toEqual([]);
  });
  it('la fila nunca se parte: .rtm-ba y sus grupos son nowrap y no hay flex-wrap: wrap en ellos', () => {
    const css = texto(join(SRC, 'ui', 'estilos', 'controles.css'));
    for (const sel of ['\\.rtm-ba', '\\.rtm-ba-sec', '\\.rtm-ba-primarias']) {
      const m = new RegExp(`(^|\\n)${sel}\\s*\\{[^}]*\\}`).exec(css);
      expect(m, sel).not.toBeNull();
      expect(m![0], sel).toMatch(/flex-wrap:\s*nowrap/);
    }
    expect(css).toMatch(/@media \(max-width: 1100px\) \{[^@]*\.rtm-ba \{[^}]*overflow-x: auto/);
  });
});
