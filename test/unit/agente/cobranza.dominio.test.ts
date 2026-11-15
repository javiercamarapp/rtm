// Cobranza: lo que el CODIGO interpreta de la respuesta del socio (duraciones, cuenta, atajos). Sin red ni base.
import { describe, expect, it } from 'vitest';
import { interpretarCuenta, interpretarDuracionDias, reconocerAtajoCobranza } from '@/dominio/agente/cobranza';

describe('duracion dicha en lenguaje natural', () => {
  it.each([
    ['una semana', 7], ['se atrasa una semana', 7], ['3 dias', 3], ['tres días', 3], ['dos semanas', 14], ['quince dias', 15], ['ocho dias', 8], ['una quincena', 15], ['10 dias mas', 10],
  ])('"%s" son %i dias', (t, n) => expect(interpretarDuracionDias(t)).toBe(n));

  it('lo que no tiene unidad o es vago no se adivina', () => {
    expect(interpretarDuracionDias('un rato')).toBeNull();
    expect(interpretarDuracionDias('un mes')).toBeNull();
    expect(interpretarDuracionDias('3')).toBeNull();
    expect(interpretarDuracionDias('')).toBeNull();
  });
  it('una cifra sola cuenta como dias solo cuando el bot acaba de preguntar cuantos dias', () => {
    expect(interpretarDuracionDias('3', true)).toBe(3);
    expect(interpretarDuracionDias('0', true)).toBeNull();
  });
});

describe('cuenta a la que entro el pago', () => {
  it('reconoce una sola cuenta y no adivina con dos', () => {
    expect(interpretarCuenta('a la de Javier')).toBe('javier');
    expect(interpretarCuenta('le pago directo a Isaac')).toBe('isaac');
    expect(interpretarCuenta('en efectivo')).toBe('efectivo');
    expect(interpretarCuenta('Karen')).toBe('karen');
    expect(interpretarCuenta('entre Angelo y Javier')).toBeNull();
    expect(interpretarCuenta('no se')).toBeNull();
  });
});

describe('atajos del servidor (los que el propio digest le ensena al socio)', () => {
  it('silenciar con cliente y dias', () => {
    expect(reconocerAtajoCobranza('silenciar CB Cliente A 7 días', false)).toMatchObject({ tipo: 'silenciar', cliente_texto: 'cb cliente a', dias: 7 });
    expect(reconocerAtajoCobranza('silenciar "Cliente B" una semana', false)).toMatchObject({ tipo: 'silenciar', dias: 7 });
  });
  it('deshacer por folio de cobranza', () => {
    expect(reconocerAtajoCobranza('deshacer COB-0012', false)).toEqual({ tipo: 'deshacer', folio: 'COB-0012' });
    expect(reconocerAtajoCobranza('deshaz cobranza cob-7', false)).toEqual({ tipo: 'deshacer', folio: 'COB-7' });
  });
  it('"solo recordatorio" y "extender plazo" solo existen cuando hay una pregunta abierta', () => {
    expect(reconocerAtajoCobranza('solo recordatorio', false)).toBeNull();
    expect(reconocerAtajoCobranza('extender plazo', false)).toBeNull();
    expect(reconocerAtajoCobranza('solo recordatorio', true)).toEqual({ tipo: 'solo_recordatorio' });
    expect(reconocerAtajoCobranza('extender plazo', true)).toEqual({ tipo: 'extender_plazo' });
    expect(reconocerAtajoCobranza('extender', true)).toEqual({ tipo: 'extender_plazo' });
  });
});
