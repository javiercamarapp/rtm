import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guarda estatica: el pie de totales de las tablas no debe superponerse a las filas ni el boton "Mas columnas" tapar datos.
// El navegador real se revisa aparte; aqui se vigila que nadie reintroduzca position:sticky en el pie.
const DIR = join(process.cwd(), 'src', 'ui', 'estilos');
const reglas = readdirSync(DIR)
  .filter((f) => f.endsWith('.css'))
  .flatMap((f) => [...readFileSync(join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ archivo: f, sel: (m[1] ?? '').trim(), cuerpo: m[2] ?? '' })));

describe('tablas: sin superposicion', () => {
  it('ninguna regla del pie de totales (rtm-dt-pie, tfoot) usa position: sticky o fixed', () => {
    const malas = reglas.filter((r) => /rtm-dt-pie|tfoot/.test(r.sel) && /position:\s*(sticky|fixed)/.test(r.cuerpo));
    expect(malas.map((r) => `${r.archivo}: ${r.sel}`)).toEqual([]);
  });
  it('el rotulo del pie va en una sola linea', () => {
    const r = reglas.find((x) => /\.rtm-dt-pie \.rtm-dt-celda:first-child$/.test(x.sel) && /white-space:\s*nowrap/.test(x.cuerpo));
    expect(r).toBeTruthy();
  });
  it('el boton "Mas columnas" va en el flujo (barra propia), no absoluto sobre la tabla', () => {
    const mas = reglas.find((r) => /^\.rtm-dt-mas$/.test(r.sel));
    expect(mas?.cuerpo).not.toMatch(/position:\s*absolute/);
    expect(reglas.some((r) => /^\.rtm-dt-mas-barra$/.test(r.sel))).toBe(true);
  });
  it('la cabecera fija es opaca y dibuja su borde con sombra (border-collapse no lo desplaza)', () => {
    const sombra = reglas.find((r) => /rtm-dt-caja\[data-pegajosa\] \.rtm-dt-cabecera \.rtm-dt-celda$/.test(r.sel) && /box-shadow/.test(r.cuerpo));
    expect(sombra).toBeTruthy();
    const base = reglas.find((r) => /^\.rtm-dt-cabecera \.rtm-dt-celda$/.test(r.sel) && /background:\s*var\(--rtm-th-fondo\)/.test(r.cuerpo));
    expect(base).toBeTruthy();
  });
});
