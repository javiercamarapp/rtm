import { describe, expect, it } from 'vitest';
import { origenSurtido, interesCredito, previewPedido, repartoSocios, semanasHasta, utilidadReinvertida } from '@/dominio/dropshipping/calculos';
import { agruparRenglones, textoOrden } from '@/dominio/dropshipping/orden';

describe('origen de surtido', () => {
  it('los directos son dropshipping (incluye isaac_directo) y la bodega es inventario en Merida', () => {
    expect(origenSurtido('karen_directo')).toBe('dropshipping');
    expect(origenSurtido('karen_via_isaac')).toBe('dropshipping');
    expect(origenSurtido('isaac_directo')).toBe('dropshipping');
    expect(origenSurtido('bodega_omar')).toBe('inventario_merida');
    expect(origenSurtido('castores')).toBe('inventario_merida');
  });
});

describe('interes de credito (espejo de la base)', () => {
  it('ejemplo del dueno: 200 x 130.00 = 26,000.00 a una semana al 10 % => 28,600.00', () => {
    expect(interesCredito(2_600_000n, 1000, 1)).toBe(260_000n);
    expect(2_600_000n + interesCredito(2_600_000n, 1000, 1)).toBe(2_860_000n);
  });
  it('simple por omision: tres semanas = 3 x 10 %', () => expect(interesCredito(2_600_000n, 1000, 3)).toBe(780_000n));
  it('compuesto es una opcion explicita', () => expect(interesCredito(1_000_000n, 1000, 2, 'compuesto')).toBe(210_000n));
  it('medio hacia arriba al centavo', () => {
    expect(interesCredito(1n, 1000, 1)).toBe(0n);
    expect(interesCredito(5n, 1000, 1)).toBe(1n);
  });
  it('rechaza porcentaje o semanas fuera de rango', () => {
    expect(() => interesCredito(100n, 20000, 1)).toThrow();
    expect(() => interesCredito(100n, 1000, 300)).toThrow();
    expect(() => interesCredito(-1n, 1000, 1)).toThrow();
  });
  it('semanas hasta la fecha de pago, hacia arriba y minimo una', () => {
    expect(semanasHasta('2026-11-13', '2026-11-20')).toBe(1);
    expect(semanasHasta('2026-11-13', '2026-11-28')).toBe(3);
    expect(semanasHasta('2026-11-13', '2026-11-13')).toBe(1);
    expect(() => semanasHasta('2026-11-13', '2026-11-12')).toThrow();
  });
});

describe('vista previa del pedido', () => {
  it('100 pzas a 104.80 con costo de Karen de 89.29: margen 1,551.00', () => {
    const p = previewPedido([{ piezas: 100, precioCent: 10480n, costoCent: 8929n }], 0n, 0n, null);
    expect(p.ventaMercanciaCent).toBe(1_048_000n);
    expect(p.costoCent).toBe(892_900n);
    expect(p.margenCent).toBe(155_100n);
    expect(p.totalCent).toBe(1_048_000n);
    expect(p.margenPct).toBeCloseTo(14.8, 1);
  });
  it('con credito: interes de una semana al 10 % sobre la mercancia, sin envio', () => {
    const p = previewPedido([{ piezas: 200, precioCent: 13000n, costoCent: 8929n }], 30_000n, 0n, { tasaBp: 1000, semanas: 1, modo: 'simple' });
    expect(p.interesCent).toBe(260_000n);
    expect(p.totalCent).toBe(2_600_000n + 30_000n + 260_000n);
  });
  it('monto pactado fijo manda sobre el porcentaje', () => {
    const p = previewPedido([{ piezas: 10, precioCent: 13000n, costoCent: 8929n }], 0n, 0n, { tasaBp: 1000, semanas: 1, modo: 'simple', interesFijoCent: 12_345n });
    expect(p.interesCent).toBe(12_345n);
  });
  it('utilidad = venta con envio e interes menos TODO el costo (producto y envio del proveedor)', () => {
    // 40 x 150.00 = 6,000.00 + envio cobrado 300.00 + interes 600.00 = 6,900.00; costo 40 x 89.29 = 3,571.60 + envio del proveedor 250.00 => utilidad 3,078.40
    const p = previewPedido([{ piezas: 40, precioCent: 15000n, costoCent: 8929n }], 30_000n, 0n, { tasaBp: 1000, semanas: 1, modo: 'simple' }, 25_000n);
    expect(p.totalCent).toBe(690_000n);
    expect(p.utilidadCent).toBe(307_840n);
    expect(repartoSocios(p.utilidadCent ?? 0n, [{ socio: 'A', ppm: 500_000 }, { socio: 'B', ppm: 500_000 }]).map((x) => x.montoCent)).toEqual([153_920n, 153_920n]);
  });
  it('sin costo vigente no inventa costo ni margen', () => {
    const p = previewPedido([{ piezas: 10, precioCent: 13000n, costoCent: null }], 0n, 0n, null);
    expect(p.costoCent).toBeNull();
    expect(p.margenCent).toBeNull();
    expect(p.sinCosto).toBe(1);
  });
});

describe('reparto 50/50 y utilidad reinvertida', () => {
  const partes = [{ socio: 'Angelo', ppm: 500_000 }, { socio: 'Javier', ppm: 500_000 }];
  it('caso del dueno: venta 10,480, costo 8,929 => utilidad 1,551 => 775.50 por socio', () => {
    expect(repartoSocios(155_100n, partes).map((x) => x.montoCent)).toEqual([77_550n, 77_550n]);
  });
  it('centavo impar: el primero redondea hacia arriba y el ultimo recibe el resto', () => {
    const r = repartoSocios(155_101n, partes);
    expect(r.map((x) => x.montoCent)).toEqual([77_551n, 77_550n]);
    expect(r.reduce((a, x) => a + x.montoCent, 0n)).toBe(155_101n);
  });
  it('venta depositada completa en el proveedor: todo el excedente queda reinvertido', () => {
    expect(utilidadReinvertida(1_048_000n, 892_900n, 1_048_000n, false)).toEqual({ utilidadCent: 155_100n, reinvertidaCent: 155_100n });
  });
  it('pagos parciales amortizan primero el costo: nada reinvertido hasta cubrirlo', () => {
    expect(utilidadReinvertida(1_048_000n, 892_900n, 500_000n, false).reinvertidaCent).toBe(0n);
    expect(utilidadReinvertida(1_048_000n, 892_900n, 1_000_000n, false).reinvertidaCent).toBe(107_100n);
  });
  it('una venta a costo (socio a su menudeo) no genera utilidad', () => {
    expect(utilidadReinvertida(446_450n, 446_450n, 446_450n, true)).toEqual({ utilidadCent: 0n, reinvertidaCent: 0n });
  });
  it('lo depositado de mas no excede la utilidad', () => {
    expect(utilidadReinvertida(1_048_000n, 892_900n, 5_000_000n, false).reinvertidaCent).toBe(155_100n);
  });
});

describe('texto de la orden para el proveedor (igual que la funcion SQL)', () => {
  const grupos = agruparRenglones([
    { marca: 'DS Marca', modelo: 'DS Modelo 25K', sabor: 'Uva', piezas: 25 },
    { marca: 'DS Marca', modelo: 'DS Modelo 25K', sabor: 'Fresa', piezas: 40 },
    { marca: 'DS Marca', modelo: 'DS Modelo 25K', sabor: 'Mango', piezas: 35 },
  ]);
  it('agrupa por marca y modelo con sabores en orden', () => {
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.piezas).toBe(100);
    expect(grupos[0]?.sabores.map((s) => s.sabor)).toEqual(['Fresa', 'Mango', 'Uva']);
  });
  it('lleva el bloque de destinatario y no lleva precios', () => {
    const t = textoOrden('P-0001', grupos, { nombre: 'Persona Sintetica Uno', calle_numero: 'Calle Ficticia 123', colonia: 'Colonia Imaginaria', cp: '97000', municipio: 'Municipio Ejemplo', estado: 'Estado Ejemplo', telefono: '9990001111', correo: 'destino.sintetico@example.test', referencias: 'Porton azul de prueba' });
    expect(t).toBe(`Pedido P-0001

DS Marca DS Modelo 25K (100 pzas)
- Fresa x 40
- Mango x 35
- Uva x 25

Total: 100 pzas

Entregar a:
Persona Sintetica Uno
Calle Ficticia 123, Colonia Imaginaria, CP 97000
Municipio Ejemplo, Estado Ejemplo
Tel: 9990001111
Correo: destino.sintetico@example.test
Referencias: Porton azul de prueba`);
    expect(t).not.toMatch(/\$|104\.80|89\.29/);
  });
  it('sin destinatario no hay bloque de entrega', () => {
    expect(textoOrden('P-9', [{ marca: 'M', modelo: 'X', piezas: 2, sabores: [{ sabor: 'A', piezas: 2 }] }], null)).toBe('Pedido P-9\n\nM X (2 pzas)\n- A x 2\n\nTotal: 2 pzas');
  });
  it('120 piezas en 15 sabores: una linea por sabor', () => {
    const sabores = Array.from({ length: 15 }, (_, i) => ({ marca: 'M', modelo: 'X', sabor: `Sabor ${String(i + 1).padStart(2, '0')}`, piezas: 8 }));
    const t = textoOrden('P-120', agruparRenglones(sabores), null);
    expect(t.match(/\n- Sabor \d+ x 8/g)).toHaveLength(15);
    expect(t).toContain('M X (120 pzas)');
    expect(t).toContain('Total: 120 pzas');
  });
});
