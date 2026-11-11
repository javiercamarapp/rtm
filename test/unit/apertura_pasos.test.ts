import { describe, expect, it } from 'vitest';
import { PASOS, pasoPorNumero } from '@/dominio/apertura/pasos';

describe('pasos de la apertura', () => {
  it('son diez, consecutivos y con titulo', () => {
    expect(PASOS.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const p of PASOS) expect(p.titulo.length).toBeGreaterThan(3);
  });
  it('cada categoria de partida pertenece a un solo paso', () => {
    const todas = PASOS.flatMap((p) => p.categorias);
    expect(new Set(todas).size).toBe(todas.length);
    expect(todas.sort()).toEqual(['aportacion', 'caja', 'cxc', 'deuda_faltante_socio', 'fondos_en_poder', 'inventario', 'proveedor_a_favor', 'proveedor_debemos', 'reembolso_socio', 'retiro_previo', 'utilidad_no_repartida']);
  });
  it('busca por numero y devuelve null si no existe', () => {
    expect(pasoPorNumero(4)?.clave).toBe('inventario');
    expect(pasoPorNumero(11)).toBeNull();
  });
});
