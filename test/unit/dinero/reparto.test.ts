import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cascadaCalcular, repartirProporcional, type EntradaCascada, type Mapa } from '@/dominio/dinero/reparto';

// Casos dorados de la auditoria 01 (dinero entre socios) y del dueno (11-nov). Cifras en centavos, escritas a mano; son las mismas de
// supabase/tests/database/015_dinero_socios_cascada.test.sql: SQL y TypeScript deben dar exactamente lo mismo.
const A = 'Angelo';
const J = 'Javier';
const ppm: Mapa = { [A]: 500_000n, [J]: 500_000n };
const cero: Mapa = { [A]: 0n, [J]: 0n };
const base = (o: Partial<EntradaCascada>): EntradaCascada => ({
  utilidad: 0n, arrastre: 0n, caja: 0n, comprometido: 0n, reembolsos: cero, aportaciones: cero, poder: cero, deuda: cero, anticipos: cero, ppm, rotor: 0, ...o,
});

describe('ejemplo del dueno: utilidad antes de gastos 20,000; Javier pago 2,221 y Angelo 500', () => {
  // Utilidad neta 17,279; 8,639.50 para cada uno; ademas Javier recibe 2,221 y Angelo 500 de reembolso.
  const r = cascadaCalcular(base({ utilidad: 1_727_900n, caja: 2_000_000n, reembolsos: { [A]: 50_000n, [J]: 222_100n } }));
  it('reparte 8,639.50 a cada uno', () => {
    expect(r.repartible).toBe(1_727_900n);
    expect(r.porSocio[A]?.utilidad).toBe(863_950n);
    expect(r.porSocio[J]?.utilidad).toBe(863_950n);
  });
  it('reembolsa 500 a Angelo y 2,221 a Javier antes de repartir', () => {
    expect(r.porSocio[A]?.pagaReembolso).toBe(50_000n);
    expect(r.porSocio[J]?.pagaReembolso).toBe(222_100n);
    expect(r.porSocio[A]?.asignado).toBe(913_950n);
    expect(r.porSocio[J]?.asignado).toBe(1_086_050n);
    expect(r.remanente).toBe(0n);
    expect(r.identidad.cuadra).toBe(true);
  });
});

describe('adenda 21: utilidad 12,000; Angelo tiene 8,000 y Javier 6,721 de la sociedad', () => {
  const r = cascadaCalcular(base({
    utilidad: 1_200_000n, reembolsos: { [A]: 50_000n, [J]: 222_100n }, poder: { [A]: 800_000n, [J]: 672_100n }, deuda: { [A]: 800_000n, [J]: 672_100n },
  }));
  it('le corresponde a Angelo 6,500 y a Javier 8,221', () => {
    expect(r.efectivoTotal).toBe(1_472_100n);
    expect(r.porSocio[A]?.asignado).toBe(650_000n);
    expect(r.porSocio[J]?.asignado).toBe(822_100n);
  });
  it('Angelo devuelve 1,500 a Javier y quedan en paz', () => {
    expect(r.porSocio[A]?.resultado).toBe(-150_000n);
    expect(r.porSocio[J]?.resultado).toBe(150_000n);
    expect(r.liquidar).toEqual({ de: A, a: J, monto: 150_000n });
    expect(r.remanente).toBe(0n);
    expect(r.identidad.cuadra).toBe(true);
  });
});

describe('G1 retiro previo (H1): utilidad 12,000 y Angelo ya retiro 5,000', () => {
  it('Angelo 1,000, Javier 6,000, quedan 5,000 en la caja', () => {
    const r = cascadaCalcular(base({ utilidad: 1_200_000n, caja: 1_200_000n, anticipos: { [A]: 500_000n, [J]: 0n } }));
    expect(r.repartible).toBe(1_200_000n);
    expect(r.porSocio[A]?.asignado).toBe(100_000n);
    expect(r.porSocio[J]?.asignado).toBe(600_000n);
    expect(r.remanente).toBe(500_000n);
    expect(r.identidad.cuadra).toBe(true);
  });
});

describe('G2 utilidad retenida (H2)', () => {
  it('semana 1: utilidad 10,000 y efectivo 3,000 reparten 3,000 y arrastran 7,000; semana 2 reparte 9,000', () => {
    const s1 = cascadaCalcular(base({ utilidad: 1_000_000n, caja: 300_000n }));
    expect(s1.repartible).toBe(300_000n);
    expect(s1.arrastreFin).toBe(700_000n);
    const s2 = cascadaCalcular(base({ utilidad: 200_000n, arrastre: s1.arrastreFin, caja: 900_000n }));
    expect(s2.repartible).toBe(900_000n);
    expect(s2.arrastreFin).toBe(0n);
  });
});

describe('G3 perdida arrastrada (H2, regla D)', () => {
  it('semana 1 -6,000, semana 2 +5,000: reparte 0 y arrastra -1,000', () => {
    const s1 = cascadaCalcular(base({ utilidad: -600_000n, caja: 1_000_000n }));
    expect(s1.repartible).toBe(0n);
    expect(s1.arrastreFin).toBe(-600_000n);
    const s2 = cascadaCalcular(base({ utilidad: 500_000n, arrastre: s1.arrastreFin, caja: 1_000_000n }));
    expect(s2.repartible).toBe(0n);
    expect(s2.arrastreFin).toBe(-100_000n);
  });
});

describe('G4 perdida con capital desigual (H4)', () => {
  it('el capital no se devuelve solo; la perdida se absorbe 50/50 contra las utilidades siguientes', () => {
    const cap: Mapa = { [A]: 7_000_000n, [J]: 3_000_000n };
    const s1 = cascadaCalcular(base({ utilidad: -1_000_000n, caja: 9_000_000n, aportaciones: cap }));
    expect(s1.repartible).toBe(0n);
    expect(s1.arrastreFin).toBe(-1_000_000n);
    expect(s1.remanente).toBe(9_000_000n);
    expect(s1.porSocio[A]?.asignado).toBe(0n);
    const s2 = cascadaCalcular(base({ utilidad: 1_000_000n, arrastre: s1.arrastreFin, caja: 9_000_000n, aportaciones: cap }));
    expect(s2.repartible).toBe(0n);
    expect(s2.arrastreFin).toBe(0n);
  });
});

describe('G12 y G13 efectivo comprometido (H3)', () => {
  it('G12: el anticipo de un cliente en la cuenta de Angelo no es efectivo repartible', () => {
    const r = cascadaCalcular(base({ utilidad: 1_000_000n, poder: { [A]: 900_000n, [J]: 0n }, deuda: { [A]: 900_000n, [J]: 0n }, comprometido: 900_000n }));
    expect(r.disponible).toBe(0n);
    expect(r.repartible).toBe(0n);
    expect(r.limitadoPorEfectivo).toBe(true);
  });
  it('G13: caja 20,000, se debe 18,000 a proveedores y utilidad 10,000: se reparten 2,000', () => {
    const r = cascadaCalcular(base({ utilidad: 1_000_000n, caja: 2_000_000n, comprometido: 1_800_000n }));
    expect(r.repartible).toBe(200_000n);
    expect(r.porSocio[A]?.utilidad).toBe(100_000n);
  });
  it('sin efectivo se pagan primero los reembolsos y no se reparte utilidad', () => {
    const r = cascadaCalcular(base({ utilidad: 1_000_000n, caja: 100_000n, reembolsos: { [A]: 150_000n, [J]: 0n } }));
    expect(r.pagadoReembolsos).toBe(100_000n);
    expect(r.repartible).toBe(0n);
  });
});

describe('G14 redondeo unico (E)', () => {
  it('el centavo suelto rota entre periodos cuando nadie paga ni aporta', () => {
    const p0 = cascadaCalcular(base({ utilidad: 100_001n, caja: 100_001n, rotor: 0 }));
    const p1 = cascadaCalcular(base({ utilidad: 100_001n, caja: 100_001n, rotor: 1 }));
    expect([p0.porSocio[A]?.utilidad, p0.porSocio[J]?.utilidad]).toEqual([50_001n, 50_000n]);
    expect([p1.porSocio[A]?.utilidad, p1.porSocio[J]?.utilidad]).toEqual([50_000n, 50_001n]);
  });
  it('a favor de quien paga: Javier con reembolso pendiente se queda el centavo en cualquier periodo', () => {
    for (const rotor of [0, 1, 2, 3]) {
      const r = cascadaCalcular(base({ utilidad: 100_001n, caja: 100_501n, reembolsos: { [A]: 0n, [J]: 500n }, rotor }));
      expect(r.porSocio[J]?.utilidad).toBe(50_001n);
      expect(r.porSocio[A]?.utilidad).toBe(50_000n);
    }
  });
  it('tres socios simulados suman exacto', () => {
    const t = repartirProporcional(100_000n, { A: 333_333n, B: 333_333n, C: 333_334n });
    expect(t).toEqual({ A: 33_334n, B: 33_333n, C: 33_333n });
    expect(Object.values(t).reduce((a, b) => a + b, 0n)).toBe(100_000n);
  });
  it('propiedad: se reparte siempre exactamente el total y nadie se aparta de su parte por mas de un centavo', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.integer({ min: 0, max: 5000 }), (total, rotor) => {
        const r = repartirProporcional(total, ppm, cero, rotor);
        const s = (r[A] ?? 0n) + (r[J] ?? 0n);
        const d = (r[A] ?? 0n) - (r[J] ?? 0n);
        return s === total && (d === 0n || d === 1n || d === -1n);
      }),
    );
  });
});

describe('G16 identidad real (H8)', () => {
  it('con un faltante de 1,098.55 que no es efectivo, la identidad cuadra por dos vias y lo declara aparte', () => {
    const r = cascadaCalcular(base({ utilidad: 1_000_000n, caja: 1_000_000n, deuda: { [A]: 109_855n, [J]: 0n } }));
    expect(r.sumaAsignada).toBe(1_000_000n);
    expect(r.sumaResultados).toBe(890_145n);
    expect(r.identidad.deudaNoEfectivo).toBe(109_855n);
    expect(r.identidad.via1).toBe(r.identidad.via2);
    expect(r.identidad.cuadra).toBe(true);
  });
  it('propiedad: la identidad cuadra y nada queda negativo en 500 casos', () => {
    const m = fc.bigInt({ min: 0n, max: 3_000_000n });
    fc.assert(
      fc.property(fc.bigInt({ min: -500_000n, max: 4_000_000n }), m, m, m, m, m, fc.integer({ min: 0, max: 900 }), (u, caja, ra, rj, pa, pj, rotor) => {
        const r = cascadaCalcular(base({ utilidad: u, caja, reembolsos: { [A]: ra, [J]: rj }, poder: { [A]: pa, [J]: pj }, deuda: { [A]: pa, [J]: pj }, rotor }));
        return r.identidad.cuadra && r.remanente >= 0n && r.repartible >= 0n && r.repartible <= (u > 0n ? u : 0n) && Object.values(r.porSocio).every((s) => s.asignado >= 0n);
      }),
      { numRuns: 500 },
    );
  });
});
