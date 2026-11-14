import { describe, expect, it } from 'vitest';
import { rotuloModalidad } from '@/dominio/operacion/posicion_proveedor';

describe('rotulo de modalidad en /proveedores', () => {
  it('Prepago total solo con anticipo a favor real (saldo y posicion a favor)', () => {
    expect(rotuloModalidad('prepago_total', 500000n, 'favor')).toBe('Prepago total');
  });
  it('con deuda de la empresa, saldo cero o saldo a favor sin posicion a favor no dice Prepago', () => {
    for (const [s, t] of [[0n, 'debe'], [-100n, 'debe'], [0n, 'cero'], [500000n, 'debe'], [500000n, 'cero'], [-5n, 'favor']] as const) {
      expect(rotuloModalidad('prepago_total', s, t)).not.toMatch(/prepago/i);
    }
  });
  it('semanal sigue igual', () => expect(rotuloModalidad('semanal_viernes', 0n, 'debe')).toBe('Liquidación los viernes'));
});
