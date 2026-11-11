import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asientoCuadra, invertir, saldoNatural, sumas, validarAsiento, type LineaPropuesta } from '@/dominio/contabilidad/asiento';

const L = (cuenta: string, debe: bigint, haber: bigint): LineaPropuesta => ({ cuenta, debe_cent: debe, haber_cent: haber });

describe('asiento de partida doble (validacion pura)', () => {
  it('la compra inicial cuadra: Dr 1310 140,615.00 contra 84,615.00 y 56,000.00 de capital', () => {
    const a = [L('1310', 14061500n, 0n), L('3110', 0n, 8461500n), L('3120', 0n, 5600000n)];
    expect(validarAsiento(a)).toEqual([]);
    expect(sumas(a)).toEqual({ debe_cent: 14061500n, haber_cent: 14061500n });
  });
  it('la venta del ejemplo cuadra con costo 9,154.62 y renta de 200.00', () => {
    const a = [L('1210', 1500000n, 0n), L('4110', 0n, 1500000n), L('5100', 915462n, 0n), L('1310', 0n, 915462n), L('6110', 20000n, 0n), L('2210', 0n, 20000n)];
    expect(asientoCuadra(a)).toBe(true);
  });
  it('rechaza un asiento descuadrado y dice por cuanto', () => {
    const e = validarAsiento([L('1101', 100n, 0n), L('3990', 0n, 90n)]);
    expect(e).toContainEqual({ tipo: 'descuadre', debe_cent: 100n, haber_cent: 90n });
  });
  it('rechaza una linea con debe y haber a la vez, sin lado, negativa, con cuenta mal escrita o un asiento de una sola linea', () => {
    expect(validarAsiento([L('1101', 5n, 5n), L('3990', 0n, 0n)]).map((x) => x.tipo)).toEqual(expect.arrayContaining(['debe_y_haber']));
    expect(validarAsiento([L('1101', -5n, 0n), L('3990', 0n, -5n)]).map((x) => x.tipo)).toContain('monto_negativo');
    expect(validarAsiento([L('110', 5n, 0n), L('3990', 0n, 5n)]).map((x) => x.tipo)).toContain('cuenta_invalida');
    expect(validarAsiento([L('1101', 5n, 0n)]).map((x) => x.tipo)).toContain('pocas_lineas');
  });
  it('el saldo se da en la naturaleza de la cuenta', () => {
    expect(saldoNatural('D', 500n, 200n)).toBe(300n);
    expect(saldoNatural('A', 200n, 500n)).toBe(300n);
  });

  const montos = fc.bigInt({ min: 1n, max: 10_000_000_000n });
  const cuenta = fc.integer({ min: 1000, max: 7999 }).map(String);
  // Un asiento valido cualquiera: n lineas al debe y una al haber por el total, o al reves, con residuo exacto.
  const asientoValido = fc.tuple(fc.array(fc.tuple(cuenta, montos), { minLength: 1, maxLength: 8 }), cuenta, fc.boolean()).map(([partes, contra, alDebe]) => {
    const total = partes.reduce((s, [, m]) => s + m, 0n);
    const lados = partes.map(([c, m]) => (alDebe ? L(c, m, 0n) : L(c, 0n, m)));
    return [...lados, alDebe ? L(contra, 0n, total) : L(contra, total, 0n)];
  });

  it('propiedad: todo asiento armado con un contra-asiento exacto cuadra', () => {
    fc.assert(fc.property(asientoValido, (a) => validarAsiento(a).length === 0), { numRuns: 400 });
  });
  it('propiedad: invertir un asiento valido sigue cuadrando y volver a invertirlo da el original', () => {
    fc.assert(fc.property(asientoValido, (a) => asientoCuadra(invertir(a)) && JSON.stringify(invertir(invertir(a)), (_, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v))), { numRuns: 300 });
  });
  it('propiedad: mover un solo centavo de un lado rompe el cuadre', () => {
    fc.assert(
      fc.property(asientoValido, (a) => {
        const roto = a.map((l, i) => (i === 0 ? { ...l, debe_cent: l.debe_cent > 0n ? l.debe_cent + 1n : l.debe_cent, haber_cent: l.haber_cent > 0n ? l.haber_cent + 1n : l.haber_cent } : l));
        return !asientoCuadra(roto);
      }),
      { numRuns: 300 },
    );
  });
});
