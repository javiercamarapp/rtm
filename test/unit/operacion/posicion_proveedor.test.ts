import { describe, expect, it } from 'vitest';
import { armarHojaProveedor, armarPosicionProveedor } from '@/dominio/operacion/posicion_proveedor';
import type { CuentaProveedor, HojaProveedor, PosicionDetalle } from '@/dominio/operacion/tipos';

// Cifras SINTETICAS hechas a mano (centavos). Karen: costo de pedidos 2,260.00 y abonos 1,720.00 => total con Karen 540.00 que se le debe.
type Det = PosicionDetalle;
const det = (libro: bigint, o: Partial<Det> = {}): Det => {
  const pend = o.menudeo_pendiente_cent ?? 0n;
  const emp = libro + pend;
  return {
    posicion_cent: libro, se_debe_cent: libro < 0n ? -libro : 0n, a_favor_cent: libro > 0n ? libro : 0n, cargos_cent: 0n, abonos_cent: 0n, desglose_cuadra: true, auxiliar_cent: libro, cuadra_auxiliar: true,
    menudeo_pedidos: 0, menudeo_costo_cent: 0n, menudeo_pagado_cent: 0n, menudeo_pendiente_cent: 0n, menudeo_vencido_cent: 0n,
    posicion_empresa_cent: emp, deuda_empresa_cent: emp < 0n ? -emp : 0n, a_favor_empresa_cent: emp > 0n ? emp : 0n, ...o,
  };
};
const cuenta = (o: Partial<CuentaProveedor> & { proveedor: 'Isaac' | 'Karen'; posicion: Det }): CuentaProveedor => ({
  id: 1, modalidad: 'semanal_viernes', saldo_cent: 0n, etiqueta: 'Saldo cero', puente_cent: 0n, posicion_cent: o.posicion.posicion_cent, movimientos: [], ...o,
});

const karen = cuenta({ proveedor: 'Karen', modalidad: 'prepago_total', saldo_cent: 172_000n, etiqueta: 'A favor', posicion: det(-54_000n, { cargos_cent: 226_000n, abonos_cent: 172_000n }) });

describe('posicion con el proveedor: una sola verdad', () => {
  it('Karen: la deuda de la empresa es la del libro aunque la cuenta corriente solo muestre abonos a favor (prepago)', () => {
    const v = armarPosicionProveedor(karen);
    expect(v.tono).toBe('debe');
    expect(v.titular).toBe('Deuda de la empresa con Karen $540.00');
    expect(v.monto).toBe('$540.00');
    expect(v.palabra).toBe('Deuda de la empresa');
    expect(v.desglose).toBe('Costo de pedidos y compras $2,260.00 − pagos y abonos $1,720.00 = total con Karen según el libro se le debe $540.00');
    expect(v.anticipo).toBeNull();
    expect(v.cuadra).toBe(true);
    expect(v.conciliacionLibro).toBeNull();
    expect(v.reconciliacion.texto).toContain('$1,720.00');
    expect(v.reconciliacion.otrosCargos).toBe('$2,260.00');
    expect(v.reconciliacion.posicion).toBe('−$540.00');
  });

  it('Isaac: pedido de Angelo pendiente (668.00) NO suma a la deuda de la empresa: libro 2,945.00 = empresa 2,277.00 + Angelo 668.00', () => {
    const v = armarPosicionProveedor(cuenta({
      proveedor: 'Isaac', saldo_cent: -2_000n, etiqueta: 'Se debe',
      posicion: det(-294_500n, { cargos_cent: 500_000n, abonos_cent: 205_500n, menudeo_pedidos: 1, menudeo_costo_cent: 66_800n, menudeo_pagado_cent: 0n, menudeo_pendiente_cent: 66_800n }),
    }));
    expect(v.titular).toBe('Deuda de la empresa con Isaac $2,277.00');
    expect(v.totalLibro).toBe('Se le debe $2,945.00');
    expect(v.pedidosSocio).toEqual({ hay: true, pendiente: '$668.00', pagado: '$0.00', costo: '$668.00', pedidos: 1 });
    expect(v.conciliacionLibro).toBe('Total con Isaac según el libro $2,945.00 = deuda de la empresa $2,277.00 + pedidos de Angelo pendientes $668.00');
    expect(v.reconciliacion.otrosCargos).toBe('$2,925.00');
  });

  it('Karen con un pedido de Angelo ya pagado: nada pendiente, la deuda de la empresa es el total del libro', () => {
    const v = armarPosicionProveedor(cuenta({ proveedor: 'Karen', posicion: det(-5_325n, { menudeo_pedidos: 1, menudeo_costo_cent: 2_450n, menudeo_pagado_cent: 2_450n }) }));
    expect(v.titular).toBe('Deuda de la empresa con Karen $53.25');
    expect(v.pedidosSocio.pagado).toBe('$24.50');
    expect(v.conciliacionLibro).toBe('Total con Karen según el libro $53.25 = deuda de la empresa $53.25 + pedidos de Angelo pendientes $0.00');
  });

  it('a favor de la sociedad solo cuando de verdad es a favor, con el anticipo como detalle', () => {
    const v = armarPosicionProveedor(cuenta({ proveedor: 'Karen', saldo_cent: 100_000n, posicion: det(31_000n, { cargos_cent: 122_000n, abonos_cent: 153_000n }) }));
    expect(v.tono).toBe('favor');
    expect(v.titular).toBe('A favor de la sociedad con Karen $310.00');
    expect(v.anticipo).toContain('$310.00');
  });

  it('saldo cero: no inventa signo ni anticipo', () => {
    const v = armarPosicionProveedor(cuenta({ proveedor: 'Isaac', posicion: det(0n) }));
    expect(v.tono).toBe('cero');
    expect(v.titular).toBe('Saldo cero con Isaac');
    expect(v.anticipo).toBeNull();
  });

  it('si el libro y el auxiliar no coinciden, no se declara que cuadra', () => {
    expect(armarPosicionProveedor({ ...karen, posicion: { ...karen.posicion, cuadra_auxiliar: false } }).cuadra).toBe(false);
    expect(armarPosicionProveedor({ ...karen, posicion: { ...karen.posicion, desglose_cuadra: false } }).cuadra).toBe(false);
  });
});

const hoja = (t: Partial<HojaProveedor['totales']>, c: Partial<HojaProveedor['comprobaciones']> = {}): HojaProveedor => ({
  proveedor: 'Karen', modalidad: 'prepago_total', ambito: 'sociedad', semana_ini: '2026-11-09', semana_fin: '2026-11-13', desde: '2026-11-07', viernes_cerrado: true,
  renglones: [], abonos: [], ajustes: [], pagos_por_concepto_cent: {},
  totales: { saldo_anterior_cent: 0n, mercancia_cent: 0n, seguros_cent: 0n, guias_cent: 0n, costo_total_cent: 0n, pagos_cent: 0n, ajustes_cent: 0n, falta_por_saldar_cent: 0n, libro_al_corte_cent: 0n, diferencia_libro_cent: 0n, menudeo_pendiente_cent: 0n, deuda_empresa_cent: 0n, menudeo_vigente: true, ...t },
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

  it('separa los pedidos de Angelo pendientes en la semana en curso: falta 2,945.00 = empresa 2,277.00 + Angelo 668.00', () => {
    const v = armarHojaProveedor(hoja({ falta_por_saldar_cent: 294_500n, libro_al_corte_cent: 294_500n, menudeo_pendiente_cent: 66_800n, deuda_empresa_cent: 227_700n }));
    expect(v.separacion).toBe('Falta por saldar $2,945.00 = deuda de la empresa $2,277.00 + pedidos de Angelo pendientes $668.00');
    expect(v.deudaEmpresaTexto).toBe('$2,277.00');
  });

  it('en una semana pasada no se separa (el pendiente de Angelo es el de hoy)', () => {
    const v = armarHojaProveedor(hoja({ falta_por_saldar_cent: 294_500n, menudeo_pendiente_cent: 66_800n, deuda_empresa_cent: 227_700n, menudeo_vigente: false }));
    expect(v.separacion).toBeNull();
  });
});
