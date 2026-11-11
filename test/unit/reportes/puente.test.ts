import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { agregarPorModelo, calcularPuente, causaDominante, contribucionModelo, puenteCuadra, type AgregadoModelo } from '@/dominio/reportes/puente';
import type { PedidoInsumo } from '@/dominio/reportes/insumos';
import { bp, jsonCanonico, medianaNum, percentil, prorratear, rac, repartirExacto, sha256Hex, desvEstandar, mediaNum, pisoRac, cmpTexto, aBigRedondeado, sumaBig } from '@/dominio/reportes/util';
import { ErrorReporte } from '@/dominio/reportes/tipos';

const agregado = (modelo: string, piezas: number, venta: number, costo: number, guia: number, otros: number): AgregadoModelo => ({ modelo, piezas, ventaCent: BigInt(venta), costoCent: BigInt(costo), guiaCent: BigInt(guia), otrosCent: BigInt(otros) });

const arbModelo = fc.record({
  piezas: fc.integer({ min: 1, max: 600 }),
  precio: fc.integer({ min: 5_000, max: 40_000 }),
  costo: fc.integer({ min: 3_000, max: 35_000 }),
  guia: fc.integer({ min: 0, max: 900 }),
  otros: fc.integer({ min: 0, max: 400 }),
});
const arbPeriodo = fc.array(fc.tuple(fc.constantFrom('Nexa 50K', 'Waka Jupiter', 'Elux 50K', 'Icon', 'Fasta Kit', 'Blast'), arbModelo), { minLength: 1, maxLength: 6 }).map((xs) => {
  const m = new Map<string, AgregadoModelo>();
  for (const [nombre, a] of xs) m.set(nombre, agregado(nombre, a.piezas, a.piezas * a.precio, a.piezas * a.costo, a.piezas * a.guia, a.piezas * a.otros));
  return [...m.values()];
});

describe('puente de utilidad', () => {
  it('propiedad: inicio + suma de pasos = fin, y la suma de pasos = U1 - U0, en 600 casos', () => {
    fc.assert(
      fc.property(arbPeriodo, arbPeriodo, (p0, p1) => {
        const p = calcularPuente(p0, p1);
        expect(p).not.toBeNull();
        const u0 = sumaBig(p0.map(contribucionModelo));
        const u1 = sumaBig(p1.map(contribucionModelo));
        expect(p!.inicioCent).toBe(u0);
        expect(p!.finCent).toBe(u1);
        expect(sumaBig(p!.pasos.map((x) => x.deltaCent))).toBe(u1 - u0);
        expect(puenteCuadra(p!)).toBe(true);
      }),
      { numRuns: 600 },
    );
  });
  it('periodos identicos: todos los pasos en cero', () => {
    const a = [agregado('Nexa 50K', 100, 1_000_000, 800_000, 50_000, 20_000)];
    const p = calcularPuente(a, a)!;
    expect(p.pasos.every((x) => x.deltaCent === 0n)).toBe(true);
  });
  it('solo sube el costo: la diferencia cae en el paso costo', () => {
    const p0 = [agregado('Icon', 100, 1_000_000, 700_000, 0, 0)];
    const p1 = [agregado('Icon', 100, 1_000_000, 850_000, 0, 0)];
    const p = calcularPuente(p0, p1)!;
    const costo = p.pasos.find((x) => x.id === 'costo')!;
    expect(costo.deltaCent).toBe(-150_000n);
    expect(causaDominante(p).id).toBe('costo');
  });
  it('modelo nuevo entra por mezcla; modelo que desaparece tambien suma exacto', () => {
    const p0 = [agregado('A', 100, 1_000_000, 800_000, 0, 0), agregado('B', 50, 600_000, 400_000, 0, 0)];
    const p1 = [agregado('A', 100, 1_000_000, 800_000, 0, 0), agregado('C', 80, 900_000, 600_000, 0, 0)];
    const p = calcularPuente(p0, p1)!;
    expect(sumaBig(p.pasos.map((x) => x.deltaCent))).toBe(p.finCent - p.inicioCent);
  });
  it('sin periodo previo comparable no hay puente', () => {
    expect(calcularPuente([], [agregado('A', 10, 100, 50, 0, 0)])).toBeNull();
  });
  it('rechaza un modelo con importes y sin piezas', () => {
    expect(() => calcularPuente([agregado('A', 10, 100, 50, 0, 0)], [agregado('A', 0, 100, 0, 0, 0)])).toThrow(ErrorReporte);
  });
  it('un puente alterado no cuadra (no se dibuja)', () => {
    const p = calcularPuente([agregado('A', 10, 1000, 500, 0, 0)], [agregado('A', 12, 1300, 700, 0, 0)])!;
    expect(puenteCuadra({ ...p, finCent: p.finCent + 1n })).toBe(false);
  });
});

describe('agregar por modelo', () => {
  const pedido = (folio: string, origen: 'bodega' | 'directo', guia: number, mensajero: number): PedidoInsumo => ({
    folio,
    fecha: '2026-11-03',
    clienteId: 'c1',
    cliente: 'Cliente A',
    origen,
    cobradoCent: 0n,
    guiaCent: BigInt(guia),
    mensajeroCent: BigInt(mensajero),
    lineas: [
      { modelo: 'A', piezas: 3, precioCent: 10_000n, costoCent: 8_000n },
      { modelo: 'B', piezas: 4, precioCent: 12_000n, costoCent: 9_000n },
    ],
  });
  it('prorratea guia y mensajeros con residuo exacto y suma la renta de bodega', () => {
    const ag = agregarPorModelo([pedido('P1', 'bodega', 1001, 100)]);
    expect(sumaBig(ag.map((a) => a.guiaCent))).toBe(1001n);
    expect(sumaBig(ag.map((a) => a.otrosCent))).toBe(100n + 7n * 200n);
    expect(ag.map((a) => a.modelo)).toEqual(['A', 'B']);
  });
  it('pedido directo no paga renta', () => {
    const ag = agregarPorModelo([pedido('P1', 'directo', 0, 0)]);
    expect(sumaBig(ag.map((a) => a.otrosCent))).toBe(0n);
  });
  it('rechaza piezas no enteras o pedido sin piezas con gastos', () => {
    const malo = pedido('P2', 'directo', 0, 0);
    expect(() => agregarPorModelo([{ ...malo, lineas: [{ modelo: 'A', piezas: 1.5, precioCent: 1n, costoCent: 1n }] }])).toThrow(ErrorReporte);
    expect(() => agregarPorModelo([{ ...malo, guiaCent: 5n, lineas: [] }])).toThrow(ErrorReporte);
  });
});

describe('utilidades puras', () => {
  it('sha256 coincide con node:crypto', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
      }),
      { numRuns: 200 },
    );
    expect(sha256Hex('')).toBe(createHash('sha256').update('').digest('hex'));
  });
  it('prorratear suma exactamente y no rebasa por mas de un centavo del ideal', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 8 }), (monto, pesos) => {
        const r = prorratear(BigInt(monto), pesos);
        expect(sumaBig(r)).toBe(BigInt(monto));
      }),
      { numRuns: 300 },
    );
    expect(prorratear(5n, [0, 0])).toEqual([5n, 0n]);
    expect(prorratear(5n, [])).toEqual([]);
  });
  it('repartirExacto falla si los racionales no suman el total', () => {
    expect(() => repartirExacto([rac(1n, 2n), rac(1n, 2n)], 5n)).toThrow(RangeError);
    expect(repartirExacto([rac(1n, 2n), rac(1n, 2n)], 1n)).toEqual([1n, 0n]);
  });
  it('racionales: denominador cero y piso con negativos', () => {
    expect(() => rac(1n, 0n)).toThrow(RangeError);
    expect(pisoRac(rac(-1n, 2n))).toBe(-1n);
    expect(pisoRac(rac(-4n, 2n))).toBe(-2n);
    expect(rac(2n, -4n)).toEqual({ n: -1n, d: 2n });
  });
  it('porcentaje en puntos base medio arriba', () => {
    expect(bp(40_422n, 463_900n)).toBe(871n);
    expect(bp(-1n, 3n)).toBe(-3333n);
    expect(bp(1n, -3n)).toBe(-3333n);
    expect(() => bp(1n, 0n)).toThrow(RangeError);
  });
  it('estadistica', () => {
    expect(medianaNum([3, 1, 2])).toBe(2);
    expect(medianaNum([4, 1, 2, 3])).toBe(2.5);
    expect(() => medianaNum([])).toThrow(RangeError);
    expect(percentil([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6, 10);
    expect(() => percentil([], 0.5)).toThrow(RangeError);
    expect(mediaNum([2, 4])).toBe(3);
    expect(desvEstandar([5])).toBe(0);
    expect(desvEstandar([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(cmpTexto('a', 'b')).toBe(-1);
    expect(cmpTexto('b', 'a')).toBe(1);
    expect(cmpTexto('a', 'a')).toBe(0);
    expect(aBigRedondeado(2.5)).toBe(3n);
  });
  it('json canonico: llaves ordenadas, bigint como texto, indefinidos fuera', () => {
    expect(jsonCanonico({ b: 1n, a: [undefined, { z: 1, y: undefined }], c: null })).toBe('{"a":[null,{"z":1}],"b":"1","c":null}');
    expect(jsonCanonico(undefined)).toBe('null');
  });
});
