import { describe, expect, it } from 'vitest';
import { atajos, esFecha, mesAnterior, mesDe, rangoDeConsulta } from '@/dominio/contabilidad/rangos';

describe('rangos de los estados contables', () => {
  it('mes calendario, incluido febrero bisiesto y diciembre', () => {
    expect(mesDe('2026-11-11')).toEqual({ ini: '2026-11-01', fin: '2026-11-30' });
    expect(mesDe('2028-02-10')).toEqual({ ini: '2028-02-01', fin: '2028-02-29' });
    expect(mesDe('2026-12-31')).toEqual({ ini: '2026-12-01', fin: '2026-12-31' });
  });
  it('mes anterior cruza el anio', () => {
    expect(mesAnterior('2027-01-15')).toEqual({ ini: '2026-12-01', fin: '2026-12-31' });
  });
  it('atajos: la semana va de lunes a domingo (11-nov-2026 es miercoles)', () => {
    const a = atajos('2026-11-11');
    expect(a[0]).toMatchObject({ ini: '2026-11-09', fin: '2026-11-15', etiqueta: 'Esta semana' });
    expect(a[1]).toMatchObject({ ini: '2026-11-02', fin: '2026-11-08' });
    expect(a[2]).toMatchObject({ ini: '2026-11-01', fin: '2026-11-30' });
    expect(a[3]).toMatchObject({ ini: '2026-10-01', fin: '2026-10-31' });
  });
  it('la URL manda solo si trae dos fechas validas y en orden', () => {
    expect(rangoDeConsulta('2026-11-11', '2026-11-02', '2026-11-08')).toEqual({ ini: '2026-11-02', fin: '2026-11-08' });
    expect(rangoDeConsulta('2026-11-11', '2026-11-09', '2026-11-02')).toEqual({ ini: '2026-11-01', fin: '2026-11-30' });
    expect(rangoDeConsulta('2026-11-11', 'x', undefined)).toEqual({ ini: '2026-11-01', fin: '2026-11-30' });
    expect(esFecha('2026-11-11')).toBe(true);
    expect(esFecha('11-11-2026')).toBe(false);
  });
});
