import { describe, expect, it } from 'vitest';
import { MENSAJE_PLAZO_DIAS, MENSAJE_PLAZO_FALTA, plazoDeFormulario } from '@/dominio/operacion/plazo_pedido';

describe('plazo obligatorio del pedido (formulario)', () => {
  it('sin condicion de pago no se crea y el mensaje es claro', () => {
    expect(plazoDeFormulario('', '')).toEqual({ ok: false, mensaje: MENSAJE_PLAZO_FALTA });
    expect(plazoDeFormulario('', '15')).toEqual({ ok: false, mensaje: MENSAJE_PLAZO_FALTA });
  });
  it('de contado es plazo 0', () => {
    expect(plazoDeFormulario('contado', '')).toEqual({ ok: true, plazo_dias: 0 });
    expect(plazoDeFormulario('contado', '99')).toEqual({ ok: true, plazo_dias: 0 });
  });
  it('a credito exige dias enteros de 1 a 365', () => {
    expect(plazoDeFormulario('credito', '15')).toEqual({ ok: true, plazo_dias: 15 });
    expect(plazoDeFormulario('credito', ' 365 ')).toEqual({ ok: true, plazo_dias: 365 });
    for (const malo of ['', '0', '366', '-3', '1.5', 'abc', '1000']) expect(plazoDeFormulario('credito', malo), malo).toEqual({ ok: false, mensaje: MENSAJE_PLAZO_DIAS });
  });
});
