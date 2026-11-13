import { describe, expect, it } from 'vitest';
import { aCentavos, claveOperacion, nombreDeSlug, prorratear, repartirExacto, sabor, sumaRenglones } from '../../../scripts/cargador/lib.mjs';

describe('cargador: dinero', () => {
  it('convierte pesos a centavos exactos y rechaza mas de dos decimales', () => {
    expect(aCentavos(10)).toBe(1000);
    expect(aCentavos(91.55)).toBe(9155);
    expect(aCentavos('1,234.50')).toBe(123450);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
    expect(() => aCentavos(91.5584)).toThrow(/decimales/);
    expect(() => aCentavos('abc')).toThrow(/invalido/);
  });
});

describe('cargador: prorrateo exacto', () => {
  const casos: [number, number[]][] = [
    [783900, [2, 1, 2, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3]],
    [3502000, [20, 8, 30, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]],
    [925, [1, 1, 1]],
    [5000, [40]],
  ];
  for (const [total, q] of casos) {
    it(`reparte ${total} entre ${q.length} renglones sin perder un centavo`, () => {
      const p = prorratear(total, q) as number[];
      expect(sumaRenglones(q, p)).toBe(total);
      expect(Math.max(...p) - Math.min(...p)).toBeLessThanOrEqual(4);
    });
  }
  it('un total que no es alcanzable con esos renglones falla en prorratear y se resuelve partiendo un renglon en repartirExacto', () => {
    expect(() => prorratear(100001, [7, 13, 21])).toThrow(/repartir/);
    const partes = repartirExacto({ precioTotal: 100001, costoTotal: 77777, cantidades: [7, 13, 21] }) as { piezas: number; precio: number; costo: number; indice: number }[];
    expect(sumaRenglones(partes.map((x) => x.piezas), partes.map((x) => x.precio))).toBe(100001);
    expect(sumaRenglones(partes.map((x) => x.piezas), partes.map((x) => x.costo))).toBe(77777);
    expect(partes.reduce((s, x) => s + x.piezas, 0)).toBe(41);
    expect(partes.length).toBeGreaterThan(3);
  });
  it('repartirExacto es exacto para totales y cantidades aleatorias reproducibles (venta y costo a la vez)', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 300; i += 1) {
      const q = Array.from({ length: 1 + Math.floor(rnd() * 25) }, () => 1 + Math.floor(rnd() * 30));
      const pz = q.reduce((s, x) => s + x, 0);
      const venta = pz * 100 + Math.floor(rnd() * 5000) + 1;
      const costo = pz * 60 + Math.floor(rnd() * 3000) + 1;
      const partes = repartirExacto({ precioTotal: venta, costoTotal: costo, cantidades: q }) as { piezas: number; precio: number; costo: number }[];
      expect(partes.reduce((s, x) => s + x.piezas, 0)).toBe(pz);
      expect(sumaRenglones(partes.map((x) => x.piezas), partes.map((x) => x.precio))).toBe(venta);
      expect(sumaRenglones(partes.map((x) => x.piezas), partes.map((x) => x.costo))).toBe(costo);
    }
  });
  it('falla con entradas invalidas', () => {
    expect(() => prorratear(0, [1])).toThrow();
    expect(() => prorratear(100, [0])).toThrow();
    expect(() => prorratear(1, [5])).toThrow(/centavo/);
  });
});

describe('cargador: claves y nombres', () => {
  it('la clave de idempotencia es estable, corta y no contiene la clave de identidad', () => {
    const k = claveOperacion('carga', 'Karen|73266|cliente-x|2026-10-15|1', 'pedido');
    expect(k).toBe(claveOperacion('carga', 'Karen|73266|cliente-x|2026-10-15|1', 'pedido'));
    expect(k).not.toContain('cliente-x');
    expect(k).toMatch(/^carga:[0-9a-f]{16}:pedido$/);
    expect(claveOperacion('carga', 'otra', 'pedido')).not.toBe(k);
  });
  it('limpia sabores y nombres', () => {
    expect(sabor('Peach Ice (?)')).toBe('Peach Ice');
    expect(sabor('(sin sabores)')).toBe('Sin sabor especificado');
    expect(sabor('(variadas; ver nota)')).toBe('Variados');
    expect(sabor('blueberry   splash')).toBe('Blueberry Splash');
    expect(nombreDeSlug('cliente-uno')).toBe('Cliente Uno');
  });
});
