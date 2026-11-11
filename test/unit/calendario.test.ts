import { describe, it, expect } from 'vitest';
import { diaSemanaLunes0, fechaNeg, semanaLiquidacionProveedor, semanaOmar, semanaReporte } from '@/dominio/calendario';

// G8: con el reloj inyectado en 2026-11-10 (martes).
describe('G8 calendario de negocio', () => {
  const martes = fechaNeg(new Date('2026-11-10T18:00:00Z')); // mediodia de Merida
  it('10-nov-2026 es martes', () => {
    expect(martes).toBe('2026-11-10');
    expect(diaSemanaLunes0(martes)).toBe(1);
  });
  it('semana_reporte = 9 a 15 nov', () => {
    expect(semanaReporte(martes)).toEqual({ inicio: '2026-11-09', fin: '2026-11-15' });
  });
  it('semana_liquidacion_proveedor = lunes 9 a viernes 13, cierre viernes 13', () => {
    expect(semanaLiquidacionProveedor(martes)).toEqual({ inicio: '2026-11-09', fin: '2026-11-13', cierre: '2026-11-13' });
  });
  it('la liquidacion de Omar de la semana 9 a 15 se cierra el lunes 16', () => {
    expect(semanaOmar(martes).corte).toBe('2026-11-16');
  });
  it('a las 02:00 UTC del sabado 14, negocio.hoy() = viernes 13', () => {
    expect(fechaNeg(new Date('2026-11-14T02:00:00Z'))).toBe('2026-11-13');
  });
  it('la frontera exacta: 06:00 UTC ya es el dia nuevo en Merida; 05:59:59 no', () => {
    expect(fechaNeg(new Date('2026-11-14T05:59:59Z'))).toBe('2026-11-13');
    expect(fechaNeg(new Date('2026-11-14T06:00:00Z'))).toBe('2026-11-14');
  });
  it('cruza mes y anio', () => {
    expect(semanaReporte('2026-12-31')).toEqual({ inicio: '2026-12-28', fin: '2027-01-03' });
  });
});
