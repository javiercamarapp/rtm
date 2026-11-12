import { describe, expect, it } from 'vitest';
import { alcanzanUmbral, contarPor, inicioSemana, porcentaje, sentidoDe, sumarPorSemana, textoVariacion, ultimasSemanas, variacionPct } from '@/dominio/tablero/agregados';

describe('agregados de tablero', () => {
  it('el lunes de la semana', () => {
    expect(inicioSemana('2026-11-12')).toBe('2026-11-09');
    expect(inicioSemana('2026-11-09')).toBe('2026-11-09');
    expect(inicioSemana('2026-11-15')).toBe('2026-11-09');
  });
  it('ultimas semanas: la ultima es parcial y van en orden', () => {
    const s = ultimasSemanas('2026-11-12', 3);
    expect(s.map((x) => x.inicio)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
    expect(s.map((x) => x.parcial)).toEqual([false, false, true]);
  });
  it('suma por semana y descarta lo que cae fuera', () => {
    const s = ultimasSemanas('2026-11-12', 2);
    const v = sumarPorSemana([{ f: '2026-11-03', n: 5 }, { f: '2026-11-10', n: 7 }, { f: '2026-11-11', n: 1 }, { f: '2026-09-01', n: 99 }, { f: null, n: 4 }], s, (x) => x.f, (x) => x.n);
    expect(v).toEqual([5, 8]);
  });
  it('variacion solo con base distinta de cero', () => {
    expect(variacionPct(110, 100)).toBeCloseTo(10);
    expect(variacionPct(5, 0)).toBeNull();
    expect(variacionPct(null, 3)).toBeNull();
    expect(textoVariacion(10)).toBe('+10.0 %');
    expect(textoVariacion(-3.04)).toBe('−3.0 %');
    expect(textoVariacion(0.01)).toBe('0.0 %');
    expect(sentidoDe(-1)).toBe('baja');
    expect(sentidoDe(0)).toBe('igual');
  });
  it('porcentaje y conteos', () => {
    expect(porcentaje(1, 4)).toBe(25);
    expect(porcentaje(1, 0)).toBeNull();
    expect(contarPor(['a', 'b', 'a'], (x) => x)).toEqual([{ clave: 'a', n: 2 }, { clave: 'b', n: 1 }]);
  });
  it('cuantos alcanzan el 80 %', () => {
    expect(alcanzanUmbral([50, 30, 10, 5, 5])).toEqual({ n: 2, total: 5 });
    expect(alcanzanUmbral([])).toEqual({ n: 0, total: 0 });
  });
});

import { ritmoCliente } from '@/dominio/tablero/agregados';
describe('ritmo de cliente', () => {
  it('sin muestra no hay ritmo', () => {
    expect(ritmoCliente([{ fecha: '2026-11-02', piezas: 10 }], '2026-11-12')).toBeNull();
    expect(ritmoCliente([{ fecha: '2026-11-02', piezas: 10 }, { fecha: '2026-11-04', piezas: 10 }, { fecha: '2026-11-06', piezas: 10 }], '2026-11-12')).toBeNull();
  });
  it('baja si la ultima semana completa es menor al 70 % del promedio', () => {
    const ped = [{ fecha: '2026-09-01', piezas: 130 }, { fecha: '2026-09-15', piezas: 130 }, { fecha: '2026-10-06', piezas: 130 }, { fecha: '2026-10-20', piezas: 130 }];
    const r = ritmoCliente(ped, '2026-11-12');
    expect(r).not.toBeNull();
    expect(r!.baja).toBe(true);
    expect(ritmoCliente([...ped, { fecha: '2026-11-04', piezas: 100 }], '2026-11-12')!.baja).toBe(false);
  });
});
