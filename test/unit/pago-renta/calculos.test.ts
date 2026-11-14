import { describe, expect, it } from 'vitest';
import { acumuladoDelMes, agruparPorPeriodo, desdePrimerMovimiento, diasEntre, estadisticas, insights, reglaDeCalculo } from '@/dominio/pago-renta/calculos';
import type { DiaRenta, EstadoRenta, Proyeccion } from '@/dominio/pago-renta/tipos';

// Marzo de 2027: del 1 al 10 se envian 40 y 56 piezas alternados (480 en total) a 2.00 la pieza.
const serie: DiaRenta[] = [];
{
  let acum = 0n;
  for (let i = 0; i < 10; i++) {
    const piezas = i % 2 === 0 ? 40 : 56;
    acum += BigInt(piezas * 200);
    serie.push({ fecha: `2027-03-${String(i + 1).padStart(2, '0')}`, piezas, renta_cent: BigInt(piezas * 200), acum_mes_cent: acum });
  }
}
const estado: EstadoRenta = {
  hoy: '2027-03-11', tarifa_cent: 200n, piezas: 480, devengado_cent: 96000n, compensado_tomas_cent: 0n, pagado_cent: 40000n, saldo_cent: 56000n, por_pagar_cent: 56000n, a_favor_cent: 0n,
  regla_exacta: true, primer_envio: '2027-03-01', ultimo_envio: '2027-03-10', mes_ini: '2027-03-01', mes_piezas: 480, mes_devengado_cent: 96000n,
};
const proy: Proyeccion = {
  etiqueta: 'Estimado', emitida: true, metodo: 'x', ritmo_diario_pz: 48, fecha_corte: '2027-03-31', dias_restantes: 20, mes_piezas_acumuladas: 480,
  muestra: { dias_ventana: 10, dias_con_envio: 10, piezas: 480, dias_requeridos: 5, piezas_requeridas: 40 },
  restantes_pz: { central: 960, bajo: 912, alto: 1008 }, mes_pz: { central: 1440, bajo: 1392, alto: 1488 },
  restante_renta_cent: { central: 192000n, bajo: 182400n, alto: 201600n }, mes_renta_cent: { central: 288000n, bajo: 278400n, alto: 297600n },
  pago_al_corte_cent: { central: 248000n, bajo: 238400n, alto: 257600n },
};

describe('regla de calculo', () => {
  it('480 piezas x $2.00 = $960.00', () => expect(reglaDeCalculo(estado)).toBe('480 piezas × $2.00 = $960.00'));
  it('si la tarifa cambio lo dice y muestra el devengado real', () => expect(reglaDeCalculo({ ...estado, regla_exacta: false })).toContain('la tarifa cambio'));
  it('sin tarifa', () => expect(reglaDeCalculo({ ...estado, tarifa_cent: null })).toBe('Sin tarifa configurada'));
});

describe('agrupar por periodo', () => {
  it('B5: etiquetas cortas para que no se peguen a 390 px (dia/mes numerico, mes de tres letras)', () => {
    expect(agruparPorPeriodo(serie, '2027-03-11', 'dia').at(-1)!.etiqueta).toBe('11/3');
    expect(agruparPorPeriodo(serie, '2027-03-11', 'semana').at(-1)!.etiqueta).toBe('8/3');
    expect(agruparPorPeriodo(serie, '2027-03-11', 'mes').at(-1)!.etiqueta).toBe('mar');
    for (const p of ['dia', 'semana', 'mes'] as const) for (const c of agruparPorPeriodo(serie, '2027-03-11', p)) expect(c.etiqueta.length).toBeLessThanOrEqual(5);
  });
  it('dias: 30 cubetas contiguas que terminan hoy, con ceros', () => {
    const c = agruparPorPeriodo(serie, '2027-03-11', 'dia');
    expect(c).toHaveLength(30);
    expect(c.at(-1)!.ini).toBe('2027-03-11');
    expect(c.at(-1)!.piezas).toBe(0);
    expect(c.find((x) => x.ini === '2027-03-02')!.piezas).toBe(56);
  });
  it('semanas de lunes a domingo: la del 1-mar (lunes) suma 40+56+40+56+40+56+40 = 328 y la siguiente 56+40+56 = 152', () => {
    const c = agruparPorPeriodo(serie, '2027-03-11', 'semana');
    expect(c).toHaveLength(12);
    expect(c.at(-2)!.ini).toBe('2027-03-01');
    expect(c.at(-2)!.piezas).toBe(328);
    expect(c.at(-2)!.parcial).toBe(false);
    expect(c.at(-1)!.ini).toBe('2027-03-08');
    expect(c.at(-1)!.piezas).toBe(152);
    expect(c.at(-1)!.parcial).toBe(true);
  });
  it('meses: marzo suma 480 piezas y 960.00', () => {
    const c = agruparPorPeriodo(serie, '2027-03-11', 'mes');
    expect(c).toHaveLength(12);
    expect(c.at(-1)).toMatchObject({ ini: '2027-03-01', fin: '2027-03-31', piezas: 480, renta_cent: 96000n, parcial: true });
    expect(c.at(-2)!.ini).toBe('2027-02-01');
  });
  it('el total de las cubetas es el de la serie', () => {
    for (const p of ['dia', 'semana', 'mes'] as const) expect(agruparPorPeriodo(serie, '2027-03-11', p).reduce((s, x) => s + x.piezas, 0)).toBe(480);
  });
  it('desde el primer movimiento', () => expect(desdePrimerMovimiento(agruparPorPeriodo(serie, '2027-03-11', 'dia'))[0]!.ini).toBe('2027-03-01'));
  it('sin datos no hay cubetas con historia', () => expect(desdePrimerMovimiento(agruparPorPeriodo([], '2027-03-11', 'semana'))).toEqual([]));
});

describe('estadisticas', () => {
  it('con 10 dias de historia hay ritmo de 7 pero no de 28', () => {
    const e = estadisticas(serie, [], estado);
    expect(e.ritmo28).toBeNull();
    // Dias 4 al 10: 56+40+56+40+56+40+... el 4 = 56 (i=3), 5 = 40, 6 = 56, 7 = 40, 8 = 56, 9 = 40, 10 = 56 -> 344 / 7
    expect(e.ritmo7).toBeCloseTo(344 / 7, 6);
  });
  it('mejor dia: el primero con 56 piezas', () => expect(estadisticas(serie, [], estado).mejorDia).toEqual({ fecha: '2027-03-02', piezas: 56 }));
  it('el mes lleva 480 piezas y 960.00; quedan 20 dias', () => {
    const e = estadisticas(serie, [], estado);
    expect(e.mes).toEqual({ piezas: 480, renta_cent: 96000n });
    expect(e.diasRestantes).toBe(20);
  });
  it('sin mes anterior no hay comparacion', () => expect(estadisticas(serie, [], estado).mesAnterior).toBeNull());
  it('compara contra el mismo tramo del mes anterior', () => {
    const feb: DiaRenta[] = [{ fecha: '2027-02-03', piezas: 100, renta_cent: 20000n, acum_mes_cent: 20000n }, { fecha: '2027-02-20', piezas: 900, renta_cent: 180000n, acum_mes_cent: 200000n }];
    const e = estadisticas([...feb, ...serie], [], { hoy: '2027-03-11', primer_envio: '2027-02-03' });
    // Al 11 de febrero solo hay 100 piezas; marzo lleva 480: +380 %.
    expect(e.mesAnterior).toEqual({ piezas: 100, hasta: '2027-02-11', variacionPct: 380 });
  });
  it('tendencia: sin 14 dias de historia no se emite', () => expect(estadisticas(serie, [], estado).tendencia).toBeNull());
  it('tendencia con 20 dias de historia', () => {
    const s: DiaRenta[] = [];
    for (let i = 0; i < 20; i++) s.push({ fecha: `2027-03-${String(i + 1).padStart(2, '0')}`, piezas: i < 13 ? 10 : 20, renta_cent: 0n, acum_mes_cent: 0n });
    // Hoy 21: ultimos 7 cerrados (14 al 20) = 140; los 7 anteriores (7 al 13) = 70 -> +100 %.
    const e = estadisticas(s, [], { hoy: '2027-03-21', primer_envio: '2027-03-01' });
    expect(e.tendencia).toEqual({ sentido: 'sube', cambioPct: 100 });
  });
  it('ultimo pago y dias desde entonces', () => {
    const e = estadisticas(serie, [{ folio: 'PO-0001', fecha: '2027-03-06', monto_cent: 1n, via: 'efectivo', es_reversa: false, anulado: false }], estado);
    expect(e.ultimoPago).toEqual({ fecha: '2027-03-06', hace: 5 });
  });
});

describe('dias entre', () => {
  it('cruza el fin de mes', () => expect(diasEntre('2027-02-27', '2027-03-02')).toBe(3));
});

describe('acumulado del mes con banda', () => {
  it('observado: usa el acumulado que entrega la base y arrastra los dias sin envio', () => {
    const p = acumuladoDelMes(serie, '2027-03-12', { etiqueta: 'Estimado', emitida: false, motivo: 'muestra_chica', muestra: proy.muestra });
    expect(p).toHaveLength(12);
    expect(p.every((x) => x.tipo === 'observado')).toBe(true);
    expect(p[0]!.valor).toBe(8000);
    expect(p[9]!.valor).toBe(96000);
    expect(p[11]!.valor).toBe(96000); // 11 y 12 de marzo sin envio: se arrastra
  });
  it('NO suma dinero en el navegador: el punto se toma tal cual de acum_mes_cent', () => {
    const raros: DiaRenta[] = [{ fecha: '2027-03-01', piezas: 1, renta_cent: 200n, acum_mes_cent: 777n }, { fecha: '2027-03-02', piezas: 1, renta_cent: 200n, acum_mes_cent: 888n }];
    const p = acumuladoDelMes(raros, '2027-03-02', { etiqueta: 'Estimado', emitida: false, motivo: 'muestra_chica', muestra: proy.muestra });
    expect(p.map((x) => x.valor)).toEqual([777, 888]);
  });
  it('con proyeccion agrega UN solo punto estimado, con el central, bajo y alto de la base (sin interpolar)', () => {
    const p = acumuladoDelMes(serie, '2027-03-11', proy);
    const est = p.filter((x) => x.tipo === 'estimado');
    expect(est).toHaveLength(1);
    expect(est[0]).toMatchObject({ valor: 288000, bajo: 278400, alto: 297600, etiqueta: '31 mar' });
    expect(est[0]!.texto).toBe('$2,880.00');
  });
});

describe('insights', () => {
  const est = estadisticas(serie, [{ folio: 'PO-0001', fecha: '2027-03-06', monto_cent: 40000n, via: 'efectivo', es_reversa: false, anulado: false }], estado);
  it('B5: la frase del mes no repite la unidad ("558 pz piezas")', () => {
    const e2 = estadisticas([...Array.from({ length: 12 }, (_, i) => ({ fecha: `2027-02-${String(i + 1).padStart(2, '0')}`, piezas: 50, renta_cent: 10000n, acum_mes_cent: 10000n })), ...serie], [], { hoy: '2027-03-11', primer_envio: '2027-02-01' });
    const f = insights(estado, proy, e2).find((x) => x.id === 'mes-anterior')!.frase;
    expect(f).not.toMatch(/pz piezas/);
    expect(f).toContain('480 pz;');
  });
  it('por pagar, con el pronostico al corte y el rango', () => {
    const r = insights(estado, proy, est);
    expect(r.find((x) => x.id === 'por-pagar')!.frase).toContain('$560.00');
    const corte = r.find((x) => x.id === 'pago-corte')!;
    expect(corte.procedencia).toBe('estimado');
    expect(corte.frase).toContain('$2,480.00');
    expect(corte.frase).toContain('31 de marzo');
    expect(corte.frase).toContain('últimos 10 días');
  });
  it('sin muestra no hay pronostico: dice que falta', () => {
    const r = insights(estado, { etiqueta: 'Estimado', emitida: false, motivo: 'muestra_chica', muestra: { dias_ventana: 3, dias_con_envio: 3, piezas: 120, dias_requeridos: 5, piezas_requeridas: 40 } }, est);
    expect(r.some((x) => x.id === 'pago-corte')).toBe(false);
    expect(r.find((x) => x.id === 'sin-proyeccion')!.frase).toContain('3 de 5 días');
  });
  it('anticipo a favor de Omar', () => {
    const r = insights({ ...estado, saldo_cent: -4000n, por_pagar_cent: 0n, a_favor_cent: 4000n }, proy, est);
    expect(r[0]!.id).toBe('a-favor');
    expect(r[0]!.frase).toContain('$40.00');
  });
  it('con anticipo grande el pronostico dice que quedara a favor, no un pago negativo', () => {
    const gran = { ...proy, pago_al_corte_cent: { central: -897330n, bajo: -897550n, alto: -897112n } } as Proyeccion;
    const f = insights({ ...estado, saldo_cent: -898874n, por_pagar_cent: 0n, a_favor_cent: 898874n }, gran, est).find((x) => x.id === 'pago-corte')!;
    expect(f.frase).toContain('no habrá nada por pagar');
    expect(f.frase).toContain('$8,973.30');
    expect(f.frase).not.toContain('−');
  });
  it('sin ningun pago registrado pide accion', () => {
    const r = insights(estado, proy, estadisticas(serie, [], estado));
    expect(r.find((x) => x.id === 'por-pagar')).toMatchObject({ severidad: 'Acción' });
  });
});
