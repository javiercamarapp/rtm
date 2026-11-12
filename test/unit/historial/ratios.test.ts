// Ratios y estadisticas del historial personal: cifras calculadas a mano (cada caso trae su cuenta).
import { describe, expect, it } from 'vitest';
import { calcularRatios, diasEntre, divRedondeada, estacionalidadSemanal, estadisticasMeses, proyeccionPersonal, raizEntera, xirr } from '@/dominio/historial/ratios';
import type { Cabecera, FilaSerie, HistorialSocio } from '@/dominio/historial/tipos';

const cab = (o: Partial<Cabecera> = {}): Cabecera => ({
  aportaciones_cent: 1_000_000n, reinversion_cent: 200_000n, invertido_cent: 1_200_000n, invertido_ambos_cent: 2_000_000n,
  retirado_utilidad_cent: 300_000n, retirado_capital_cent: 0n, retirado_cent: 300_000n, utilidad_asignada_cent: 800_000n, utilidad_por_distribuir_cent: 300_000n,
  capital_contable_cent: 3_200_000n, valor_cent: 1_600_000n, valor_bajo_cent: 1_400_000n, valor_alto_cent: 1_600_000n, por_cobrar_clientes_cent: 400_000n,
  neto_cent: 50_000n, reembolso_pendiente_cent: 100_000n, fondos_cent: 0n, efectivo_total_cent: 900_000n, efectivo_disponible_cent: 800_000n, primera_fecha: '2026-01-05', meses_activo: 10, ...o,
});
const fila = (ini: string, parte: bigint, o: Partial<FilaSerie> = {}): FilaSerie => ({
  ini, fin: ini, parcial: false, utilidad_cent: parte * 2n, parte_cent: parte, pedidos: 3, piezas: 30n, ventas_cent: parte * 10n, retiros_cent: 0n, reinversion_cent: 0n, aportaciones_cent: 0n, provisional: false, ...o,
});
const hist = (o: Partial<HistorialSocio> = {}): HistorialSocio => ({
  socio: 'Angelo', otro: 'Javier', hoy: '2026-11-12', hasta: '2026-11-12', con_historial: true, cabecera: cab(), flujos: [], actas: [],
  totales: { utilidad_cent: 1_000_000n, parte_cent: 500_000n, pedidos: 20, piezas: 400n, ventas_cent: 5_000_000n, provisional: false },
  dias: [], semanas: [], meses: [], por_cliente: [], por_modelo: [], ...o,
});

describe('aritmetica entera', () => {
  it('divRedondeada: medio hacia arriba, lejos de cero con signo', () => {
    expect(divRedondeada(5n, 2n)).toBe(3n);
    expect(divRedondeada(-5n, 2n)).toBe(-3n);
    expect(divRedondeada(4n, 3n)).toBe(1n);
    expect(divRedondeada(0n, 7n)).toBe(0n);
    expect(() => divRedondeada(1n, 0n)).toThrow();
  });
  it('raizEntera: piso exacto', () => {
    expect(raizEntera(0n)).toBe(0n);
    expect(raizEntera(15n)).toBe(3n);
    expect(raizEntera(16n)).toBe(4n);
    expect(raizEntera(10n ** 30n)).toBe(10n ** 15n);
  });
  it('diasEntre', () => {
    expect(diasEntre('2026-01-01', '2026-01-31')).toBe(30);
    expect(diasEntre('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('calcularRatios', () => {
  const r = calcularRatios(hist());
  it('ROI = (retirado + valor - invertido) / invertido', () => {
    // (300,000 + 1,600,000 - 1,200,000) / 1,200,000 = 0.58333 -> 5,833 bp
    expect(r.roi_bp).toBe(5833n);
  });
  it('multiplo = (retirado + valor) / invertido en centesimas', () => {
    expect(r.multiplo_x100).toBe(158n); // 1,900,000 / 1,200,000 = 1.5833
  });
  it('ROI anualizado con 10 meses: (1.5833)^(12/10) - 1', () => {
    expect(r.roi_anualizado_bp).toBe(BigInt(Math.round((Math.pow(1900000 / 1200000, 1.2) - 1) * 10000)));
  });
  it('recuperado, payout, reinversion y participacion', () => {
    expect(r.recuperado_bp).toBe(2500n); // 300,000 / 1,200,000
    expect(r.payout_bp).toBe(3750n); // 300,000 / 800,000
    expect(r.tasa_reinversion_bp).toBe(2500n); // 200,000 / 800,000
    expect(r.participacion_capital_bp).toBe(6000n); // 1,200,000 / 2,000,000
    expect(r.participacion_utilidad_bp).toBe(5000n);
  });
  it('retiro mensual, payback y cobertura', () => {
    expect(r.retiro_mensual_cent).toBe(30_000n); // 300,000 / 10 meses
    expect(r.payback_meses).toBe(30); // (1,200,000 - 300,000) / 30,000
    expect(r.cobertura_caja_x100).toBe(200n); // 800,000 / (300,000 + 100,000)
  });
  it('margen neto y utilidad por pieza', () => {
    expect(r.margen_neto_bp).toBe(2000n); // 1,000,000 / 5,000,000
    expect(r.utilidad_por_pieza_cent).toBe(2500n); // 1,000,000 / 400
  });
  it('payback 0 si ya recupero lo invertido', () => {
    expect(calcularRatios(hist({ cabecera: cab({ retirado_cent: 1_200_000n, retirado_utilidad_cent: 1_200_000n }) })).payback_meses).toBe(0);
  });
  it('sin valuacion: ROI, multiplo, ROI anualizado y TIR son Sin dato; lo demas sigue', () => {
    const s = calcularRatios(hist({ cabecera: cab({ valor_cent: null, capital_contable_cent: null }) }));
    expect(s.roi_bp).toBeNull();
    expect(s.multiplo_x100).toBeNull();
    expect(s.roi_anualizado_bp).toBeNull();
    expect(s.tir_bp).toBeNull();
    expect(s.payout_bp).toBe(3750n);
  });
  it('sin invertido o sin utilidad asignada: Sin dato, nunca cero ni division por cero', () => {
    const s = calcularRatios(hist({ cabecera: cab({ invertido_cent: 0n, utilidad_asignada_cent: 0n, invertido_ambos_cent: 0n, retirado_utilidad_cent: 0n, retirado_cent: 0n }), totales: null }));
    expect(s.roi_bp).toBeNull();
    expect(s.recuperado_bp).toBeNull();
    expect(s.payout_bp).toBeNull();
    expect(s.tasa_reinversion_bp).toBeNull();
    expect(s.participacion_capital_bp).toBeNull();
    expect(s.margen_neto_bp).toBeNull();
    expect(s.utilidad_por_pieza_cent).toBeNull();
    expect(s.payback_meses).toBeNull();
    expect(s.retiro_mensual_cent).toBeNull();
  });
  it('menos de 6 meses: no se anualiza', () => {
    expect(calcularRatios(hist({ cabecera: cab({ meses_activo: 3 }) })).roi_anualizado_bp).toBeNull();
  });
  it('TIR con flujos fechados: -10,000 hace un ano y +11,000 hoy = 10 %', () => {
    const t = calcularRatios(hist({
      hasta: '2027-01-01', cabecera: cab({ valor_cent: 1_100_000n, retirado_cent: 0n, retirado_utilidad_cent: 0n }),
      flujos: [{ fecha: '2026-01-01', monto_cent: -1_000_000n, tipo: 'aportacion' }],
    }));
    expect(t.tir_bp).toBe(1000n);
  });
});

describe('xirr', () => {
  it('sin cambio de signo no hay TIR', () => {
    expect(xirr([{ fecha: '2026-01-01', monto: -100 }, { fecha: '2026-06-01', monto: -50 }])).toBeNull();
    expect(xirr([{ fecha: '2026-01-01', monto: 100 }])).toBeNull();
  });
  it('es determinista: dos corridas dan el mismo numero', () => {
    const f = [{ fecha: '2026-01-01', monto: -1000 }, { fecha: '2026-07-01', monto: 300 }, { fecha: '2027-01-01', monto: 900 }];
    expect(xirr(f)).toBe(xirr(f));
  });
  it('perdida total da tasa negativa', () => {
    const r = xirr([{ fecha: '2026-01-01', monto: -1000 }, { fecha: '2027-01-01', monto: 500 }]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.5, 3);
  });
});

describe('estadisticasMeses', () => {
  const meses = [fila('2026-05-01', 100n), fila('2026-06-01', 300n), fila('2026-07-01', -50n), fila('2026-08-01', 200n), fila('2026-09-01', 400n), fila('2026-10-01', 600n), fila('2026-11-01', 999n, { parcial: true })];
  const e = estadisticasMeses(meses);
  it('excluye el mes parcial', () => expect(e.completos).toHaveLength(6));
  it('mejor y peor mes', () => {
    expect(e.mejor).toEqual({ ini: '2026-10-01', parte_cent: 600n });
    expect(e.peor).toEqual({ ini: '2026-07-01', parte_cent: -50n });
  });
  it('promedio movil de 3 meses', () => {
    expect(e.promedio_movil).toEqual([null, null, 117n, 150n, 183n, 400n]); // (100+300-50)/3=116.7; (300-50+200)/3=150; (-50+200+400)/3=183.3; (200+400+600)/3=400
  });
  it('rachas: actual 3 (ago, sep, oct) y mejor 3', () => {
    expect(e.racha_actual).toBe(3);
    expect(e.mejor_racha).toBe(3);
  });
  it('sin meses: sin extremos', () => {
    const v = estadisticasMeses([]);
    expect(v.mejor).toBeNull();
    expect(v.racha_actual).toBe(0);
  });
});

describe('estacionalidad semanal', () => {
  it('promedia por dia de la semana (lunes primero)', () => {
    // 2026-11-02 es lunes
    const e = estacionalidadSemanal([fila('2026-11-02', 100n), fila('2026-11-09', 300n), fila('2026-11-03', 50n)]);
    expect(e[0]).toEqual({ dia: 'Lunes', dias: 2, promedio_cent: 200n });
    expect(e[1]).toEqual({ dia: 'Martes', dias: 1, promedio_cent: 50n });
    expect(e[2]!.promedio_cent).toBeNull();
  });
});

describe('proyeccionPersonal', () => {
  it('con menos de 3 meses no proyecta', () => {
    const p = proyeccionPersonal([fila('2026-09-01', 100n), fila('2026-10-01', 200n)], 5000n);
    expect(p.suficiente).toBe(false);
    expect(p.meses).toHaveLength(0);
  });
  it('media 200, desviacion 100 y payout 50 %: esperado 100 y banda 50 x raiz(1+1/3)', () => {
    const p = proyeccionPersonal([fila('2026-08-01', 100n), fila('2026-09-01', 200n), fila('2026-10-01', 300n)], 5000n);
    expect(p.suficiente).toBe(true);
    expect(p.base).toBe('retiro');
    // varianza muestral = 10,000; (10,000 x 4) / 3 = 13,333 -> raiz 115; x 0.5 = 58
    expect(p.banda_cent).toBe(58n);
    expect(p.meses[0]).toEqual({ esperado_cent: 100n, bajo_cent: 42n, alto_cent: 158n });
    expect(p.meses).toHaveLength(3);
  });
  it('la banda se estrecha con mas meses de la misma dispersion', () => {
    const tres = proyeccionPersonal([fila('a', 100n), fila('b', 200n), fila('c', 300n)], null);
    const nueve = proyeccionPersonal(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((k, i) => fila(k, BigInt(100 + (i % 3) * 100))), null);
    expect(nueve.banda_cent).toBeLessThan(tres.banda_cent);
  });
  it('sin payout observado se proyecta su parte, no el retiro; nunca negativo', () => {
    const p = proyeccionPersonal([fila('a', -300n), fila('b', 10n), fila('c', 20n)], null);
    expect(p.base).toBe('parte');
    expect(p.meses[0]!.bajo_cent).toBeGreaterThanOrEqual(0n);
  });
});
