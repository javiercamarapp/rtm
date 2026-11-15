import { describe, expect, it } from 'vitest';
import { textoAceptacion, textoRenglones } from '@/dominio/operacion/avisos_pedido';

describe('avisos agrupados del pedido', () => {
  it('cuenta renglones y lista los modelos', () => {
    expect(textoRenglones({ renglones: 5, modelos: ['Nexa Ultra 50K'] })).toBe('5 renglones · Nexa Ultra 50K');
    expect(textoRenglones({ renglones: 1, modelos: ['A', 'B'] })).toBe('1 renglón · A, B');
    expect(textoRenglones({ renglones: 0, modelos: [] })).toBeNull();
  });
  it('Aceptado por solo cuando todos los avisos del grupo están aceptados', () => {
    expect(textoAceptacion({ avisos: 5, aceptados: 5, decidido_por: ['Javier'] })).toBe('Aceptado por Javier');
    expect(textoAceptacion({ avisos: 5, aceptados: 2, decidido_por: ['Javier'] })).toContain('en 2 de 5');
    expect(textoAceptacion({ avisos: 3, aceptados: 0, decidido_por: [] })).toMatch(/^No bloquea/);
  });
});
