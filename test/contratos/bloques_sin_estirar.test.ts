import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contrato (14-nov, pedido del dueno): los bloques de una tarjeta NO se estiran ni se reparten el alto de la tarjeta vecina ("aqui no era hacer mas largo el recuadro").
// El hueco se llena con contenido nuevo y util, no con flex-grow en .rtm-a1-cuerpo ni en las filas de .rtm-barlist.
const ESTILOS = join(process.cwd(), 'src', 'ui', 'estilos');
const reglas = readdirSync(ESTILOS).filter((n) => n.endsWith('.css')).flatMap((archivo) => {
  const css = readFileSync(join(ESTILOS, archivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ archivo, selector: m[1]!.trim(), cuerpo: m[2]! }));
});

describe('bloques sin estirar', () => {
  it('ni .rtm-a1-cuerpo ni .rtm-barlist (ni sus filas) crecen con flex-grow o space-around', () => {
    const malas = reglas.filter((r) => /\.rtm-a1-cuerpo|\.rtm-barlist/.test(r.selector) && /flex:\s*1\s+1\s+auto|flex-grow:\s*[1-9]|justify-content:\s*space-(around|between)/.test(r.cuerpo));
    expect(malas.map((r) => `${r.archivo}: ${r.selector}`)).toEqual([]);
  });
});
