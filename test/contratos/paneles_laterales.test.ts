import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactoMxn, nombresSimilares } from '@/dominio/explicar/vista';

const raiz = process.cwd();
const css = (f: string) => readFileSync(join(raiz, 'src/ui/estilos', f), 'utf8');
const estilos = readdirSync(join(raiz, 'src/ui/estilos')).filter((f) => f.endsWith('.css'));

/** Reglas planas "selector { cuerpo }" (sin anidar): suficiente para estos archivos. */
function reglas(txt: string): { sel: string; cuerpo: string }[] {
  const out: { sel: string; cuerpo: string }[] = [];
  const re = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  for (let m = re.exec(txt.replace(/\/\*[\s\S]*?\*\//g, '')); m; m = re.exec(txt.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    out.push({ sel: m[1]!.trim(), cuerpo: m[2]! });
    if (out.length > 5000) break;
  }
  return out;
}
const tiene = (cuerpo: string, prop: string) => new RegExp(`(^|[;\\s])${prop}\\s*:`).test(cuerpo);
const oculta = (cuerpo: string) => /overflow(-y|-x)?\s*:\s*(hidden|clip)/.test(cuerpo);

describe('contrato de paneles laterales y pop-ups', () => {
  const explicar = reglas(css('explicar.css'));

  it('ninguna regla de Explicar combina max-height con overflow oculto, salvo la hoja misma (que no es una seccion)', () => {
    for (const r of explicar) {
      if (r.sel.split(',').every((s) => s.trim() === '.xp-panel')) continue;
      expect(tiene(r.cuerpo, 'max-height') && oculta(r.cuerpo), r.sel).toBe(false);
    }
  });
  it('las secciones, su contenido y las tablas crecen a su altura natural: sin max-height ni altura fija', () => {
    for (const r of explicar.filter((x) => /\.xp-(seccion|tabla|grafica|vias|glosario|lista|formula)/.test(x.sel))) {
      expect(/max-height\s*:\s*[^n\s]/.test(r.cuerpo), r.sel).toBe(false);
      expect(tiene(r.cuerpo, 'height'), r.sel).toBe(false);
    }
    // la animacion de abrir/cerrar es grid 0fr -> 1fr, no una altura recortada
    const todo = css('explicar.css');
    expect(todo).toMatch(/grid-template-rows:\s*0fr/);
    expect(todo).toMatch(/grid-template-rows:\s*1fr/);
  });
  it('la pildora de estado no lleva alto fijo ni padding vertical desbalanceado: inline-flex centrada con line-height 1', () => {
    const pildoras = explicar.filter((r) => /^\.xp-estado(\[|$)/.test(r.sel) || r.sel === '.xp-estado');
    expect(pildoras.length).toBeGreaterThan(0);
    for (const r of pildoras) {
      expect(tiene(r.cuerpo, 'height'), r.sel).toBe(false);
      expect(tiene(r.cuerpo, 'max-height'), r.sel).toBe(false);
      expect(tiene(r.cuerpo, 'min-height'), r.sel).toBe(false);
    }
    const base = pildoras.find((r) => r.sel === '.xp-estado')!;
    expect(base.cuerpo).toMatch(/display:\s*inline-flex/);
    expect(base.cuerpo).toMatch(/align-items:\s*center/);
    expect(base.cuerpo).toMatch(/line-height:\s*1\b/);
    // ninguna otra regla reutiliza la clase para otra cosa (la carga usa .xp-aviso)
    expect(explicar.filter((r) => r.sel === '.xp-estado')).toHaveLength(1);
  });
  it('cada hoja tiene un solo contenedor de scroll vertical con overscroll contenido y cadena flex con min-height: 0', () => {
    const cuerpo = explicar.find((r) => r.sel === '.xp-cuerpo')!;
    expect(cuerpo.cuerpo).toMatch(/overflow-y:\s*auto/);
    expect(cuerpo.cuerpo).toMatch(/overscroll-behavior:\s*contain/);
    expect(cuerpo.cuerpo).toMatch(/min-height:\s*0/);
    expect(explicar.find((r) => r.sel === '.xp-cuerpo > *')!.cuerpo).toMatch(/flex:\s*none/); // los hijos no se encogen: el cuerpo es el que se desplaza
    const indice = explicar.find((r) => r.sel === '.xp-indice')!;
    expect(indice.cuerpo).toMatch(/position:\s*sticky/);
    expect(indice.cuerpo).toMatch(/background:\s*var\(--rtm-panel\)/); // opaco, nunca translucido
    expect(indice.cuerpo).not.toMatch(/color-mix|backdrop-filter/);

    const hoja = reglas(css('hoja.css'));
    const interno = hoja.filter((r) => r.sel.includes('.rtm-kr-panel-in') || r.sel.includes('.rtm-campana-panel') || r.sel.includes('.rtm-popover') || r.sel.includes('.rtm-dialogo'));
    expect(interno.some((r) => /overflow-y:\s*auto/.test(r.cuerpo) && /overscroll-behavior:\s*contain/.test(r.cuerpo))).toBe(true);
    for (const sel of ['.rtm-kr-panel-in', '.rtm-campana-panel', '.rtm-popover', '.rtm-dialogo', '.rtm-ba .rtm-exportar-panel']) {
      expect(hoja.some((r) => r.sel.split(',').map((x) => x.trim()).includes(sel) && /overflow-y:\s*auto/.test(r.cuerpo)), sel).toBe(true);
    }
  });
  it('los pop-ups nunca pasan del viewport', () => {
    const hoja = css('hoja.css');
    expect(hoja).toMatch(/\.rtm-campana-panel \{ max-height: min\(calc\(100dvh/);
    expect(hoja).toMatch(/\.rtm-popover \{ max-height: calc\(100dvh/);
    expect(hoja).toMatch(/\.rtm-dialogo \{ max-height: calc\(100dvh/);
  });
  it('no existen esqueletos ni cajas de carga en blanco con alto fijo mayor a 12 px', () => {
    for (const f of estilos) {
      for (const r of reglas(css(f))) {
        if (!/esqueleto|skeleton|\.xp-esq|rtm-cargando-/.test(r.sel)) continue;
        const h = /(^|[;\s])(min-)?height:\s*(\d+)px/.exec(r.cuerpo);
        expect(h === null || Number(h[3]) <= 12, `${f}: ${r.sel}`).toBe(true);
      }
    }
  });
  it('ningun componente pinta rtm-esqueleto, xp-esq ni bloques de carga; los loading.tsx son minimos', () => {
    const archivos: string[] = [];
    const recorre = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorre(p); else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) archivos.push(p); } };
    recorre(join(raiz, 'src'));
    for (const a of archivos) {
      const t = readFileSync(a, 'utf8');
      expect(t, a).not.toMatch(/rtm-esqueleto|xp-esq|rtm-cargando-(bloque|titular|eyebrow)|data-esqueleto/);
      if (a.endsWith('loading.tsx')) expect(t.split('\n').length, a).toBeLessThanOrEqual(25);
    }
  });
});

describe('ayudas del panel Explicar', () => {
  it('formato compacto para etiquetas de grafica', () => {
    expect(compactoMxn(15_480_000)).toBe('$154.8 mil');
    expect(compactoMxn(-15_480_000)).toBe('\u2212$154.8 mil');
    expect(compactoMxn(120_000_000, true)).toBe('+$1.2 M');
    expect(compactoMxn(45_000)).toBe('$450');
  });
  it('nombre y definicion casi iguales se detectan; distintos no', () => {
    expect(nombresSimilares('Utilidad neta del periodo', 'Utilidad neta del periodo, ya sin gastos')).toBe(true);
    expect(nombresSimilares('Existencia', 'Piezas que hay hoy en bodega')).toBe(false);
  });
});
