import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Contrato (14-nov, pedido del dueno): no existe una pantalla de texto "Cargando RTM...". Toda ruta con loading.tsx muestra el logo animado (PaginaCargando)
// o un esqueleto de tabla; el texto de carga solo lo lee el lector de pantalla y la pantalla aparece tras ~150 ms para no parpadear.
const RAIZ = process.cwd();
function buscar(dir: string, nombre: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) buscar(p, nombre, salida);
    else if (n === nombre) salida.push(p);
  }
  return salida;
}
const loadings = buscar(join(RAIZ, 'src', 'app'), 'loading.tsx');

describe('pantalla de carga con logo', () => {
  it('hay rutas con loading.tsx', () => { expect(loadings.length).toBeGreaterThanOrEqual(10); });
  it('ningun archivo de la app nombra "Cargando RTM"', () => {
    const todos = buscar(join(RAIZ, 'src'), 'loading.tsx').concat(buscar(join(RAIZ, 'src'), 'estado-pagina.tsx'));
    expect(todos.filter((p) => /Cargando RTM/.test(readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('cada loading.tsx usa PaginaCargando (logo) o un esqueleto de DataTable en estado cargando', () => {
    const malos = loadings.filter((p) => { const t = readFileSync(p, 'utf8'); return !/PaginaCargando/.test(t) && !/estado="cargando"/.test(t); });
    expect(malos.map((p) => p.replace(RAIZ, ''))).toEqual([]);
  });
  it('el CSS retrasa la aparicion 150 ms y respeta movimiento reducido', () => {
    const css = readFileSync(join(RAIZ, 'src', 'ui', 'estilos', 'componentes.css'), 'utf8');
    expect(css).toMatch(/\.rtm-cargando \{[^}]*animation: rtm-carga-aparece 200ms ease-out 150ms both/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.rtm-cargando-logo, \.rtm-cargando-logo::after \{ animation: none/);
  });
});
