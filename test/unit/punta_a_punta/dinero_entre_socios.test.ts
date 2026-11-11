// Invariantes y casos dorados del dinero entre socios (CLAUDE.md, adendas 21 y 31). Cifras a mano, no salidas del codigo.
// Se comparan contra el oraculo de la especificacion; las mismas cifras estan en pgTAP 906.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { aplicarGastosDeSocio, cascada, por, repartirProporcional, suma } from './oraculo';

describe('gasto de socio: se descuenta UNA sola vez', () => {
  it('utilidad antes de gastos 20,000; gastos Javier 2,221 y Angelo 500 -> utilidad neta 17,279', () => {
    const r = aplicarGastosDeSocio(2_000_000n, por(50_000, 222_100));
    expect(r.utilidadNeta).toBe(1_727_900n);
    expect(r.reembolsos).toEqual(por(50_000, 222_100));
  });

  it('8,639.50 a cada socio mas sus reembolsos; efectivo 20,000 repartido completo', () => {
    const g = aplicarGastosDeSocio(2_000_000n, por(50_000, 222_100));
    const c = cascada({ utilidad: g.utilidadNeta, caja: 0n, reembolsos: g.reembolsos, aportaciones: por(0, 0), poder: por(1_000_000, 1_000_000), deuda: por(1_000_000, 1_000_000) });
    expect(c.parte).toEqual(por(863_950, 863_950));
    expect(c.asignado).toEqual(por(50_000 + 863_950, 222_100 + 863_950));
    expect(c.repartible).toBe(1_727_900n);
    expect(c.remanente).toBe(0n);
    // Angelo: 500 + 8,639.50 - 10,000 = -860.50 ; Javier: 2,221 + 8,639.50 - 10,000 = +860.50
    expect(c.resultado).toEqual(por(-86_050, 86_050));
    expect(c.liquidar).toEqual({ de: 'Angelo', a: 'Javier', monto: 86_050n });
    expect(suma(c.asignado)).toBe(c.efectivo);
  });

  it('el doble descuento (gasto de envio ya incluido en la guia del pedido) seria 1,000 y no 500', () => {
    const una = aplicarGastosDeSocio(1_000_000n, por(50_000, 0)).utilidadNeta;
    expect(1_000_000n - una).toBe(50_000n);
  });
});

describe('ejemplo de la adenda 21: utilidad 12,000', () => {
  const base = { utilidad: 1_200_000n, caja: 0n, reembolsos: por(50_000, 122_100), aportaciones: por(0, 100_000), poder: por(800_000, 672_100), deuda: por(800_000, 672_100) };
  it('Angelo 6,500 / Javier 8,221, Angelo devuelve 1,500', () => {
    const c = cascada(base);
    expect(c.efectivo).toBe(1_472_100n);
    expect(c.repartible).toBe(1_200_000n);
    expect(c.asignado).toEqual(por(650_000, 822_100));
    expect(c.resultado).toEqual(por(-150_000, 150_000));
    expect(c.liquidar).toEqual({ de: 'Angelo', a: 'Javier', monto: 150_000n });
    expect(c.remanente).toBe(0n);
  });
  it('ejemplo B1 (utilidad antes que capital): efectivo 13,000 -> 11,279 repartible, 5,639.50 cada uno', () => {
    const c = cascada({ ...base, poder: por(800_000, 500_000), deuda: por(800_000, 500_000), aportacionesAntes: false });
    expect(c.repartible).toBe(1_127_900n);
    expect(c.parte).toEqual(por(563_950, 563_950));
    expect(c.resultado).toEqual(por(50_000 + 563_950 - 800_000, 122_100 + 563_950 - 500_000));
    expect(c.resultado.Angelo).toBe(-186_050n);
  });
  it('ejemplo B2 (devolver antes): repartible 10,279, 5,139.50 cada uno, Angelo -2,360.50', () => {
    const c = cascada({ ...base, poder: por(800_000, 500_000), deuda: por(800_000, 500_000) });
    expect(c.repartible).toBe(1_027_900n);
    expect(c.parte).toEqual(por(513_950, 513_950));
    expect(c.resultado).toEqual(por(-236_050, 236_050));
  });
  it('ejemplo C efectivo insuficiente 2,000: reembolsos 1,721, aportacion parcial 279, repartible 0', () => {
    const c = cascada({ ...base, poder: por(0, 200_000), deuda: por(0, 0), caja: 0n });
    expect(suma(c.pagadoReembolso)).toBe(172_100n);
    expect(suma(c.pagadoAportacion)).toBe(27_900n);
    expect(c.repartible).toBe(0n);
    expect(c.limitadoPorEfectivo).toBe(true);
    expect(c.pagadoReembolso).toEqual(por(50_000, 122_100));
  });
  it('ejemplo D utilidad negativa: nada que repartir y el efectivo se queda', () => {
    const c = cascada({ utilidad: -300_000n, caja: 500_000n, reembolsos: por(0, 0), aportaciones: por(0, 0), poder: por(0, 0), deuda: por(0, 0) });
    expect(c.repartible).toBe(0n);
    expect(c.remanente).toBe(500_000n);
    expect(c.liquidar).toBeNull();
  });
  it('ejemplo E centavo suelto: utilidad 1,000.01 sin pendientes -> 500.01 y 500.00 (desempate alfabetico, regla E pendiente)', () => {
    const c = cascada({ utilidad: 100_001n, caja: 100_001n, reembolsos: por(0, 0), aportaciones: por(0, 0), poder: por(0, 0), deuda: por(0, 0) });
    expect(suma(c.parte)).toBe(100_001n);
    expect([c.parte.Angelo, c.parte.Javier].sort()).toEqual([50_000n, 50_001n]);
  });
});

describe('identidad: suma de saldos de socios = efectivo repartido (propiedad)', () => {
  const m = fc.bigInt({ min: 0n, max: 5_000_000n });
  it('en 500 casos: asignado + remanente = efectivo, remanente >= 0, nadie negativo, suma de resultados = asignado - deuda', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000n, max: 5_000_000n }), m, m, m, m, m, m, m, m, fc.boolean(), (u, caja, ra, rj, ca, cj, pa, pj, _x, antes) => {
        const c = cascada({ utilidad: u, caja, reembolsos: por(ra, rj), aportaciones: por(ca, cj), poder: por(pa, pj), deuda: por(pa, pj), aportacionesAntes: antes });
        expect(suma(c.asignado) + c.remanente).toBe(c.efectivo);
        expect(c.remanente >= 0n).toBe(true);
        expect(c.asignado.Angelo >= 0n && c.asignado.Javier >= 0n).toBe(true);
        expect(c.repartible <= (u > 0n ? u : 0n)).toBe(true);
        expect(suma(c.resultado)).toBe(suma(c.asignado) - (pa + pj));
        // nadie recibe mas reembolso que lo pendiente
        expect(c.pagadoReembolso.Angelo <= ra && c.pagadoReembolso.Javier <= rj).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
  it('repartir_proporcional no pierde ni inventa centavos', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10_000_000n }), fc.bigInt({ min: 0n, max: 9_000_000n }), fc.bigInt({ min: 1n, max: 9_000_000n }), (t, a, j) => {
        expect(suma(repartirProporcional(t, por(a, j)))).toBe(t);
      }),
    );
  });
});

describe('pendientes de decision del dueño (ESPERADO-FALLA-HASTA: H1/H2 de la auditoria 01)', () => {
  // Estas pruebas describen el comportamiento correcto segun las preguntas 2 y 3; el oraculo actual NO las cumple a proposito.
  it.fails('G1 retiro previo: Angelo retiro 5,000 antes; utilidad 12,000 sin fondos -> Angelo 1,000, Javier 6,000 (pregunta 2)', () => {
    const c = cascada({ utilidad: 1_200_000n, caja: 1_200_000n, reembolsos: por(0, 0), aportaciones: por(0, 0), poder: por(0, 0), deuda: por(0, 0) });
    expect(c.asignado).toEqual(por(100_000, 600_000));
  });
  it.fails('G3 perdida arrastrada: S1 -6,000 y S2 +5,000 con efectivo de sobra -> repartible 0 (pregunta 3)', () => {
    const c = cascada({ utilidad: 500_000n, caja: 9_000_000n, reembolsos: por(0, 0), aportaciones: por(0, 0), poder: por(0, 0), deuda: por(0, 0) });
    expect(c.repartible).toBe(0n);
  });
});
