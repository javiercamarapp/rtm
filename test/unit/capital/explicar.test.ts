import { describe, expect, it } from 'vitest';
import { explicarCapital, idCifraCapital, leerCifraCapital } from '@/dominio/capital/explicar';
import { capitalFixture } from '../../fixtures/reportes/capital';

const D = capitalFixture();
const id = (mes: string, campo: string, sujeto: string) => `capital:2026-10-01:2026-11-30:${mes}:${campo}:${sujeto}`;

describe('identificador de cifra de capital', () => {
  it('va y viene', () => {
    const c = { desde: '2026-10-01', hasta: '2026-11-30', mes: '2026-11', campo: 'fondos' as const, sujeto: 'Javier' };
    expect(leerCifraCapital(idCifraCapital(c))).toEqual(c);
  });
  it('rechaza lo que no es una cifra de capital', () => {
    for (const x of ['capital:x', 'capital:2026-10-01:2026-11-30:2026-11:inventado:Javier', 'capital:2026-10-01:2026-11-30:2026-11:fondos:Otro', 'socios:cuadre', 'capital:2026-10-01:2026-11-30:acum:fondos:Javier; drop']) expect(leerCifraCapital(x)).toBeNull();
  });
});

describe('Explicar este numero de capital', () => {
  it('aportaciones: fuente, dos vias y el renglon con fecha y origen', () => {
    const e = explicarCapital(D, id('2026-10', 'aportaciones', 'Angelo'), 'Javier')!;
    expect(e.valor).toBe(11816191);
    expect(e.fuente).toContain('Mayor');
    expect(e.comprobacion?.cuadra).toBe(true);
    expect(e.renglones).toHaveLength(1);
    expect(e.renglones[0]!.concepto).toContain('Caja: Caja de la empresa');
    expect(e.renglones[0]!.fechaNeg).toBe('2026-10-15');
  });
  it('utilidad: la suma de los dos socios es la del Estado de resultados', () => {
    const e = explicarCapital(D, id('2026-11', 'utilidad', 'total'), null)!;
    expect(e.valor).toBe(5366073);
    expect(e.comprobacion).toMatchObject({ via1Valor: 5366073, via2Valor: 5366073, cuadra: true });
  });
  it('fondos: el titulo respeta la segunda persona y el motivo trae el cobro', () => {
    expect(explicarCapital(D, id('2026-11', 'fondos', 'Javier'), 'Javier')!.titulo).toContain('Fondos de la sociedad retirados por ti');
    expect(explicarCapital(D, id('2026-11', 'fondos', 'Javier'), 'Angelo')!.titulo).toContain('Fondos de la sociedad retirados por Javier');
    const e = explicarCapital(D, id('2026-11', 'fondos', 'Javier'), 'Javier')!;
    expect(e.renglones[0]!.concepto).toContain('Pago PG-0001 en la cuenta de Javier');
    expect(e.renglones[0]!.concepto).toContain('Cliente Demo');
  });
  it('reinvertida: acta mas proveedor y aviso de que lo que excede es anticipo', () => {
    const e = explicarCapital(D, id('2026-11', 'reinvertida', 'Angelo'), null)!;
    expect(e.valor).toBe(750000);
    expect(e.comprobacion).toMatchObject({ via1Valor: 750000, via2Valor: 750000, cuadra: true });
    expect(e.renglones.some((r) => r.concepto.includes('Reinvertida en el proveedor'))).toBe(true);
  });
  it('valuacion: la suma de los dos es el capital contable', () => {
    const e = explicarCapital(D, id('2026-11', 'valuacion', 'total'), null)!;
    expect(e.comprobacion).toMatchObject({ via1: 'Suma de valuaciones personales', via1Valor: 27453764, via2Valor: 27453764, cuadra: true });
  });
  it('por clasificar: no se presenta como inventario ni saldo a favor', () => {
    const e = explicarCapital(D, id('2026-10', 'clasif', 'Isaac'), null)!;
    expect(e.valor).toBe(6216191);
    expect(e.renglones[0]!.concepto).toContain('no es inventario ni saldo a favor');
  });
  it('proveedor: Karen se le debe, Isaac saldo a favor sin contar lo por clasificar', () => {
    expect(explicarCapital(D, id('2026-11', 'prov', 'Karen'), null)!.titulo).toContain('se le debe');
    const i = explicarCapital(D, id('2026-11', 'prov', 'Isaac'), null)!;
    expect(i.titulo).toContain('saldo a favor');
    expect(i.valor).toBe(-500000);
  });
  it('cifras de un mes o socio que no existen no se explican (nada inventado)', () => {
    expect(explicarCapital(D, id('2026-09', 'utilidad', 'Angelo'), null)).toBeNull();
    expect(explicarCapital(D, id('2026-11', 'prov', 'Karen').replace('Karen', 'Isaac').replace('prov', 'comp'), null)).toBeNull();
  });
});
