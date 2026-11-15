// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { agruparPorModelo, ModelosSabores, type RenglonSabor } from './modelos-sabores';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

const sabores = (n: number, modelo = 'Vhill 3K'): RenglonSabor[] => Array.from({ length: n }, (_, i) => ({ modelo, sabor: `Sabor ${i + 1}`, piezas: 10 + i }));

describe('agruparPorModelo', () => {
  it('suma por modelo, ordena por piezas descendente y une sabores repetidos', () => {
    const g = agruparPorModelo([
      { modelo: 'A', sabor: 'Menta', piezas: 5 }, { modelo: 'B', sabor: 'Uva', piezas: 40 },
      { modelo: 'A', sabor: 'Fresa', piezas: 20 }, { modelo: 'A', sabor: 'Menta', piezas: 5 },
    ]);
    expect(g.map((x) => x.modelo)).toEqual(['B', 'A']);
    expect(g[1]).toMatchObject({ piezas: 30 });
    expect(g[1]!.sabores).toEqual([{ sabor: 'Fresa', piezas: 20 }, { sabor: 'Menta', piezas: 10 }]);
  });
});

describe('ModelosSabores', () => {
  it('1 sabor: abierto, sin texto pegado', async () => {
    const m = abrir(montar(<ModelosSabores renglones={sabores(1)} />, 'reduced'));
    expect(m.cont.querySelector('details')!.open).toBe(true);
    expect(m.cont.textContent).toContain('1 sabor');
    expect(m.cont.textContent).not.toContain(' · Vhill 3K Sabor');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('5 sabores: cerrado por omision y ordenado por piezas', async () => {
    const m = abrir(montar(<ModelosSabores renglones={sabores(5)} />, 'reduced'));
    expect(m.cont.querySelector('details')!.open).toBe(false);
    const filas = [...m.cont.querySelectorAll('.rtm-ms-sabor')].map((x) => x.textContent);
    expect(filas[0]).toBe('Sabor 5');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('32 sabores en celda: una sola linea de resumen con scroll interno y axe limpio', async () => {
    const m = abrir(montar(<ModelosSabores variante="celda" renglones={sabores(32)} />, 'reduced'));
    const resumen = m.cont.querySelector('summary')!;
    expect(resumen.textContent).toContain('32 sabores');
    expect(resumen.textContent).toContain('Ver sabores');
    expect(m.cont.querySelectorAll('.rtm-ms-scroll')).toHaveLength(1);
    expect(m.cont.querySelectorAll('.rtm-ms-sabores > li')).toHaveLength(32);
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('varios modelos en celda muestran +N y sin foto usa monograma accesible', async () => {
    const m = abrir(montar(<ModelosSabores variante="celda" renglones={[...sabores(3, 'Modelo Sin Foto X'), ...sabores(2, 'Otro Sin Foto Y')]} />, 'reduced'));
    expect(m.cont.querySelector('.rtm-ms-mas')!.textContent).toBe('+1 modelo');
    expect(m.cont.querySelector('[data-vacia]')).not.toBeNull();
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('sin renglones y sin costos', () => {
    const m = abrir(montar(<ModelosSabores renglones={[]} vacio="Sin renglones" />));
    expect(m.cont.textContent).toBe('Sin renglones');
    expect(m.cont.textContent).not.toMatch(/\$/);
  });
});
