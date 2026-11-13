import { describe, expect, it } from 'vitest';
import { armarHojaProveedor, armarPosicionProveedor } from '@/dominio/operacion/posicion_proveedor';
import type { CuentaProveedor, HojaProveedor } from '@/dominio/operacion/tipos';

// Cifras SINTETICAS hechas a mano (centavos). Karen: costo de pedidos 2,260.00 y abonos 1,720.00 => se le debe 540.00.
const cuenta = (o: Partial<CuentaProveedor> & { proveedor: 'Isaac' | 'Karen' }): CuentaProveedor => ({
  id: 1, modalidad: 'semanal_viernes', saldo_cent: 0n, etiqueta: 'Saldo cero', puente_cent: 0n, posicion_cent: 0n, movimientos: [],
  posicion: { posicion_cent: 0n, se_debe_cent: 0n, a_favor_cent: 0n, cargos_cent: 0n, abonos_cent: 0n, desglose_cuadra: true, auxiliar_cent: 0n, cuadra_auxiliar: true },
  ...o,
});

const karen = cuenta({
  proveedor: 'Karen', modalidad: 'prepago_total', saldo_cent: 172_000n, etiqueta: 'A favor', posicion_cent: -54_000n,
  posicion: { posicion_cent: -54_000n, se_debe_cent: 54_000n, a_favor_cent: 0n, cargos_cent: 226_000n, abonos_cent: 172_000n, desglose_cuadra: true, auxiliar_cent: -54_000n, cuadra_auxiliar: true },
});

describe('posicion con el proveedor: una sola verdad', () => {
  it('Karen: se le debe aunque la cuenta corriente solo muestre abonos a favor (prepago)', () => {
    const v = armarPosicionProveedor(karen);
    expect(v.tono).toBe('debe');
    expect(v.titular).toBe('Se le debe a Karen $540.00');
    expect(v.monto).toBe('$540.00');
    expect(v.palabra).toBe('Se le debe');
    expect(v.desglose).toBe('Costo de pedidos y compras $2,260.00 − pagos y abonos $1,720.00 = se le debe $540.00');
    expect(v.anticipo).toBeNull();
    expect(v.cuadra).toBe(true);
    // la cuenta corriente se reconcilia con la posicion: 1,720.00 - 2,260.00 = -540.00
    expect(v.reconciliacion.texto).toContain('$1,720.00');
    expect(v.reconciliacion.otrosCargos).toBe('$2,260.00');
    expect(v.reconciliacion.posicion).toBe('−$540.00');
  });

  it('Isaac: el saldo de la cuenta corriente (-20.00) no compite con la posicion (-2,920.00)', () => {
    const v = armarPosicionProveedor(cuenta({
      proveedor: 'Isaac', saldo_cent: -2_000n, etiqueta: 'Se debe', posicion_cent: -292_000n,
      posicion: { posicion_cent: -292_000n, se_debe_cent: 292_000n, a_favor_cent: 0n, cargos_cent: 500_000n, abonos_cent: 208_000n, desglose_cuadra: true, auxiliar_cent: -292_000n, cuadra_auxiliar: true },
    }));
    expect(v.titular).toBe('Se le debe a Isaac $2,920.00');
    expect(v.reconciliacion.otrosCargos).toBe('$2,900.00');
    expect(v.desglose).toBe('Costo de pedidos y compras $5,000.00 − pagos y abonos $2,080.00 = se le debe $2,920.00');
  });

  it('a favor de la sociedad solo cuando de verdad es a favor, con el anticipo como detalle', () => {
    const v = armarPosicionProveedor(cuenta({
      proveedor: 'Karen', saldo_cent: 100_000n, posicion_cent: 31_000n,
      posicion: { posicion_cent: 31_000n, se_debe_cent: 0n, a_favor_cent: 31_000n, cargos_cent: 122_000n, abonos_cent: 153_000n, desglose_cuadra: true, auxiliar_cent: 31_000n, cuadra_auxiliar: true },
    }));
    expect(v.tono).toBe('favor');
    expect(v.titular).toBe('A favor de la sociedad con Karen $310.00');
    expect(v.anticipo).toContain('$310.00');
    expect(v.desglose).toContain('a favor $310.00');
  });

  it('saldo cero: no inventa signo ni anticipo', () => {
    const v = armarPosicionProveedor(cuenta({ proveedor: 'Isaac' }));
    expect(v.tono).toBe('cero');
    expect(v.titular).toBe('Saldo cero con Isaac');
    expect(v.anticipo).toBeNull();
  });

  it('si el libro y el auxiliar no coinciden, no se declara que cuadra', () => {
    const base = karen.posicion;
    expect(armarPosicionProveedor({ ...karen, posicion: { ...base, cuadra_auxiliar: false } }).cuadra).toBe(false);
    expect(armarPosicionProveedor({ ...karen, posicion: { ...base, desglose_cuadra: false } }).cuadra).toBe(false);
  });
});

const hoja = (t: Partial<HojaProveedor['totales']>, c: Partial<HojaProveedor['comprobaciones']> = {}): HojaProveedor => ({
  proveedor: 'Karen', modalidad: 'prepago_total', ambito: 'sociedad', semana_ini: '2026-11-09', semana_fin: '2026-11-13', desde: '2026-11-07', viernes_cerrado: true,
  renglones: [], abonos: [], ajustes: [], pagos_por_concepto_cent: {},
  totales: { saldo_anterior_cent: 0n, mercancia_cent: 0n, seguros_cent: 0n, guias_cent: 0n, costo_total_cent: 0n, pagos_cent: 0n, ajustes_cent: 0n, falta_por_saldar_cent: 0n, libro_al_corte_cent: 0n, diferencia_libro_cent: 0n, ...t },
  comprobaciones: { renglon_igual_detalle: true, renglones_igual_mercancia: true, mercancia_independiente_cent: 0n, renglones_igual_seguros: true, seguros_independiente_cent: 0n, guias_igual_envios: true, guias_independiente_cent: 0n, abonos_igual_depositos: true, depositos_independiente_cent: 0n, cuadra: true, libro_aplica: true, libro_igual_hoja: true, ...c },
  guias_pendientes: 0, conciliacion: null, cierre: null,
} as unknown as HojaProveedor);

describe('hoja semanal contra el libro', () => {
  it('saldo anterior a favor (310.00) + costo 1,040.00 - pagos 190.00 = se le debe 540.00 = libro', () => {
    const t = { saldo_anterior_cent: -31_000n, mercancia_cent: 104_000n, costo_total_cent: 104_000n, pagos_cent: 19_000n, falta_por_saldar_cent: 54_000n, libro_al_corte_cent: 54_000n };
    expect(t.saldo_anterior_cent + t.mercancia_cent - t.pagos_cent).toBe(t.falta_por_saldar_cent);
    const v = armarHojaProveedor(hoja(t));
    expect(v.cuadraConLibro).toBe(true);
    expect(v.sello).toBe('Cuadra con el libro');
    expect(v.saldoAnterior).toBe('A favor $310.00');
    expect(v.faltaTexto).toBe('Se le debe $540.00');
    expect(v.nota).toContain('$540.00');
  });

  it('si no cuadra con el libro, dice la diferencia', () => {
    const v = armarHojaProveedor(hoja({ falta_por_saldar_cent: 54_000n, libro_al_corte_cent: 56_500n, diferencia_libro_cent: 2_500n }, { libro_igual_hoja: false }));
    expect(v.cuadraConLibro).toBe(false);
    expect(v.sello).toBe('No cuadra con el libro: diferencia +$25.00');
    expect(v.nota).toContain('diferencia +$25.00');
  });

  it('con alcance "todo" no compara contra el libro de la sociedad', () => {
    const v = armarHojaProveedor(hoja({ diferencia_libro_cent: 9_000n }, { libro_aplica: false, libro_igual_hoja: false }));
    expect(v.cuadraConLibro).toBe(true);
    expect(v.sello).toBe('Incluye partidas de fuera de la sociedad');
  });
});
