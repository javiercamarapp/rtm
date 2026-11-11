import { describe, expect, it } from 'vitest';
import { bigintACentavos, centavosABigint } from '@/dominio/operacion/json';

describe('centavos de la base a bigint', () => {
  it('convierte toda clave *_cent, anidada o en listas, y deja el resto igual', () => {
    const r = centavosABigint<{ total_cent: bigint; piezas: number; lineas: { precio_cent: bigint; sabor: string }[]; nulo_cent: null }>({
      total_cent: 1359000, piezas: 62, lineas: [{ precio_cent: 25000, sabor: 'Mango' }], nulo_cent: null,
    });
    expect(r.total_cent).toBe(1359000n);
    expect(r.piezas).toBe(62);
    expect(r.lineas[0]!.precio_cent).toBe(25000n);
    expect(r.nulo_cent).toBeNull();
  });
  it('un mapa bajo una clave *_cent (antiguedad_cent) convierte todos sus valores', () => {
    const r = centavosABigint<{ antiguedad_cent: Record<string, bigint> }>({ antiguedad_cent: { '0_7': 620000, mas_30: 0 } });
    expect(r.antiguedad_cent['0_7']).toBe(620000n);
    expect(r.antiguedad_cent['mas_30']).toBe(0n);
  });
  it('rechaza montos que no son enteros seguros', () => {
    expect(() => centavosABigint({ x_cent: 1.5 })).toThrow(RangeError);
    expect(() => centavosABigint({ x_cent: 2 ** 60 })).toThrow(RangeError);
  });
  it('ida y vuelta de un monto', () => {
    expect(bigintACentavos(9000_00n)).toBe(900000);
    expect(() => bigintACentavos(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });
});
