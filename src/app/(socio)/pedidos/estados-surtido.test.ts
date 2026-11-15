import { describe, expect, it } from 'vitest';
import type { PedidoResumen } from '@/dominio/operacion/tipos';
import { resumenEstados } from './estados-surtido';

const base: PedidoResumen = { id: 1, folio: 'NP-1', fecha_neg: '2026-11-01', cliente_id: 1, cliente: 'Cliente Uno', duenio: 'Angelo', origen: 'bodega_omar', estado: 'enviado', piezas_pedidas: 10, piezas_surtidas: 10, cobrado_cent: 100000n, saldo_cent: 0n, utilidad_cent: 20000n, utilidad_provisional: false, avisos: 0, empacado: true, plazo_dias: null };
const p = (o: Partial<PedidoResumen>): PedidoResumen => ({ ...base, ...o });

describe('resumenEstados', () => {
  const todos = [
    p({ id: 1 }),
    p({ id: 2, cliente_id: 2, cliente: 'Cliente Dos', cobrado_cent: 300000n }),
    p({ id: 3, estado: 'confirmado', fecha_neg: '2026-11-05', piezas_surtidas: 4, origen: 'karen_directo' }),
    p({ id: 4, estado: 'borrador', fecha_neg: '2026-11-08', piezas_surtidas: 0, origen: 'isaac_directo' }),
    p({ id: 5, estado: 'anulado' }),
    p({ id: 6, estado: 'cancelado' }),
  ];
  const r = resumenEstados(todos, todos, '2026-11-14');

  it('cuenta estados juntando anulados y cancelados', () => {
    expect(r.estados).toEqual({ borrador: 1, confirmado: 1, enviado: 2, anuladoOCancelado: 2 });
  });
  it('surtido: surtidas de activos y por surtir de borradores y confirmados', () => {
    expect(r.surtidas).toBe(10 + 10 + 4 + 0);
    expect(r.porSurtir).toBe(6 + 10);
  });
  it('clientes ordenados por facturado de los enviados', () => {
    expect(r.clientes.map((c) => c.nombre)).toEqual(['Cliente Dos', 'Cliente Uno']);
    expect(r.facturado).toBe(400000n);
  });
  it('ultimos por fecha y el por enviar mas antiguo con sus dias', () => {
    expect(r.ultimos[0]!.id).toBe(4);
    expect(r.masAntiguo).toEqual({ folio: 'NP-1', id: 3, dias: 9 });
  });
  it('sin pedidos no inventa nada', () => {
    const v = resumenEstados([], [], '2026-11-14');
    expect(v.clientes).toEqual([]);
    expect(v.masAntiguo).toBeNull();
    expect(v.surtidas + v.porSurtir).toBe(0);
  });
});
