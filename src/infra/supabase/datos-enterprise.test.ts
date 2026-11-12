import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./cliente-servidor', () => ({ crearClienteServidor: async () => ({ rpc }) }));

import { argumentosKardex, lectorDatosSupabase } from './datos-enterprise';

describe('lector de datos enterprise', () => {
  beforeEach(() => rpc.mockReset());

  it('llama a la funcion correcta con los parametros nombrados del kardex', async () => {
    rpc.mockResolvedValue({ data: { total: 0 }, error: null });
    await lectorDatosSupabase().kardexConsolidado({ marca: 'M', modelo: 3, sku: null, ini: '2026-01-01', fin: null, tipo: 'merma', q: 'uva', limite: 50, desplazamiento: 100 });
    expect(rpc).toHaveBeenCalledWith('inventario_kardex_consolidado', { p_marca: 'M', p_modelo: 3, p_sku: null, p_ini: '2026-01-01', p_fin: null, p_tipo: 'merma', p_q: 'uva', p_limite: 50, p_desplazamiento: 100 });
  });

  it('convierte las claves *_cent a bigint y conserva null como sin dato', async () => {
    rpc.mockResolvedValue({ data: { inicial: { valor_cent: 1600000, costo_prom_cent: null }, totales: { entradas_valor_cent: 123 } }, error: null });
    const k = await lectorDatosSupabase().kardexConsolidado({ marca: null, modelo: null, sku: null, ini: null, fin: null, tipo: null, q: null, limite: 10, desplazamiento: 0 });
    expect(k.inicial.valor_cent).toBe(1600000n);
    expect(k.inicial.costo_prom_cent).toBeNull();
    expect(k.totales.entradas_valor_cent).toBe(123n);
  });

  it('el libro manda los montos en centavos enteros y el orden', async () => {
    rpc.mockResolvedValue({ data: { total: 0 }, error: null });
    await lectorDatosSupabase().libro({ ini: null, fin: null, estado: 'conciliado', q: null, minCent: 400000n, maxCent: null, cuenta: null, limite: 200, desplazamiento: 0, orden: 'desc' });
    expect(rpc).toHaveBeenCalledWith('libro_dinero', { p_ini: null, p_fin: null, p_estado: 'conciliado', p_q: null, p_min_cent: 400000, p_max_cent: null, p_cuenta: null, p_limite: 200, p_desplazamiento: 0, p_orden: 'desc' });
  });

  it('el resto de lecturas usa los nombres de la base', async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    const l = lectorDatosSupabase();
    await l.detalleInventario('2026-01-01', null);
    await l.resumenMarcas(null, null);
    await l.mermas(null, null, 100, 0);
    await l.valuacionDetalle('2026-02-01');
    await l.valuacionSerie(null, null, 'mes');
    await l.caja(null, null);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['inventario_detalle', 'inventario_resumen_marca', 'inventario_mermas', 'conta_valuacion_detalle', 'conta_valuacion_serie', 'caja_resumen']);
  });

  it('un error de la base se propaga con el nombre de la funcion', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no autorizado' } });
    await expect(lectorDatosSupabase().caja(null, null)).rejects.toThrow('caja_resumen: no autorizado');
  });

  it('argumentosKardex nunca inventa valores', () => {
    expect(argumentosKardex({ marca: null, modelo: null, sku: null, ini: null, fin: null, tipo: null, q: null, limite: 1, desplazamiento: 0 }).p_marca).toBeNull();
  });
});
