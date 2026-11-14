import { describe, expect, it } from 'vitest';
import { tituloRecepcion } from '@/infra/agente/postgres';

describe('tituloRecepcion', () => {
  it('distingue llegada parcial, saldo que completa y recepcion total', () => {
    expect(tituloRecepcion({ piezas_ahora: 90, estado: 'recibida_parcial' }, 'x')).toContain('sigue abierta');
    expect(tituloRecepcion({ piezas_ahora: 10, estado: 'recibida' }, 'x')).toContain('quedó completa');
    expect(tituloRecepcion({ piezas_recibidas: 150, diferencias: 0 }, 'x')).toBe('Recepción total registrada');
  });
});
