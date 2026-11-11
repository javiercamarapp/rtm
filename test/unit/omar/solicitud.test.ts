import { describe, expect, it } from 'vitest';
import { caducaEn, claveValida, CONFIG_POR_OMISION, estadoVisible, tiempoRestante, validarSolicitud } from '@/dominio/omar/solicitud';
import { DISPONIBLE } from './fixtures';

const base = { modelo: 'Elux Legend 3.5K', sabor: 'Sandía' };

describe('validarSolicitud', () => {
  it('acepta una cantidad dentro del tope y de la existencia', () => {
    expect(validarSolicitud({ ...base, piezas: 5 }, DISPONIBLE, CONFIG_POR_OMISION)).toEqual({ ok: true, linea: { ...base, piezas: 5 } });
  });
  it('rechaza cantidades no enteras, cero, negativas y no numericas', () => {
    for (const piezas of [0, -1, 2.5, '3', null, NaN]) {
      const r = validarSolicitud({ ...base, piezas }, DISPONIBLE, CONFIG_POR_OMISION);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe('cantidad');
    }
  });
  it('el tope por toma es configurable (hoy 15)', () => {
    const mango = { modelo: 'Waka Blast 50K', sabor: 'Mango' };
    expect(validarSolicitud({ ...mango, piezas: 16 }, DISPONIBLE, CONFIG_POR_OMISION)).toMatchObject({ ok: false, motivo: 'tope' });
    expect(validarSolicitud({ ...mango, piezas: 16 }, DISPONIBLE, { ...CONFIG_POR_OMISION, tope_toma_piezas: 20 }).ok).toBe(true);
    expect(validarSolicitud({ ...mango, piezas: 15 }, DISPONIBLE, CONFIG_POR_OMISION).ok).toBe(true);
  });
  it('no deja pedir mas de lo que hay ni una pieza que no tiene', () => {
    expect(validarSolicitud({ modelo: 'Elux Legend 3.5K', sabor: 'Uva', piezas: 5 }, DISPONIBLE, CONFIG_POR_OMISION)).toMatchObject({ ok: false, motivo: 'sin_existencia' });
    expect(validarSolicitud({ modelo: 'Nexa', sabor: 'Menta', piezas: 1 }, DISPONIBLE, CONFIG_POR_OMISION)).toMatchObject({ ok: false, motivo: 'pieza_desconocida' });
  });
  it('compara modelo y sabor sin importar mayusculas ni espacios', () => {
    expect(validarSolicitud({ modelo: ' elux legend 3.5k ', sabor: 'SANDÍA', piezas: 1 }, DISPONIBLE, CONFIG_POR_OMISION).ok).toBe(true);
  });
});

describe('caducidad y estado visible', () => {
  it('caduca 72 h despues de solicitada', () => {
    expect(caducaEn('2026-11-10T12:00:00.000Z', 72)).toBe('2026-11-13T12:00:00.000Z');
  });
  it('una pendiente vencida se ve caducada; las demas no cambian', () => {
    const ahora = new Date('2026-11-14T00:00:00Z');
    expect(estadoVisible({ estado: 'pendiente', caduca_at: '2026-11-13T12:00:00Z' }, ahora)).toBe('caducada');
    expect(estadoVisible({ estado: 'pendiente', caduca_at: '2026-11-15T12:00:00Z' }, ahora)).toBe('pendiente');
    expect(estadoVisible({ estado: 'autorizada', caduca_at: '2026-11-01T12:00:00Z' }, ahora)).toBe('autorizada');
  });
  it('tiempo restante en minutos u horas, vacio si ya paso', () => {
    const ahora = new Date('2026-11-10T12:00:00Z');
    expect(tiempoRestante('2026-11-10T12:40:00Z', ahora)).toBe('caduca en 40 min');
    expect(tiempoRestante('2026-11-13T12:00:00Z', ahora)).toBe('caduca en 72 h');
    expect(tiempoRestante('2026-11-10T11:00:00Z', ahora)).toBe('');
  });
  it('la clave de idempotencia exige el formato web:<uuid>', () => {
    expect(claveValida('web:3f2a9c1e-1111-4222-8333-444455556666')).toBe(true);
    for (const c of ['', 'x', 'web:', 'tg:abcdefgh', 'web:ZZZZZZZZ', 42, null]) expect(claveValida(c)).toBe(false);
  });
});
