import { describe, expect, it } from 'vitest';
import type { Pulso } from '@/dominio/notificaciones/tipos';
import { centavosABigint } from '@/dominio/operacion/json';
import { presentarPorPagar } from '@/dominio/operacion/por_pagar';

// Forma real de api.pulso().por_pagar (migracion 20261114700100): Isaac 500.00 + Karen 200.00 + renta de Omar 9.60 = 709.60.
const real = {
  por_pagar_isaac_cent: 50000, por_cobrar_cent: null, entre_socios: null, en_bodega: null,
  por_pagar: { total_cent: 70960, a_favor_cent: 0, renglones: [
    { clave: 'isaac', etiqueta: 'Isaac', monto_cent: 50000 }, { clave: 'karen', etiqueta: 'Karen', monto_cent: 20000 }, { clave: 'renta_omar', etiqueta: 'Renta de Omar', monto_cent: 960, piezas: 480 } ] },
};

describe('Por pagar con el renglon de Omar', () => {
  it('las claves *_cent llegan como bigint y el total incluye la renta', () => {
    const p = centavosABigint<Pulso>(real).por_pagar!;
    expect(p.renglones.map((r) => r.monto_cent)).toEqual([50000n, 20000n, 960n]);
    expect(p.renglones.reduce((a, r) => a + r.monto_cent, 0n)).toBe(p.total_cent);
  });
  it('cada renglon se ve separado y el total los suma', () => {
    const v = presentarPorPagar(centavosABigint<Pulso>(real).por_pagar);
    expect(v.texto).toBe('$709.60');
    expect(v.detalle).toBe('Isaac $500.00 · Karen $200.00 · Renta de Omar $9.60');
    expect(v.partes.map((x) => x.etiqueta)).toEqual(['Isaac', 'Karen', 'Renta de Omar']);
  });
  it('sin datos de la base dice Sin dato (null), no un cero inventado; un renglon en cero no entra a la barra', () => {
    expect(presentarPorPagar(null)).toEqual({ texto: null, detalle: null, partes: [] });
    const v = presentarPorPagar({ total_cent: 960n, a_favor_cent: 0n, renglones: [{ clave: 'isaac', etiqueta: 'Isaac', monto_cent: 0n }, { clave: 'renta_omar', etiqueta: 'Renta de Omar', monto_cent: 960n }] });
    expect(v.partes.map((x) => x.etiqueta)).toEqual(['Renta de Omar']);
  });
});
