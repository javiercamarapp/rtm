import { describe, expect, it } from 'vitest';
import { diasDeAtraso, estaVencido, fechaMerida, tipoRecordatorio, venceEn } from '@/dominio/dropshipping/compromiso';

const T = (iso: string) => new Date(iso);

describe('fecha comprometida de pago', () => {
  it('sin hora vence al terminar el dia en hora de Merida', () => {
    expect(venceEn('2026-11-20', null)?.toISOString()).toBe('2026-11-21T05:59:59.000Z');
    expect(venceEn('2026-11-20', '10:00')?.toISOString()).toBe('2026-11-20T16:00:00.000Z');
    expect(venceEn(null, null)).toBeNull();
  });
  it('un compromiso vencido y sin pago es VENCIDO con los dias de atraso', () => {
    const ahora = T('2026-11-13T18:00:00Z'); // 12:00 en Merida
    expect(estaVencido('2026-11-10', null, ahora, true)).toBe(true);
    expect(diasDeAtraso('2026-11-10', null, ahora, true)).toBe(3);
  });
  it('futuro, pagado o sin fecha: no esta vencido y no tiene atraso', () => {
    const ahora = T('2026-11-13T18:00:00Z');
    expect(estaVencido('2026-11-15', null, ahora, true)).toBe(false);
    expect(estaVencido('2026-11-10', null, ahora, false)).toBe(false);
    expect(estaVencido(null, null, ahora, true)).toBe(false);
    expect(diasDeAtraso('2026-11-10', null, ahora, false)).toBe(0);
  });
  it('la fecha de Merida no es la UTC', () => expect(fechaMerida(T('2026-11-14T03:00:00Z'))).toBe('2026-11-13'));
});

describe('recordatorios de pago', () => {
  const base = { enviados: 0, ultimo: null, avisadoPorVencer: false, avisadoHoy: false };
  it('sin fecha: alerta', () => expect(tipoRecordatorio({ ...base, fecha: null, hora: null }, T('2026-11-13T18:00:00Z'))).toBe('sin_fecha'));
  it('24 h antes: por vencer, una sola vez', () => {
    const e = { ...base, fecha: '2026-11-14', hora: '12:00' };
    expect(tipoRecordatorio(e, T('2026-11-13T20:00:00Z'))).toBe('por_vencer'); // faltan 24 h o menos
    expect(tipoRecordatorio({ ...e, avisadoPorVencer: true }, T('2026-11-13T20:00:00Z'))).toBeNull();
    expect(tipoRecordatorio(e, T('2026-11-12T12:00:00Z'))).toBeNull();
  });
  it('vencido hoy: una vez; vencido antes: periodico hasta el maximo', () => {
    const hoy = { ...base, fecha: '2026-11-13', hora: '08:00' };
    expect(tipoRecordatorio(hoy, T('2026-11-14T01:00:00Z'))).toBe('vence_hoy');
    expect(tipoRecordatorio({ ...hoy, avisadoHoy: true }, T('2026-11-14T01:00:00Z'))).toBeNull();
    const viejo = { ...base, fecha: '2026-11-10', hora: null };
    const ahora = T('2026-11-13T18:00:00Z');
    expect(tipoRecordatorio(viejo, ahora)).toBe('vencido');
    expect(tipoRecordatorio({ ...viejo, enviados: 1, ultimo: T('2026-11-13T12:00:00Z') }, ahora)).toBeNull(); // antes del intervalo
    expect(tipoRecordatorio({ ...viejo, enviados: 1, ultimo: T('2026-11-12T12:00:00Z') }, ahora)).toBe('vencido');
    expect(tipoRecordatorio({ ...viejo, enviados: 7, ultimo: T('2026-11-10T12:00:00Z') }, ahora)).toBeNull(); // maximo
  });
  it('el intervalo y el maximo se configuran', () => {
    const viejo = { ...base, fecha: '2026-11-10', hora: null, enviados: 2, ultimo: T('2026-11-13T10:00:00Z') };
    expect(tipoRecordatorio(viejo, T('2026-11-13T18:00:00Z'), { avisoPrevioHoras: 24, intervaloHoras: 6, maxRecordatorios: 3 })).toBe('vencido');
    expect(tipoRecordatorio(viejo, T('2026-11-13T18:00:00Z'), { avisoPrevioHoras: 24, intervaloHoras: 6, maxRecordatorios: 2 })).toBeNull();
  });
});
