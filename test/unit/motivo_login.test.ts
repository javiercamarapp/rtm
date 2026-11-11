import { describe, it, expect } from 'vitest';
import { aParametro, mensajeDeError, motivoDeIntercambio, motivoSinCode } from '@/dominio/acceso/motivo_login';

describe('motivo del fallo de entrada', () => {
  it('otp_expired = enlace caducado o ya usado', () => {
    expect(motivoSinCode('otp_expired')).toBe('caducado');
    expect(motivoSinCode(null)).toBe('generico');
    expect(motivoSinCode('server_error')).toBe('generico');
  });
  it('sin code_verifier = otro navegador; flow_state = caducado', () => {
    expect(motivoDeIntercambio({ code: 'validation_failed' })).toBe('navegador');
    expect(motivoDeIntercambio({ message: 'both auth code and code verifier should be non-empty' })).toBe('navegador');
    expect(motivoDeIntercambio({ code: 'flow_state_not_found' })).toBe('caducado');
    expect(motivoDeIntercambio({ message: 'invalid flow state' })).toBe('caducado');
    expect(motivoDeIntercambio({ code: 'otra' })).toBe('generico');
  });
  it('el parametro generico viaja como 1 y los mensajes no dicen "intenta otra vez" para el caducado', () => {
    expect(aParametro('generico')).toBe('1');
    expect(aParametro('caducado')).toBe('caducado');
    expect(mensajeDeError('caducado')).not.toMatch(/intenta otra vez/i);
    expect(mensajeDeError('1')).toBe('Algo falló. Intenta otra vez.');
  });
});
