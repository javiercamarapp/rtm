import { describe, expect, it } from 'vitest';
import { cifraExplicable, comprobarLiquidacion, estadoPago, explicarCifraOmar, pagosRecibidos, proyectarSemana, rentaAcumulada, rentaPorDia, resumenSemana, saldoAcumulado, tarifaPorPieza } from '@/dominio/omar/cuenta';
import { CUENTA, LIQUIDACIONES, PAQUETES } from './fixtures';

const SEM = '2026-11-09';

describe('resumen de la semana', () => {
  it('suma renta, tomas y pagos de la semana lunes a domingo', () => {
    const r = resumenSemana(CUENTA, SEM);
    expect(r.renta_cent).toBe(4000n);
    expect(r.renta_piezas).toBe(20);
    expect(r.tomas_cent).toBe(45000n);
    expect(r.recibido_cent).toBe(3000n);
    expect(r.semana_fin).toBe('2026-11-15');
  });
  it('la renta acumulada incluye semanas anteriores', () => {
    expect(rentaAcumulada(CUENTA)).toEqual({ piezas: 30, cent: 6000n });
  });
  it('agrupa la renta por dia, sin pedidos, y marca los ajustes', () => {
    expect(rentaPorDia(CUENTA, SEM)).toEqual([
      { fecha: '2026-11-09', piezas: 20, importe: 4000n, ajuste: false },
      { fecha: '2026-11-10', piezas: 0, importe: 0n, ajuste: true },
    ]);
  });
  it('historial de pagos mas reciente primero', () => {
    expect(pagosRecibidos(CUENTA).map((p) => p.referencia)).toEqual(['PO-0001']);
  });
});

describe('liquidacion', () => {
  it('estado de pago: pendiente, parcial, pagada, sin saldo', () => {
    expect(estadoPago({ neto_cent: 2000n, pagado_cent: 0n })).toEqual({ estado: 'pendiente', falta_cent: 2000n });
    expect(estadoPago({ neto_cent: 2000n, pagado_cent: 500n })).toEqual({ estado: 'parcial', falta_cent: 1500n });
    expect(estadoPago({ neto_cent: 2000n, pagado_cent: 2000n })).toEqual({ estado: 'pagada', falta_cent: 0n });
    expect(estadoPago({ neto_cent: 0n, pagado_cent: 0n }).estado).toBe('sin_saldo');
  });
  it('si Omar debe, lo que el paga (negativo) reduce lo que falta', () => {
    expect(estadoPago({ neto_cent: -1000n, pagado_cent: 0n })).toEqual({ estado: 'pendiente', falta_cent: 1000n });
    expect(estadoPago({ neto_cent: -1000n, pagado_cent: -400n })).toEqual({ estado: 'parcial', falta_cent: 600n });
    expect(estadoPago({ neto_cent: -1000n, pagado_cent: -1000n }).estado).toBe('pagada');
  });
  it('comprobacion: renta menos tomas mas compensado igual al neto guardado', () => {
    expect(comprobarLiquidacion(LIQUIDACIONES[0]!)).toEqual({ via1: 2000n, via2: 2000n, cuadra: true });
    expect(comprobarLiquidacion({ ...LIQUIDACIONES[0]!, neto_cent: 1n }).cuadra).toBe(false);
  });
  it('saldo acumulado = liquidado menos pagado', () => {
    expect(saldoAcumulado([...LIQUIDACIONES, { ...LIQUIDACIONES[0]!, folio: 'L-0002', neto_cent: 1000n, pagado_cent: 400n }])).toEqual({ saldo_cent: 2600n, neto_total_cent: 3000n, pagado_total_cent: 400n });
  });
});

describe('proyeccion (siempre Estimado)', () => {
  const cfg = { renta_por_pieza_cent: 200n };
  it('devengado mas piezas por enviar a la tarifa, con rango y tomas descontadas', () => {
    const r = proyectarSemana({ movs: CUENTA, paquetes: PAQUETES, cfg, hoy: '2026-11-11' });
    expect(r.tipo).toBe('proyeccion');
    if (r.tipo !== 'proyeccion') return;
    expect(r.datos).toMatchObject({ etiqueta: 'Estimado', devengado_cent: 4000n, por_enviar_piezas: 10, minimo_cent: 4000n, maximo_cent: 6000n, tomas_cent: 45000n, neto_estimado_cent: 6000n - 45000n, neto_minimo_cent: 4000n - 45000n });
  });
  it('las entradas (paquetes por recibir) no cuentan como renta por enviar', () => {
    const r = proyectarSemana({ movs: CUENTA, paquetes: PAQUETES.filter((p) => p.tipo === 'entrada'), cfg, hoy: '2026-11-11' });
    expect(r.tipo === 'proyeccion' && r.datos.por_enviar_piezas).toBe(0);
  });
  it('sin tarifa, sin paquetes (SQL pendiente) o sin historia: Sin dato, nunca un cero inventado', () => {
    expect(proyectarSemana({ movs: [], paquetes: PAQUETES, cfg: { renta_por_pieza_cent: null }, hoy: '2026-11-11' })).toEqual({ tipo: 'sin_dato', motivo: 'sin_tarifa' });
    expect(proyectarSemana({ movs: CUENTA, paquetes: null, cfg, hoy: '2026-11-11' })).toEqual({ tipo: 'sin_dato', motivo: 'sin_paquetes' });
    expect(proyectarSemana({ movs: [], paquetes: [], cfg, hoy: '2026-11-11' })).toEqual({ tipo: 'sin_dato', motivo: 'sin_historia' });
  });
  it('si no hay tarifa configurada usa la ultima tarifa vista en la renta', () => {
    expect(tarifaPorPieza(CUENTA, { renta_por_pieza_cent: null })).toBe(200n);
  });
});

describe('explicar este numero', () => {
  it('solo cifras conocidas', () => {
    expect(cifraExplicable(`omar:renta:${SEM}`)).toBe(true);
    expect(cifraExplicable('omar:saldo')).toBe(true);
    expect(cifraExplicable('margen:1:2')).toBe(false);
    expect(cifraExplicable('omar:neto:2026-11-09')).toBe(false);
  });
  it('renta de la semana: dos vias que cuadran y renglones', () => {
    const e = explicarCifraOmar(`omar:renta:${SEM}`, CUENTA, LIQUIDACIONES)!;
    expect(e.valor).toBe(4000);
    expect(e.comprobacion).toMatchObject({ via1Valor: 4000, via2Valor: 4000, cuadra: true });
    expect(e.renglones).toHaveLength(3);
  });
  it('saldo, pagos recibidos y acumulada', () => {
    expect(explicarCifraOmar('omar:saldo', CUENTA, LIQUIDACIONES)!.comprobacion?.cuadra).toBe(true);
    expect(explicarCifraOmar(`omar:recibido:${SEM}`, CUENTA, LIQUIDACIONES)!.valor).toBe(3000);
    expect(explicarCifraOmar('omar:renta-acumulada', CUENTA, LIQUIDACIONES)!.valor).toBe(6000);
  });
});
