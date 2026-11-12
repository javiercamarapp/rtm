import { describe, expect, it } from 'vitest';
import { decisionesABigint } from '@/dominio/historial/tipos';
import { centavosABigint } from '@/dominio/operacion/json';

describe('decisionesABigint', () => {
  it('la conversion general de centavos no toca retira / reinvierte: se convierten aparte', () => {
    const crudo = centavosABigint<{ decisiones: Record<string, { retira: unknown }> }>({ decisiones: { Angelo: { retira: 500, reinvierte: 0 } } });
    expect(typeof crudo.decisiones.Angelo!.retira).toBe('number');
    expect(decisionesABigint({ Angelo: { retira: 500, reinvierte: 0 } })).toEqual({ Angelo: { retira: 500n, reinvierte: 0n } });
  });
  it('acepta bigint y vacio', () => {
    expect(decisionesABigint({ Javier: { retira: 1n, reinvierte: 2n } })).toEqual({ Javier: { retira: 1n, reinvierte: 2n } });
    expect(decisionesABigint(null)).toEqual({});
  });
});
