import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginArtwork, ANCHO_MINIMO_ARTE, equipoModesto } from './artwork';

// El arte animado del login (lote L). No se ve en navegador aquí: se fijan por código sus garantías (decorativo, sin `style=`, diferido, pausado, sin animación con movimiento reducido,
// densidad y partículas acotadas, solo blanco y grises).
const motor = readFileSync(join(__dirname, 'particle-engine.js'), 'utf8');
const componente = readFileSync(join(__dirname, 'artwork.tsx'), 'utf8');
const css = readFileSync(join(__dirname, '../../app/login/login.css'), 'utf8');

describe('LoginArtwork', () => {
  it('es decorativo (aria-hidden), tiene su canvas y NO emite style= (CSP con nonce)', () => {
    const html = renderToStaticMarkup(<LoginArtwork />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<canvas');
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain('data-listo'); // el cuadro estático de respaldo es el primero; el canvas entra al terminar el motor
  });
  it('ni el componente ni el motor escriben style= ni tocan el atributo style', () => {
    expect(componente).not.toMatch(/\sstyle=|setAttribute\(['"]style|\.style\./);
    expect(motor).not.toMatch(/\.style\b|setAttribute\(['"]style/);
  });
  it('carga diferida: el motor se importa con import() en tiempo ocioso y solo si el panel se muestra (≥ 1024 px)', () => {
    expect(ANCHO_MINIMO_ARTE).toBe(1024);
    expect(componente).toMatch(/import\('\.\/particle-engine'\)/);
    expect(componente).not.toMatch(/^import .* from '\.\/particle-engine'/m);
    expect(componente).toContain('requestIdleCallback');
    expect(componente).toMatch(/matchMedia\(`\(min-width: \$\{ANCHO_MINIMO_ARTE\}px\)`\)/);
    expect(css).toMatch(/\.login-visual \{ display: none; \}/);
  });
  it('prefers-reduced-motion = un cuadro estático: el motor pinta una vez y no pide cuadros de animación', () => {
    expect(motor).toContain('(prefers-reduced-motion: reduce)');
    // se(): con movimiento reducido llama a I() (un dibujo) y retorna sin requestAnimationFrame.
    expect(motor).toMatch(/if \(s\.matches\) \{\s*I\(\);\s*return;\s*\}/);
    expect(motor).toMatch(/S && !document\.hidden && !s\.matches && \(E = requestAnimationFrame\(se\)\)/);
    expect(motor).toContain('"reduced"');
  });
  it('se pausa con la pestaña oculta y con el panel fuera de pantalla, y limpia todo al desmontar', () => {
    expect(motor).toContain('new IntersectionObserver');
    expect(motor).toContain('visibilitychange');
    expect(motor).toMatch(/document\.hidden/);
    expect(motor).toMatch(/cancelAnimationFrame/);
    expect(motor).toMatch(/disconnect\(\)/);
    expect(motor).toMatch(/removeEventListener\("visibilitychange"/);
  });
  it('densidad de pantalla ≤ 2 (1.5) y menos partículas en equipos modestos', () => {
    expect(motor).toMatch(/Math\.min\(devicePixelRatio \|\| 1, 1\.5\)/);
    expect(motor).toMatch(/lig \? 2400 : 4200/);
    expect(equipoModesto({ hardwareConcurrency: 4 })).toBe(true);
    expect(equipoModesto({ deviceMemory: 2 })).toBe(true);
    expect(equipoModesto({ hardwareConcurrency: 12, deviceMemory: 8 })).toBe(false);
    expect(componente).toContain('equipoModesto(');
  });
  it('colores del arte: blanco y grises (sin azul) y el canvas usa la mono de la app', () => {
    const vars = [...css.matchAll(/--login-particle-[a-z]+: (#[0-9a-f]{6,8});/g)].map((m) => m[1]);
    expect(vars.length).toBe(7);
    for (const v of vars as string[]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12);
    }
    expect(css).toMatch(/\.login-artwork canvas \{[^}]*font-family: var\(--font-mono-id\)/);
    expect(motor).toContain('r.fontFamily');
  });
  it('el cuadro estático de respaldo existe en CSS y el canvas entra con fundido', () => {
    expect(css).toMatch(/\.login-artwork \{[^}]*background: radial-gradient/);
    expect(css).toMatch(/\.login-artwork\[data-listo\] canvas \{ opacity: 1; \}/);
  });
});
