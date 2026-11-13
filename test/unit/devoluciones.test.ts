// Devoluciones y recepcion parcial: validaciones de captura (sin calcular dinero) y PDF con huella estable.
// Los esperados salen de las reglas del dueno (no devolver mas de lo surtido, lo apartado no se devuelve), no del codigo.
import { describe, expect, it } from 'vitest';
import { armarDevolucionCliente, armarDevolucionProveedor, armarLlegada, progresoRecepcion } from '@/dominio/operacion/devoluciones';
import type { FuenteDevolucion, PedidoDevoluciones, RecepcionCompra } from '@/dominio/operacion/tipos';
import { pdfDevolucion } from '@/infra/pdf/devolucion';
import { huella } from '@/infra/pdf/nota';

const renglones: PedidoDevoluciones['renglones'] = [
  { linea_id: 1, sku_id: 10, modelo: 'Modelo A', sabor: 'Mango', surtidas: 20, devueltas: 5, disponibles_devolver: 15, precio_cent: 15000n },
  { linea_id: 2, sku_id: 11, modelo: 'Modelo A', sabor: 'Uva', surtidas: 10, devueltas: 10, disponibles_devolver: 0, precio_cent: 15000n },
];

describe('armarDevolucionCliente', () => {
  it('arma solo los renglones con piezas y respeta el destino', () => {
    const r = armarDevolucionCliente(renglones, [{ linea_id: 1, sku_id: 10, piezas: '3', destino: 'merma' }, { linea_id: 2, sku_id: 11, piezas: '', destino: 'inventario' }]);
    expect(r).toEqual({ ok: true, valor: [{ linea_id: 1, sku_id: 10, piezas: 3, destino: 'merma' }] });
  });
  it('rechaza pasarse de lo disponible a devolver (surtidas menos ya devueltas)', () => {
    const r = armarDevolucionCliente(renglones, [{ linea_id: 1, sku_id: 10, piezas: '16', destino: 'inventario' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('solo se pueden devolver 15');
  });
  it('acepta exactamente el tope', () => {
    expect(armarDevolucionCliente(renglones, [{ linea_id: 1, sku_id: 10, piezas: '15', destino: 'inventario' }]).ok).toBe(true);
  });
  it('rechaza texto no entero, decimales, negativos y devolucion vacia', () => {
    for (const t of ['2.5', '-1', 'abc', '1e3']) expect(armarDevolucionCliente(renglones, [{ linea_id: 1, sku_id: 10, piezas: t, destino: 'inventario' }]).ok).toBe(false);
    expect(armarDevolucionCliente(renglones, [{ linea_id: 1, sku_id: 10, piezas: '0', destino: 'inventario' }]).ok).toBe(false);
  });
  it('rechaza un renglon ajeno al pedido', () => {
    expect(armarDevolucionCliente(renglones, [{ linea_id: 99, sku_id: 10, piezas: '1', destino: 'inventario' }]).ok).toBe(false);
  });
});

describe('armarDevolucionProveedor', () => {
  const disp = [{ sku_id: 10, modelo: 'Modelo A', sabor: 'Mango', disponible: 8 }];
  it('no devuelve mas de lo disponible (lo apartado no sale)', () => {
    expect(armarDevolucionProveedor(disp, [{ sku_id: 10, piezas: '9' }]).ok).toBe(false);
    expect(armarDevolucionProveedor(disp, [{ sku_id: 10, piezas: '8' }])).toEqual({ ok: true, valor: [{ sku_id: 10, piezas: 8 }] });
  });
  it('rechaza un sabor sin disponible y devolucion vacia', () => {
    expect(armarDevolucionProveedor(disp, [{ sku_id: 77, piezas: '1' }]).ok).toBe(false);
    expect(armarDevolucionProveedor(disp, [{ sku_id: 10, piezas: '' }]).ok).toBe(false);
  });
});

const lineas: RecepcionCompra['lineas'] = [
  { linea_id: 1, sku_id: 10, modelo: 'Modelo A', sabor: 'Mango', facturadas: 100, recibidas: 60, pendientes: 40, puesto_cent: 910000n, entrada_cent: 546000n },
  { linea_id: 2, sku_id: 11, modelo: 'Modelo A', sabor: 'Uva', facturadas: 100, recibidas: 0, pendientes: 100, puesto_cent: 910000n, entrada_cent: 0n },
];

describe('armarLlegada y progresoRecepcion', () => {
  it('suma por sabor y avisa, sin bloquear, si llega mas de lo pendiente', () => {
    const r = armarLlegada(lineas, [{ linea_id: 1, sku_id: 10, piezas: '45' }]);
    expect(r.ok).toBe(true);
    expect(r.avisos?.[0]).toContain('faltaban 40');
  });
  it('rechaza llegada vacia, decimales y renglones ajenos', () => {
    expect(armarLlegada(lineas, [{ linea_id: 1, sku_id: 10, piezas: '' }]).ok).toBe(false);
    expect(armarLlegada(lineas, [{ linea_id: 1, sku_id: 10, piezas: '1.5' }]).ok).toBe(false);
    expect(armarLlegada(lineas, [{ linea_id: 9, sku_id: 10, piezas: '1' }]).ok).toBe(false);
  });
  it('progreso: 60 de 200 facturadas es 30 %, y nunca pasa de 100', () => {
    expect(progresoRecepcion(lineas)).toBe(30);
    expect(progresoRecepcion(lineas.map((l) => ({ ...l, recibidas: l.facturadas + 5 })))).toBe(100);
    expect(progresoRecepcion([])).toBe(0);
  });
});

function fuente(tipo: 'cliente' | 'proveedor'): FuenteDevolucion {
  return {
    tipo, id: 1, folio: tipo === 'cliente' ? 'DV-0001' : 'DP-0001', emitida_at: '2026-11-12T18:00:00.000Z', texto: '',
    snapshot: {
      folio: tipo === 'cliente' ? 'DV-0001' : 'DP-0001', fecha: '2026-11-12', cliente: tipo === 'cliente' ? 'Cliente Ilustrativo' : undefined, proveedor: tipo === 'proveedor' ? 'Isaac' : undefined,
      pedido: 'P-0123', nota: 'P-0123', compra: 'C-0007', motivo: 'sabor equivocado', piezas_total: 12,
      lineas: [{ modelo: 'Modelo A', sabor: 'Mango', piezas: 10, precio_cent: 15000n, total_cent: 150000n, valor_cent: 91000n }, { modelo: 'Modelo A', sabor: 'Uva', piezas: 2, precio_cent: 15000n, total_cent: 30000n, valor_cent: 18200n, destino: 'merma' }],
      total_cent: 180000n, total_nota_cent: 450000n, liberado_cent: 130000n, valor_cent: 109200n, saldo_antes_cent: 50000n, saldo_despues_cent: 0n,
    },
  };
}

describe('PDF de devolucion', () => {
  it('mismo contenido, mismos bytes, misma huella', async () => {
    const a = await pdfDevolucion(fuente('cliente'));
    const b = await pdfDevolucion(fuente('cliente'));
    expect(huella(a)).toBe(huella(b));
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-');
  });
  it('la nota de credito y la devolucion a proveedor son documentos distintos', async () => {
    expect(huella(await pdfDevolucion(fuente('cliente')))).not.toBe(huella(await pdfDevolucion(fuente('proveedor'))));
  });
  it('cambiar un importe cambia la huella', async () => {
    const f = fuente('cliente');
    const g = fuente('cliente');
    g.snapshot.total_cent = 180100n;
    expect(huella(await pdfDevolucion(f))).not.toBe(huella(await pdfDevolucion(g)));
  });
});
