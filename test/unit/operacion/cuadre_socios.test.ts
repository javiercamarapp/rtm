// "Explicar este numero" del Libro conciliado: ordena las verificaciones que ya calculo la base; no decide nada.
import { describe, expect, it } from 'vitest';
import { explicarCuadreSocios } from '@/dominio/operacion/cuadre';
import type { CuentaSocios, VerificacionCuadre } from '@/dominio/operacion/tipos';

const v = (id: string, grupo: VerificacionCuadre['grupo'], a: bigint, b: bigint, extra: Partial<VerificacionCuadre> = {}): VerificacionCuadre =>
  ({ id, grupo, nombre: `Verificacion ${id}`, a_nombre: 'Lado A', a_cent: a, b_nombre: 'Lado B', b_cent: b, ok: a === b, ...extra });

const cuenta = (vs: VerificacionCuadre[]): CuentaSocios => {
  const fallas = vs.filter((x) => !x.ok).length;
  return { cuadre: { libro_conciliado: fallas === 0, fallas, estado: fallas === 0 ? 'conciliado' : 'revisar', etiqueta: fallas === 0 ? 'Libro conciliado' : 'Revisar el libro', pendiente_proveedor_cent: 0n, verificaciones: vs } } as unknown as CuentaSocios;
};

describe('explicarCuadreSocios', () => {
  it('con todas las identidades cumplidas dice conciliado y compara cumplidas contra verificadas', () => {
    const e = explicarCuadreSocios(cuenta([v('a', 'auxiliares', 100n, 100n), v('b', 'partida_doble', 5n, 5n, { unidad: 'n' })]));
    expect(e.cifra).toBe('socios:cuadre');
    expect(e.valor).toBe(0);
    expect(e.comprobacion).toMatchObject({ via1Valor: 2, via2Valor: 2, cuadra: true });
    expect(e.renglones).toHaveLength(2);
    expect(e.renglones[0]!.concepto).toContain('coincide');
    expect(e.renglones[1]!.concepto).toContain('5 contra');
  });

  it('una identidad rota se explica con sus dos lados y la diferencia, y no depende de cuanto puso cada socio', () => {
    const e = explicarCuadreSocios(cuenta([v('a', 'auxiliares', 12_345n, 0n), v('b', 'efectivo_repartido', 7n, 7n, { detalle: null })]));
    expect(e.valor).toBe(1);
    expect(e.comprobacion).toMatchObject({ via1Valor: 1, via2Valor: 2, cuadra: false });
    expect(e.renglones[0]!.concepto).toContain('NO coincide');
    expect(e.renglones[0]!.concepto).toContain('$123.45');
    expect(e.renglones[0]!.montoCent).toBe(12_345n);
    expect(e.renglones[1]!.montoCent).toBe(0n);
  });

  it('incluye el detalle de la falla cuando la base lo da', () => {
    const e = explicarCuadreSocios(cuenta([v('c', 'efectivo_repartido', 0n, 0n, { ok: false, detalle: 'el efectivo de la caja no puede ser negativo' })]));
    expect(e.renglones[0]!.concepto).toContain('el efectivo de la caja no puede ser negativo');
  });
});
