import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Contrato: los renglones de pedidos, compras y ordenes se muestran con RenglonesTabla (tabla ARIA estilo kardex por sabor),
// nunca como lista con vinetas de texto corrido ("MARCA · MODELO · SABOR · 50 pz a $135.00 = $6,750.00").
const RAIZ = process.cwd();
const archivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? archivos(p) : [p]; });
const fuentes = ['src/app', 'src/ui'].flatMap((d) => archivos(join(RAIZ, d))).filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f));
const leer = (f: string) => readFileSync(f, 'utf8');

describe('renglones: tabla y no lista de texto', () => {
  it('ninguna <ul> mapea renglones ni arma un <li> con modelo, sabor y piezas concatenados', () => {
    const malas: string[] = [];
    for (const f of fuentes) {
      const t = leer(f);
      const rel = relative(RAIZ, f);
      if (/<ul[^>]*>\s*\{\s*\(?\s*renglones\.map/.test(t)) malas.push(`${rel}: <ul> con renglones.map`);
      if (/<ul[^>]*aria-label="Renglones[^"]*"/.test(t)) malas.push(`${rel}: <ul> rotulada Renglones`);
      for (const li of t.matchAll(/<li\b[^>]*>([^]*?)<\/li>/g)) {
        const cuerpo = li[1] ?? '';
        if (/(nombreVape|saborMayus)\([^)]*\)[^]*formatearPiezas\(/.test(cuerpo) && /formatearMoneda\(|\$\{?[a-z.]*precio/.test(cuerpo)) malas.push(`${rel}: <li> con modelo, sabor, piezas y precio en texto`);
      }
    }
    expect(malas).toEqual([]);
  });

  it('los formularios y el libro de pedidos a costo usan RenglonesTabla', () => {
    for (const ruta of ['src/app/(socio)/pedidos/nuevo/formulario-pedido.tsx', 'src/app/(socio)/proveedores/compras/nueva/formulario-compra.tsx', 'src/app/(socio)/dropshipping/nuevo/formulario-ds.tsx', 'src/app/(socio)/menudeo/page.tsx']) {
      expect(leer(join(RAIZ, ruta)), ruta).toContain('<RenglonesTabla');
    }
  });

  it('la tabla usa roles ARIA, no <table>, y su total va en el flujo (sin sticky ni fixed)', () => {
    const tsx = leer(join(RAIZ, 'src/ui/componentes/renglones-tabla.tsx'));
    expect(tsx).not.toMatch(/<table[\s>]|<tfoot|<ul|<li\b/);
    for (const rol of ['role="table"', 'role="row"', 'role="cell"', 'role="columnheader"']) expect(tsx).toContain(rol);
    const css = leer(join(RAIZ, 'src/ui/estilos/renglones-tabla.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const total = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /rtm-rt-total/.test(m[1] ?? ''));
    expect(total.length).toBeGreaterThan(0);
    for (const m of total) expect(m[2]).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
    expect(css).not.toMatch(/flex-basis|flex:\s*[\d.]+\s+[\d.]+\s+\d+px|#[0-9a-fA-F]{3,8}\b/);
    if (/transition|animation/.test(css)) expect(css).toMatch(/prefers-reduced-motion/);
  });

  it('bodega y Omar no reciben precios: ninguna vista de bodega u Omar pasa precios a RenglonesTabla', () => {
    const malas = fuentes.filter((f) => /src\/ui\/(omar|bodega)|\/\(omar\)\/|\/\(bodega\)\//.test(f)).filter((f) => /<RenglonesTabla[^>]*\bprecios\b/.test(leer(f)));
    expect(malas).toEqual([]);
  });
});
