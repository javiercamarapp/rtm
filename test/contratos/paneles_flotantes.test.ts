import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Contrato (14-nov, pedido del dueno): ningun panel flotante (menu, desplegable, popover) puede recortarse en el borde de la pantalla.
// Todo panel anclado bajo su disparador (position: absolute con top o bottom: calc(100% ...)) debe usar el mecanismo de colision:
// su clase aparece en un componente que usa useColision / DetallesFlotantes y el elemento lleva data-flota. flotantes.css fija los topes de ancho y alto.
const RAIZ = process.cwd();
const ESTILOS = join(RAIZ, 'src', 'ui', 'estilos');

function archivos(dir: string, ext: RegExp, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, ext, salida);
    else if (ext.test(n) && !/\.test\./.test(n)) salida.push(p);
  }
  return salida;
}

const css = [...archivos(join(RAIZ, 'src'), /\.css$/)].map((p) => ({ p, texto: readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const reglas = css.flatMap(({ p, texto }) => [...texto.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ archivo: p, selector: m[1]!.trim(), cuerpo: m[2]! })));
const tsx = archivos(join(RAIZ, 'src'), /\.tsx$/).map((p) => ({ p, texto: readFileSync(p, 'utf8') }));

// Paneles anclados bajo un disparador: position absolute + top/bottom calc(100% ...).
const ANCLADOS = reglas.filter((r) => /position:\s*absolute/.test(r.cuerpo) && /(top|bottom):\s*calc\(100%/.test(r.cuerpo));
// La clase del panel es la ultima clase del selector (sin pseudo ni hijos).
const claseDe = (sel: string) => { const m = [...sel.split(',')[0]!.matchAll(/\.([\w-]+)/g)].pop(); return m?.[1]; };
// Ejemplos con colision propia: no hay otros hoy. La lista debe seguir vacia salvo justificacion por escrito.
const EXCEPCIONES = new Map<string, string>([]);

describe('paneles flotantes: colision con el viewport', () => {
  it('hay paneles anclados que revisar', () => {
    expect(ANCLADOS.length).toBeGreaterThanOrEqual(6);
  });
  it('cada panel anclado se monta con useColision o DetallesFlotantes y data-flota', () => {
    const malos: string[] = [];
    for (const r of ANCLADOS) {
      const clase = claseDe(r.selector);
      if (!clase || EXCEPCIONES.has(clase)) continue;
      const usos = tsx.filter((f) => new RegExp(`['"\`\\s]${clase}['"\`\\s]`).test(f.texto));
      const ok = usos.some((f) => /useColision\(|<DetallesFlotantes/.test(f.texto) && /data-flota/.test(f.texto));
      if (!ok) malos.push(`${r.archivo.replace(RAIZ, '')}: .${clase} (usos: ${usos.length})`);
    }
    expect([...new Set(malos)]).toEqual([]);
  });
  it('flotantes.css limita ancho y alto al viewport y vuelve hoja inferior en telefono', () => {
    const base = reglas.find((r) => r.selector === '[data-flota]')!;
    expect(base.cuerpo).toMatch(/max-width:\s*calc\(100vw - 2 \* var\(--rtm-flota-margen\)\)/);
    expect(base.cuerpo).toMatch(/max-height:/);
    expect(base.cuerpo).toMatch(/overflow-y:\s*auto/);
    const hoja = reglas.find((r) => r.selector === '[data-flota][data-alin][data-vert]')!;
    expect(hoja.cuerpo).toMatch(/position:\s*fixed/);
    expect(hoja.cuerpo).toMatch(/bottom:/);
  });
  it('la entrada animada respeta prefers-reduced-motion', () => {
    const t = readFileSync(join(ESTILOS, 'flotantes.css'), 'utf8');
    expect(t).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*\[data-flota\]\s*\{\s*animation:\s*none/);
  });
  it('flotantes.css se carga al final de las hojas globales', () => {
    const layout = readFileSync(join(RAIZ, 'src', 'app', 'layout.tsx'), 'utf8');
    const orden = [...layout.matchAll(/import '@\/ui\/estilos\/([\w-]+)\.css'/g)].map((m) => m[1]);
    expect(orden[orden.length - 1]).toBe('flotantes');
  });
});
