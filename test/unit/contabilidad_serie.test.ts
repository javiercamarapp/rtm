import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/infra/supabase/cliente-servidor', () => ({ crearClienteServidor: async () => ({ rpc }) }));

import { leerSerieSemanal } from '@/infra/supabase/contabilidad-serie';

describe('leerSerieSemanal', () => {
  beforeEach(() => rpc.mockReset());

  it('llama a la funcion de solo lectura con el numero de semanas y convierte los centavos a bigint', async () => {
    rpc.mockResolvedValue({ data: { hoy: '2026-11-12', semanas: [{ ini: '2026-11-09', fin: '2026-11-15', parcial: true, con_movimientos: true, utilidad_neta_cent: 123456, piezas_vendidas: 40, ventas_netas_cent: 500000 }] }, error: null });
    const s = await leerSerieSemanal(8);
    expect(rpc).toHaveBeenCalledWith('conta_serie_semanal', { p_semanas: 8 });
    expect(s.semanas[0]!.utilidad_neta_cent).toBe(123456n);
    expect(s.semanas[0]!.ventas_netas_cent).toBe(500000n);
    expect(s.semanas[0]!.piezas_vendidas).toBe(40);
    expect(s.semanas[0]!.parcial).toBe(true);
  });

  it('usa 12 semanas por omision', async () => {
    rpc.mockResolvedValue({ data: { hoy: '2026-11-12', semanas: [] }, error: null });
    await leerSerieSemanal();
    expect(rpc).toHaveBeenCalledWith('conta_serie_semanal', { p_semanas: 12 });
  });

  it('un error de la base se propaga con el nombre de la funcion', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permiso denegado' } });
    await expect(leerSerieSemanal()).rejects.toThrow('conta_serie_semanal: permiso denegado');
  });
});
