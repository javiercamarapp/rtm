// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { RenglonesTabla, type RenglonTabla } from './renglones-tabla';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

const datos: RenglonTabla[] = [
  { marca: 'Fasta', modelo: 'Fasta 37k', sabor: 'sin sabor especificado', piezas: 50, precioCent: 13500n },
  { marca: 'Fasta', modelo: 'Fasta 37k', sabor: 'fresa', piezas: 30, precioCent: 13500n },
  { marca: 'Waka', modelo: 'Waka 15k', sabor: 'piña colada', piezas: 20, precioCent: 20000n, importeCent: 400000n },
];

describe('RenglonesTabla', () => {
  it('es una tabla ARIA con encabezado, filas y total en el flujo; sin table ni listas', async () => {
    const m = abrir(montar(<RenglonesTabla renglones={datos} etiqueta="Renglones del pedido" precios testid="rt" />, 'reduced'));
    const t = m.cont.querySelector('[role="table"]')!;
    expect(t.getAttribute('aria-label')).toBe('Renglones del pedido');
    expect(m.cont.querySelector('table, ul, ol, li, tfoot')).toBeNull();
    expect([...t.querySelectorAll('[role="columnheader"]')].map((x) => x.textContent)).toEqual(['Marca', 'Modelo', 'Sabor', 'Piezas', 'Precio unit.', 'Importe']);
    expect(t.querySelectorAll('[role="row"]')).toHaveLength(1 + 3 + 1);
    // El total es la ultima fila y no es sticky: va en el flujo.
    const filas = [...t.querySelectorAll('[role="row"]')];
    expect(filas.at(-1)!.getAttribute('data-testid')).toBe('rt-total');
    expect(filas.at(-1)!.textContent).toContain('3 renglones');
    expect(filas.at(-1)!.textContent).toContain('100 pz');
    expect(filas.at(-1)!.textContent).toContain('$14,800.00');
    expect(await auditar(m.cont)).toEqual([]);
  });

  it('marcas, modelos y sabores en mayusculas; cada renglon calcula su importe', () => {
    const m = abrir(montar(<RenglonesTabla renglones={datos} etiqueta="Renglones" precios />, 'reduced'));
    const txt = m.cont.textContent ?? '';
    expect(txt).toContain('FASTA 37K');
    expect(txt).toContain('SIN SABOR ESPECIFICADO');
    expect(txt).toContain('PIÑA COLADA');
    expect(txt).toContain('$6,750.00'); // 50 x 135
    expect(txt).toContain('$4,000.00'); // importe dado por la base
    expect(txt).not.toContain('Fasta 37k');
  });

  it('sin precios (bodega y Omar) no muestra ni una cifra de dinero aunque el dato exista', () => {
    const m = abrir(montar(<RenglonesTabla renglones={datos} etiqueta="Renglones" />, 'reduced'));
    expect(m.cont.textContent).not.toMatch(/\$|Importe|Precio/);
    expect([...m.cont.querySelectorAll('[role="columnheader"]')].map((x) => x.textContent)).toEqual(['Marca', 'Modelo', 'Sabor', 'Piezas']);
    expect(m.cont.textContent).toContain('100 pz');
  });

  it('agrupa por modelo con subtotales y acepta una columna de acciones', () => {
    const m = abrir(montar(<RenglonesTabla renglones={datos} etiqueta="Renglones" precios agrupar acciones={() => <button type="button">Quitar</button>} />, 'reduced'));
    const sub = [...m.cont.querySelectorAll('.rtm-rt-subtotal')];
    expect(sub).toHaveLength(2);
    expect(sub[0]!.textContent).toContain('FASTA 37K');
    expect(sub[0]!.textContent).toContain('80 pz');
    expect(sub[0]!.textContent).toContain('$10,800.00');
    expect(m.cont.querySelectorAll('button')).toHaveLength(3);
  });

  it('sin marca conocida oculta la columna Marca; vacio muestra el texto', () => {
    const m = abrir(montar(<RenglonesTabla renglones={[{ modelo: 'Vhill 3k', sabor: 'uva', piezas: 5 }]} etiqueta="Renglones" />, 'reduced'));
    expect([...m.cont.querySelectorAll('[role="columnheader"]')].map((x) => x.textContent)).toEqual(['Modelo', 'Sabor', 'Piezas']);
    const v = abrir(montar(<RenglonesTabla renglones={[]} etiqueta="Renglones" vacio="Sin renglones aqui" testid="v" />, 'reduced'));
    expect(v.cont.textContent).toBe('Sin renglones aqui');
  });

  it('la region de scroll es enfocable y tiene nombre', () => {
    const m = abrir(montar(<RenglonesTabla renglones={datos} etiqueta="Renglones" />, 'reduced'));
    const r = m.cont.querySelector('[role="region"]')!;
    expect(r.getAttribute('tabindex')).toBe('0');
    expect(r.getAttribute('aria-label')).toMatch(/Renglones/);
  });
});
