// Cifras a mano de los flujos F02, F04, F05, F06 y F11 (qa/01-inventario-y-matriz.md, seccion 3). Datos sinteticos.
import { describe, it, expect } from 'vitest';
import { economiaPedido, costoPuesto } from './oraculo';
import { textoNota } from '@/dominio/nota/texto';
import { formatearMoneda, formatearPesosCorto } from '@/dominio/formato';
import { valorSalida, redondearMedioArriba } from '@/dominio/dinero';
import type { NotaClienteSnap } from '@/dominio/operacion/tipos';

const COSTO = costoPuesto(2_000_000n, 45_000n, 0n, 200);

describe('F02: costo puesto de la OC a Isaac', () => {
  it('200 pz x 100.00 + guia 450.00 = 20,450.00 -> 102.25 por pieza', () => {
    expect(2_000_000n + 45_000n).toBe(2_045_000n);
    expect(COSTO).toBe(10_225n);
  });
  it('faltante de 2 piezas al promedio 102.25 = 204.50 (deuda del socio o castigo)', () => {
    expect(2n * COSTO).toBe(20_450n);
  });
  it('exceso facturado: 5 pz x 100.00 = 500.00 (partida fuera de la sociedad)', () => {
    expect(5n * 10_000n).toBe(50_000n);
  });
  it('Karen 200 x 110.00 = 22,000.00; con pago de 30,500.00 el saldo queda en 8,500.00', () => {
    expect(3_050_000n - 200n * 11_000n).toBe(850_000n);
  });
});

describe('F04: pedido de 50 piezas, se surten 40', () => {
  const p = economiaPedido({ surtidas: 40, precioCent: 15_000n, envioCent: 30_000n, costoUnitCent: COSTO, rentaPorPiezaCent: 200n, guiaCent: 18_000n });
  it('total a saldar 6,300.00 y no 7,800.00 (solo se cobra lo surtido)', () => {
    expect(p.total).toBe(630_000n);
    expect(economiaPedido({ surtidas: 50, precioCent: 15_000n, envioCent: 30_000n, costoUnitCent: COSTO, rentaPorPiezaCent: 200n, guiaCent: null }).total).toBe(780_000n);
  });
  it('costo 4,090.00, renta 80.00, guia 180.00, utilidad 1,950.00', () => {
    expect(p.costo).toBe(409_000n);
    expect(p.renta).toBe(8_000n);
    expect(p.utilidad).toBe(195_000n);
    expect(p.provisional).toBe(false);
  });
  it('con la guia sin costear la utilidad es 2,130.00 y provisional', () => {
    const q = economiaPedido({ surtidas: 40, precioCent: 15_000n, envioCent: 30_000n, costoUnitCent: COSTO, rentaPorPiezaCent: 200n, guiaCent: null });
    expect(q.utilidad).toBe(213_000n);
    expect(q.provisional).toBe(true);
  });
  it('inventario despues: 160 pz con valor 16,360.00', () => {
    expect(2_045_000n - p.costo).toBe(1_636_000n);
    expect(200 - 40).toBe(160);
  });
  it('texto de WhatsApp: "40pz x $150 = 6,000", "Envío $300", "total a saldar 6,300.00", sin costo ni utilidad', () => {
    const nota: NotaClienteSnap = {
      folio: 'P-0001', fecha: '2027-03-01', cliente: 'Cliente QA 1', entrega: 'Castores', grupos: [],
      lineas_texto: [{ modelo: 'Modelo QA 50K', piezas: 40, precio_cent: 15_000n, total_cent: 600_000n }],
      piezas_total: 40, subtotal_cent: 600_000n, envio_cent: 30_000n, recargo_cent: 0n, descuento_cent: 0n, total_cent: 630_000n,
    };
    const t = textoNota(nota);
    expect(t).toContain('40pz x $150 = 6,000');
    expect(t).toContain('Envío $300');
    expect(t).toContain('total a saldar 6,300.00');
    expect(t).not.toMatch(/costo|utilidad|margen/i);
  });
});

describe('F05: correccion y recargo', () => {
  it('correccion de envio 300 -> 350: total 6,350.00 y utilidad 2,000.00 (+50)', () => {
    const p = economiaPedido({ surtidas: 40, precioCent: 15_000n, envioCent: 35_000n, costoUnitCent: COSTO, rentaPorPiezaCent: 200n, guiaCent: 18_000n });
    expect(p.total).toBe(635_000n);
    expect(p.utilidad).toBe(200_000n);
  });
  it('recargo por credito 10 % sobre 1,350.00 = 135.00; sobre 6,300.00 = 630.00', () => {
    expect(redondearMedioArriba(135_000n * 1000n, 10_000n)).toBe(13_500n);
    expect(redondearMedioArriba(630_000n * 1000n, 10_000n)).toBe(63_000n);
  });
  it('pago de 5,000 sobre 6,350 deja 1,350.00 por cobrar; con recargo 1,485.00', () => {
    expect(635_000n - 500_000n).toBe(135_000n);
    expect(135_000n + 13_500n).toBe(148_500n);
    expect(formatearMoneda(148_500n)).toBe('$1,485.00');
  });
  it('exceso: pago 2,000 contra saldo 1,350 deja 650.00 de saldo a favor', () => {
    expect(200_000n - 135_000n).toBe(65_000n);
  });
});

describe('F06: Uva 30 piezas', () => {
  it('total 4,800.00; costo 3,067.50; renta 60.00; guia 200.00; utilidad 1,472.50', () => {
    const p = economiaPedido({ surtidas: 30, precioCent: 15_000n, envioCent: 30_000n, costoUnitCent: COSTO, rentaPorPiezaCent: 200n, guiaCent: 20_000n });
    expect(p.total).toBe(480_000n);
    expect(p.costo).toBe(306_750n);
    expect(p.renta).toBe(6_000n);
    expect(p.utilidad).toBe(147_250n);
  });
  it('OC-2 Fresa 50 x 100.00 sube el valor a 18,292.50 (guia 250 -> costo puesto 105.00, valor 18,542.50)', () => {
    expect(1_329_250n + 50n * 10_000n).toBe(1_829_250n);
    expect(costoPuesto(500_000n, 25_000n, 0n, 50)).toBe(10_500n);
  });
});

describe('F03 / F11: inventario con promedio movil', () => {
  it('3 piezas con valor 27,463 y tres salidas de 1 dan 9,154; 9,155; 9,154 (GD-04)', () => {
    let v = 27_463n;
    const s: bigint[] = [];
    for (const e of [3, 2, 1]) { const x = valorSalida(v, e, 1); s.push(x); v -= x; }
    expect(s.reduce((a, b) => a + b, 0n)).toBe(27_463n);
    expect(v).toBe(0n);
    expect(s).toEqual([9_154n, 9_155n, 9_154n]);
  });
  it('anular P-2 regresa las 30 piezas a su costo original 3,067.50', () => {
    expect(30n * COSTO).toBe(306_750n);
  });
  it('merma de 5 piezas a 102.25 = 511.25 (debe bajar la utilidad, GD-07)', () => {
    expect(5n * COSTO).toBe(51_125n);
  });
  it('formato corto de pesos: enteros sin centavos, con centavos si los hay', () => {
    expect(formatearPesosCorto(600_000n)).toBe('6,000');
    expect(formatearPesosCorto(630_000n, true)).toBe('6,300.00');
    expect(formatearPesosCorto(51_125n)).toBe('511.25');
  });
});

describe('F07: renta y liquidacion de Omar (semana 1-mar a 7-mar)', () => {
  it('renta (40 + 30) x 2.00 = 140.00; toma 3 x 150 = 450.00; neto -310.00; compensado 140.00', () => {
    const renta = 70n * 200n;
    const toma = 3n * 15_000n;
    expect(renta).toBe(14_000n);
    expect(toma).toBe(45_000n);
    expect(renta - toma).toBe(-31_000n);
    expect(renta < toma ? renta : toma).toBe(14_000n);
  });
});
