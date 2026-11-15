import { describe, expect, it } from 'vitest';
import { formaPagoEfectiva } from '@/dominio/agente/forma_pago';

const HOY = new Date('2026-11-14T18:00:00Z');

describe('forma de pago derivada por el codigo', () => {
  it('lo explicito gana; lo implicito en el plazo lo deriva el codigo; la contradiccion se pregunta', () => {
    expect(formaPagoEfectiva({ forma_pago: 'contado', plazo_texto: null }, HOY)).toBe('contado');
    expect(formaPagoEfectiva({ forma_pago: 'credito', plazo_texto: null }, HOY)).toBe('credito');
    expect(formaPagoEfectiva({ forma_pago: null, plazo_texto: 'a 8 dias' }, HOY)).toBe('credito');
    expect(formaPagoEfectiva({ forma_pago: null, plazo_texto: 'de contado' }, HOY)).toBe('contado');
    expect(formaPagoEfectiva({ forma_pago: null, plazo_texto: null }, HOY)).toBeNull();
    expect(formaPagoEfectiva({ forma_pago: 'contado', plazo_texto: 'a 15 dias' }, HOY)).toBeNull();
    expect(formaPagoEfectiva({ forma_pago: 'credito', plazo_texto: 'blablabla' }, HOY)).toBe('credito');
  });
});
