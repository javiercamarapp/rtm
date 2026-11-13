// Fechas y horas en lenguaje natural: las interpreta el CODIGO (no la IA), con el reloj de Merida. Ante la duda pregunta; nunca adivina.
import { describe, expect, it } from 'vitest';
import { dijoSinFecha, formatearFechaPago, interpretarFechaPago } from '@/dominio/agente/fecha_pago';

// Martes 10-nov-2026, 12:00 hora de Merida (18:00 UTC).
const MARTES = new Date(Date.UTC(2026, 10, 10, 18, 0, 0));
// Viernes 13-nov-2026, 09:00 hora de Merida.
const VIERNES = new Date(Date.UTC(2026, 10, 13, 15, 0, 0));

describe('interpretarFechaPago (futuro)', () => {
  it('el viernes (un martes) es el viernes de esta semana, sin hora', () => {
    expect(interpretarFechaPago('el viernes', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: null });
  });
  it('manana a las 5 es ambiguo: 5 a.m. o 5 p.m. (se pregunta con botones)', () => {
    const r = interpretarFechaPago('mañana a las 5', MARTES);
    expect(r).toEqual({ tipo: 'ambiguo', motivo: 'am_pm', opciones: [{ fecha: '2026-11-11', hora: '05:00' }, { fecha: '2026-11-11', hora: '17:00' }] });
  });
  it('manana a las 5 de la tarde y 5pm son 17:00', () => {
    expect(interpretarFechaPago('mañana a las 5 de la tarde', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-11', hora: '17:00' });
    expect(interpretarFechaPago('mañana 5pm', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-11', hora: '17:00' });
    expect(interpretarFechaPago('mañana 5:30 pm', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-11', hora: '17:30' });
  });
  it('"en la manana" es la parte del dia, no el dia siguiente', () => {
    expect(interpretarFechaPago('el viernes a las 9 de la mañana', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: '09:00' });
  });
  it('24 horas y mediodia no son ambiguos', () => {
    expect(interpretarFechaPago('el viernes 17:00', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: '17:00' });
    expect(interpretarFechaPago('el viernes a las 14', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: '14:00' });
    expect(interpretarFechaPago('el viernes al mediodia', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: '12:00' });
  });
  it('hoy, pasado manana, en 3 dias', () => {
    expect(interpretarFechaPago('hoy 8 pm', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-10', hora: '20:00' });
    expect(interpretarFechaPago('pasado mañana', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-12', hora: null });
    expect(interpretarFechaPago('en 3 dias', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: null });
  });
  it('fechas con numero: el 20, 20 de noviembre, 20/11, 2026-11-20', () => {
    for (const t of ['el 20', 'el dia 20', '20 de noviembre', '20 nov', '20/11', '20-11-2026', '2026-11-20']) {
      expect(interpretarFechaPago(t, MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-20', hora: null });
    }
  });
  it('solo el numero de dia ("el 5") pasa al mes siguiente; una fecha con mes y ya pasada NO se corre en silencio al anio siguiente', () => {
    expect(interpretarFechaPago('el 5', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-12-05', hora: null });
    expect(interpretarFechaPago('5 de noviembre', MARTES)).toEqual({ tipo: 'pasada', fecha: '2026-11-05' });
    expect(interpretarFechaPago('5/11', MARTES)).toEqual({ tipo: 'pasada', fecha: '2026-11-05' });
    expect(interpretarFechaPago('5 de noviembre de 2027', MARTES)).toEqual({ tipo: 'ok', fecha: '2027-11-05', hora: null });
  });
  it('dia de la semana con numero: viernes 20 respeta el 20; si no coincide con el dia nombrado se pide aclaracion', () => {
    expect(interpretarFechaPago('viernes 20', VIERNES)).toEqual({ tipo: 'ok', fecha: '2026-11-20', hora: null });
    expect(interpretarFechaPago('el viernes 20 a las 17:00', VIERNES)).toEqual({ tipo: 'ok', fecha: '2026-11-20', hora: '17:00' });
    expect(interpretarFechaPago('viernes 21', VIERNES)).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('lunes 20', MARTES)).toEqual({ tipo: 'no_entendi' });
  });
  it('anios ambiguos o absurdos no se aceptan: 15/11/2, 15/11/26, 2099, 2031', () => {
    for (const t of ['15/11/2', '15/11/26', '15/11/2099', '20 de noviembre de 2031', '2099-01-01', '2031-11-20']) expect(interpretarFechaPago(t, MARTES), t).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('20/11/2026', MARTES)).toEqual({ tipo: 'ok', fecha: '2026-11-20', hora: null });
  });
  it('"el viernes" siendo viernes es ambiguo (hoy u ocho dias despues); con "proximo" ya no', () => {
    const r = interpretarFechaPago('el viernes', VIERNES);
    expect(r).toEqual({ tipo: 'ambiguo', motivo: 'dia', opciones: [{ fecha: '2026-11-13', hora: null }, { fecha: '2026-11-20', hora: null }] });
    expect(interpretarFechaPago('el proximo viernes', VIERNES)).toEqual({ tipo: 'ok', fecha: '2026-11-20', hora: null });
  });
  it('una fecha u hora pasadas se rechazan', () => {
    expect(interpretarFechaPago('ayer', MARTES)).toEqual({ tipo: 'pasada', fecha: '2026-11-09' });
    expect(interpretarFechaPago('hoy a las 9 de la mañana', MARTES)).toEqual({ tipo: 'pasada', fecha: '2026-11-10' });
    expect(interpretarFechaPago('1/11/2026', MARTES)).toEqual({ tipo: 'pasada', fecha: '2026-11-01' });
  });
  it('lo ilegible o inexistente no se adivina', () => {
    expect(interpretarFechaPago('pronto', MARTES)).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('', MARTES)).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('el 31 de noviembre', MARTES)).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('mañana a las 25', MARTES)).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('a las 5', MARTES)).toEqual({ tipo: 'no_entendi' });
    expect(interpretarFechaPago('x'.repeat(200), MARTES)).toEqual({ tipo: 'no_entendi' });
  });
  it('usa la fecha de Merida, no la UTC (02:00 UTC del sabado 14 sigue siendo viernes 13)', () => {
    const casiSabado = new Date(Date.UTC(2026, 10, 14, 2, 0, 0));
    expect(interpretarFechaPago('hoy', casiSabado)).toEqual({ tipo: 'ok', fecha: '2026-11-13', hora: null });
  });
});

describe('interpretarFechaPago (pasado, para la fecha de un pago)', () => {
  it('ayer, el lunes (mas reciente), 9/11', () => {
    expect(interpretarFechaPago('ayer', MARTES, { direccion: 'pasado' })).toEqual({ tipo: 'ok', fecha: '2026-11-09', hora: null });
    expect(interpretarFechaPago('el viernes', MARTES, { direccion: 'pasado' })).toEqual({ tipo: 'ok', fecha: '2026-11-06', hora: null });
    expect(interpretarFechaPago('9/11', MARTES, { direccion: 'pasado' })).toEqual({ tipo: 'ok', fecha: '2026-11-09', hora: null });
    expect(interpretarFechaPago('20 de diciembre', MARTES, { direccion: 'pasado' })).toEqual({ tipo: 'futura', fecha: '2026-12-20' });
  });
  it('una fecha futura se rechaza', () => {
    expect(interpretarFechaPago('mañana', MARTES, { direccion: 'pasado' })).toEqual({ tipo: 'futura', fecha: '2026-11-11' });
  });
});

describe('formato y atajos', () => {
  it('formatea con dia de la semana y hora de Merida', () => {
    expect(formatearFechaPago('2026-11-13', '17:00')).toBe('viernes 13 de noviembre de 2026, 17:00 (hora de Mérida)');
    expect(formatearFechaPago('2026-11-14', null)).toBe('sábado 14 de noviembre de 2026 (sin hora)');
  });
  it('"sin fecha" se reconoce', () => {
    expect(dijoSinFecha('Sin fecha')).toBe(true);
    expect(dijoSinFecha('todavía no sé')).toBe(true);
    expect(dijoSinFecha('el viernes')).toBe(false);
  });
});
