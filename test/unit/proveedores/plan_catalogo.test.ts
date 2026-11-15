import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { itemsDeIsaac, itemsDeTienda, nombreModelo, planificar, puffsExactos, saboresUnicos } from '../../../scripts/proveedores/plan-catalogo.mjs';
import { marcaFinal } from '../../../scripts/proveedores/cargar-catalogo-proveedor.mjs';

// Datos ficticios: nada de ventas, clientes ni tiendas reales.
const catalogo = [
  { id: 1, marca: 'Marca Uno', n: 'Marca Uno Alfa 40K', al: [] },
  { id: 2, marca: 'Lost Mary', n: 'Lost Mary 35K', al: [] },
  { id: 3, marca: 'Funky Republic', n: 'Funky Republic Fi 3K', al: [] },
  { id: 4, marca: 'Elf Bar', n: 'Elf Bar TE6000', al: [] },
  { id: 5, marca: 'Waka', n: 'Waka Blast 50K', al: [] },
  { id: 6, marca: 'Waka', n: 'Waka Blast', al: [] },
];
const item = (titulo: string, marca: string, extra: Record<string, unknown> = {}) => ({ clave: titulo, titulo, marca, sabores: [{ nombre: 'Uva', disponible: true }], ...extra });

describe('puffs y nombres', () => {
  it('lee puffs exactos y limpia el nombre', () => {
    expect(puffsExactos('Lost Mary 5000')).toBe(5000);
    expect(puffsExactos('Fifty Bar 20,000')).toBe(20000);
    expect(puffsExactos('Elfbar 40K')).toBe(40000);
    expect(puffsExactos('Funky Republic')).toBeNull();
    expect(nombreModelo('Hyper Bar 50,000')).toBe('Hyper Bar 50K');
  });
});

describe('plan de catalogo (Isaac)', () => {
  const plan = (items: ReturnType<typeof item>[]) => planificar(items, catalogo, { modo: 'isaac' });
  it('puffs explicitos distintos son otro modelo: Lost Mary 5000 se crea aunque exista Lost Mary 35K', () => {
    expect(plan([item('LOST MARY 5000', 'LOST MARY')]).nuevo).toHaveLength(1);
  });
  it('un modelo sin puffs en una marca que ya existe se pregunta', () => {
    const r = plan([item('FUNKY REPUBLIC', 'FUNKY REPUBLIC')]);
    expect(r.nuevo).toHaveLength(0);
    expect(r.porConfirmar[0]?.candidatos).toContain(3);
  });
  it('misma linea con otra marca se pregunta (EBDESIGN TE6000 contra Elf Bar TE6000)', () => {
    const r = plan([item('EBDESIGN TE6000', 'EBDESIGN')]);
    expect(r.porConfirmar[0]?.motivo).toBe('misma linea con otra marca');
  });
  it('Waka Blast 45K es modelo APARTE por decision del dueno', () => {
    const r = plan([item('WAKA BLAST 45K', 'WAKA', { forzarNuevo: true, sabores: [] })]);
    expect(r.nuevo).toHaveLength(1);
    expect(r.coincide).toHaveLength(0);
    expect(r.porConfirmar).toHaveLength(0);
  });
  it('una marca nueva se crea sin preguntar', () => {
    expect(plan([item('AROMA KING 700', 'AROMA KING')]).nuevo).toHaveLength(1);
  });
});

describe('sabores y marcas', () => {
  it('los repetidos exactos de un modelo se juntan', () => {
    const s = saboresUnicos({ sabores: [{ nombre: 'Blue Razz', disponible: false }, { nombre: 'blue  razz', disponible: true }, { nombre: 'Uva', disponible: false }] });
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ nombre: 'Blue Razz', disponible: true });
  });
  it('usa la marca que ya existe aunque se escriba distinto', () => {
    expect(marcaFinal('ELF BAR', ['Elfbar', 'Waka'])).toBe('Elfbar');
    expect(marcaFinal('Marca Nueva', ['Elfbar'])).toBe('Marca Nueva');
  });
  it('de la tienda solo salen titulo, marca, identificador y sabores con disponibilidad (jamas precios)', () => {
    const [x] = itemsDeTienda([{ handle: 'h', title: 'Modelo 40,000', vendor: 'V', variants: [{ title: 'Uva', available: false, price: '420.00' }] }]);
    expect(JSON.stringify(x)).not.toMatch(/420|price/);
    expect(x?.sabores).toEqual([{ nombre: 'Uva', disponible: false }]);
  });
});

describe('catalogo Remate de Isaac', () => {
  const json = JSON.parse(readFileSync(new URL('../../../scripts/catalogo/isaac-remate.json', import.meta.url), 'utf8'));
  it('trae los 23 modelos del PDF y Waka Blast 45K aparte, sin precios en los datos', () => {
    expect(json.modelos.filter((m: { pagina: number | null }) => m.pagina !== null)).toHaveLength(23);
    const items = itemsDeIsaac(json);
    expect(items).toHaveLength(24);
    expect(items.find((x: { titulo: string }) => x.titulo === 'WAKA BLAST 45K')).toMatchObject({ forzarNuevo: true, sabores: [] });
    expect(items.every((x: { sabores: unknown[] }) => Array.isArray(x.sabores))).toBe(true);
    expect(JSON.stringify(json.modelos.map((m: { sabores: string[] }) => m.sabores))).not.toMatch(/\$|\d+\.\d{2}/);
  });
});
