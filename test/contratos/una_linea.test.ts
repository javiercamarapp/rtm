import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contrato (14-nov, pedido del dueno): barras de acciones y subnavegaciones de pestanas van SIEMPRE en una sola linea.
// Si no caben, se deslizan en horizontal (barra oculta y desvanecido), nunca se parten en dos renglones.
const ESTILOS = join(process.cwd(), 'src', 'ui', 'estilos');
const reglas: { archivo: string; selector: string; cuerpo: string }[] = readdirSync(ESTILOS)
  .filter((n) => n.endsWith('.css'))
  .flatMap((archivo) => {
    const css = readFileSync(join(ESTILOS, archivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ archivo, selector: m[1]!.trim(), cuerpo: m[2]! }));
  });

// Clases que nunca pueden partirse: barra de acciones (y sus grupos), pestanas y subnavegacion.
const UNA_LINEA = /\.rtm-ba(?![\w-])|\.rtm-ba-(sec|primarias|vistas)(?![\w-])|\.rtm-pestanas(?![\w-])|\.rtm-subnav(?![\w-])|\.rtm-encabezado-acciones(?![\w-])/;

describe('barras de acciones y pestanas: una sola linea', () => {
  it('hay reglas que revisar', () => {
    expect(reglas.filter((r) => UNA_LINEA.test(r.selector)).length).toBeGreaterThan(8);
  });
  it('ninguna regla de barra de acciones, pestanas o subnavegacion usa flex-wrap: wrap', () => {
    const malas = reglas.filter((r) => UNA_LINEA.test(r.selector) && /flex-wrap:\s*wrap(-reverse)?/.test(r.cuerpo)).map((r) => `${r.archivo}: ${r.selector}`);
    expect(malas).toEqual([]);
  });
  it('la tira de pestanas es nowrap, desliza en horizontal y oculta su barra', () => {
    const ul = reglas.find((r) => r.selector === '.rtm-pestanas ul')!;
    expect(ul.cuerpo).toMatch(/flex-wrap:\s*nowrap/);
    expect(ul.cuerpo).toMatch(/min-width:\s*max-content/);
    const nav = reglas.find((r) => r.selector === '.rtm-pestanas')!;
    expect(nav.cuerpo).toMatch(/overflow-x:\s*auto/);
    expect(nav.cuerpo).toMatch(/scrollbar-width:\s*none/);
  });
  it('las pestanas son compactas: 13 px y relleno horizontal de 8 a 10 px', () => {
    const a = reglas.find((r) => r.selector === '.rtm-pestanas a')!;
    expect(a.cuerpo).toMatch(/font-size:\s*13px/);
    expect(a.cuerpo).toMatch(/padding:\s*0 (8|9|10)px/);
  });
  it('los botones de la barra son densos: 28 px, 12.5 px, relleno de 10 px y area tactil por pseudo-elemento', () => {
    const tokens = readFileSync(join(ESTILOS, 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--rtm-ba-alto:\s*28px/);
    expect(tokens).toMatch(/--rtm-ba-px:\s*10px/);
    expect(tokens).toMatch(/--rtm-ba-fs:\s*12\.5px/);
    const css = readFileSync(join(ESTILOS, 'controles.css'), 'utf8');
    expect(css).toMatch(/:is\(\.rtm-ba-sec, \.rtm-ba-primarias\) > \.rtm-boton::before \{[^}]*inset: -8px -2px/);
    // Los dialogos que cuelgan de la barra no heredan el tamano denso: solo hijos directos.
    expect(css).not.toMatch(/\.rtm-ba(-sec|-primarias)? \.rtm-boton/);
  });
  it('las secundarias forman un solo grupo unido: filetes finos y esquinas redondeadas solo en los extremos', () => {
    const css = readFileSync(join(ESTILOS, 'controles.css'), 'utf8');
    expect(css).toMatch(/\.rtm-ba-sec > \.rtm-boton ~ \.rtm-boton \{ border-left: 1px solid/);
    expect(css).toMatch(/\.rtm-ba-sec > \.rtm-boton \{[^}]*border-radius: 0/);
    expect(css).toMatch(/border-start-start-radius/);
    expect(css).toMatch(/border-end-end-radius/);
  });
});

// Contrato (14-nov, pedido del dueno, "PONLOS EN LA MISMA LINEA"): las barras de filtros (buscador, marca, estado, periodo) tambien van en UNA linea.
// El formulario dentro del desplegable (.rtm-ba-fp-panel) es un panel flotante y si puede acomodar sus campos.
const BARRAS_FILTROS = /\.rtm-fc-barra(?![\w-])|\.rtm-ba-barra-filtros(?![\w-])|\.rtm-ds-filtros-linea(?![\w-])|\.rtm-kr-barra-filtros(?![\w-])|\.rtm-barra-filtros(-v2)?(?![\w-])|\.rtm-dt-barra(?![\w-])|\.rtm-filtros-linea(?![\w-])|\.a3-filtros-form(?![\w-])|\.rtm-a2-filtros(?![\w-])/;
describe('barras de filtros: una sola linea', () => {
  const barras = reglas.filter((r) => BARRAS_FILTROS.test(r.selector) && !/\.rtm-ba-fp-panel/.test(r.selector));
  it('hay reglas de barras de filtros que revisar', () => {
    expect(barras.length).toBeGreaterThan(10);
  });
  it('ninguna barra de filtros usa flex-wrap: wrap (ni en pantalla angosta)', () => {
    const malas = barras.filter((r) => /flex-wrap:\s*wrap(-reverse)?/.test(r.cuerpo)).map((r) => `${r.archivo}: ${r.selector}`);
    expect(malas).toEqual([]);
  });
  it('las barras principales declaran flex-wrap: nowrap', () => {
    for (const sel of ['.rtm-fc-barra', '.rtm-ba-barra-filtros', '.rtm-ds-filtros-linea', '.rtm-kr-barra-filtros', '.rtm-barra-filtros', '.rtm-dt-barra', '.rtm-filtros-linea']) {
      const r = reglas.filter((x) => x.selector.split(',').map((t) => t.trim()).includes(sel) && /flex-wrap:\s*nowrap/.test(x.cuerpo));
      expect(r.length, sel).toBeGreaterThan(0);
    }
  });
  it('el buscador del filtro compartido es flexible y acotado: base 220 px (flex 1 1 auto + width), de 160 a 360 px', () => {
    const r = reglas.find((x) => x.selector === '.rtm-fc-barra > .rtm-fc-busca')!;
    expect(r.cuerpo).toMatch(/flex:\s*1 1 auto;\s*width:\s*220px/);
    expect(r.cuerpo).toMatch(/min-width:\s*160px/);
    expect(r.cuerpo).toMatch(/max-width:\s*360px/);
  });
  it('en movil la barra desliza en horizontal con la barra oculta', () => {
    const css = readFileSync(join(ESTILOS, 'filtros.css'), 'utf8');
    expect(css).toMatch(/overflow-x:\s*auto;[^}]*scrollbar-width:\s*none/);
  });
});
