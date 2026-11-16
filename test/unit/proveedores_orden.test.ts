import { describe, expect, it } from 'vitest';
import { armarModelosOrden, lineasDeOrden, type SkuCompra } from '@/dominio/proveedores/orden';

const sku = (id: number, modelo: string, sabor: string, costo: bigint | null = 9000n, marca = 'NEXA'): SkuCompra => ({ sku_id: id, modelo, marca, sabor, costo_cent: costo });
const SKUS = [sku(1, 'NEXA ULTRA 50K', 'Blue Razz Ice'), sku(2, 'NEXA ULTRA 50K', 'Mango Oasis'), sku(3, 'NEXA ULTRA 50K', 'Sour Watermelon', null), sku(4, 'VHILL 3K', 'Cool Mint', 5000n, 'VHILL')];

describe('orden de compra desde el stock', () => {
  it('con lectura: marca disponibles, los pone primero y cuenta por modelo', () => {
    const disp = new Map([['nexa ultra 50k', new Set(['mango oasis', 'sour watermelon'])]]);
    const m = armarModelosOrden(SKUS, disp);
    const nexa = m.find((x) => x.modelo === 'NEXA ULTRA 50K')!;
    expect(nexa.disponibles).toBe(2);
    expect(nexa.sabores.map((s) => [s.sabor, s.disponible])).toEqual([['Mango Oasis', true], ['Sour Watermelon', true], ['Blue Razz Ice', false]]);
    expect(m[0]!.modelo).toBe('NEXA ULTRA 50K'); // modelos con disponibles primero
    expect(m.find((x) => x.modelo === 'VHILL 3K')!.sabores[0]!.disponible).toBe(false); // modelo sin lectura = agotado
  });
  it('sin lectura (Isaac): disponibilidad por confirmar (null) y se conserva el costo vigente', () => {
    const m = armarModelosOrden(SKUS, null);
    expect(m.flatMap((x) => x.sabores).every((s) => s.disponible === null)).toBe(true);
    expect(m.flatMap((x) => x.sabores).find((s) => s.skuId === 3)!.costoCent).toBeNull();
  });
  it('lineas de la orden: solo enteros positivos, ordenados por sku', () => {
    expect(lineasDeOrden(new Map([[4, 10], [1, 5], [2, 0], [3, -2], [5, 1.5]]))).toEqual([{ sku_id: 1, pagadas: 5 }, { sku_id: 4, pagadas: 10 }]);
    expect(lineasDeOrden(new Map())).toEqual([]);
  });
});
