import { describe, expect, it } from 'vitest';
import { interpretarPlazo } from '@/dominio/agente/plazo_pedido';

// Viernes 13-nov-2026, 12:00 en Merida (18:00 UTC).
const AHORA = new Date('2026-11-13T18:00:00Z');

describe('plazo del pedido dicho en el chat', () => {
  it('de contado es 0 dias', () => {
    for (const t of ['de contado', 'Contado', 'al contado', 'paga hoy', 'sin credito']) expect(interpretarPlazo(t, AHORA), t).toEqual({ tipo: 'ok', dias: 0 });
  });
  it('dias y semanas', () => {
    expect(interpretarPlazo('a 15 dias', AHORA)).toEqual({ tipo: 'ok', dias: 15 });
    expect(interpretarPlazo('30 días de crédito', AHORA)).toEqual({ tipo: 'ok', dias: 30 });
    expect(interpretarPlazo('dos semanas', AHORA)).toEqual({ tipo: 'ok', dias: 14 });
    expect(interpretarPlazo('una semana', AHORA)).toEqual({ tipo: 'ok', dias: 7 });
    expect(interpretarPlazo('quincena', AHORA)).toEqual({ tipo: 'ok', dias: 15 });
  });
  it('una fecha se vuelve dias desde hoy, calculados por codigo', () => {
    expect(interpretarPlazo('el 20 de noviembre', AHORA)).toEqual({ tipo: 'ok', dias: 7 });
  });
  it('lo ilegible o fuera de rango se vuelve a preguntar', () => {
    for (const t of ['', 'luego vemos', '400 dias', '0 dias', 'x'.repeat(100)]) expect(interpretarPlazo(t, AHORA), t).toEqual({ tipo: 'no_entendi' });
  });
});
