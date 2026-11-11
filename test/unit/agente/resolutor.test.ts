import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ID_TOMA_OMAR_BODEGA, resolverCliente, resolverModelo, resolverProveedor, resolverSabor, type EntradaCatalogo } from '@/dominio/agente/resolutor';

// Fixtures ILUSTRATIVOS (nombres de modelo del catalogo; clientes ficticios).
const MODELOS: EntradaCatalogo[] = [
  { id: 'm1', nombre: 'Waka Icon 50K', alias: [] },
  { id: 'm2', nombre: 'Waka Blast 50K', alias: [] },
  { id: 'm3', nombre: 'Waka Jupiter 50K', alias: ['jupiter'] },
  { id: 'm4', nombre: 'Waka Sopro 30K', alias: ['sopro', 'titan', 'waka 30'] },
  { id: 'm5', nombre: 'Waka Burst 36K', alias: ['burst'] },
  { id: 'm6', nombre: 'Fasta Burst 35K', alias: ['fasta burst 35'] },
  { id: 'm7', nombre: 'Fasta Burst 37K', alias: ['fasta burst 37'] },
  { id: 'm8', nombre: 'Nexa 50K', alias: [] },
];
const CLIENTES: EntradaCatalogo[] = [
  { id: 'c1', nombre: 'Cliente Norte', alias: ['el norte', 'norte'] },
  { id: 'c2', nombre: 'Cliente Sur', alias: ['sur'] },
  { id: 'c3', nombre: 'Omar Ejemplo', alias: ['ejemplo omar'] },
  { id: 'c4', nombre: 'Otto Ejemplo', alias: ['otto'] },
  { id: 'c5', nombre: 'Gemelo Uno', alias: ['gemelo'] },
  { id: 'c6', nombre: 'Gemelo Dos', alias: ['gemelo'] },
];
const SOCIO = { rol: 'socio' as const };
const OMAR = { rol: 'omar' as const };

describe('Waka 50: SIEMPRE pregunta', () => {
  it.each(['Waka 50', 'waka 50k', 'WAKA   50', 'waka-50'])('"%s" -> varios con las tres variantes', (t) => {
    const r = resolverModelo(t, MODELOS);
    expect(r.estado).toBe('varios');
    if (r.estado === 'varios') {
      expect(r.motivo).toBe('regla');
      expect(r.candidatos.map((c) => c.id).sort()).toEqual(['m1', 'm2', 'm3']);
    }
  });
  it('aunque el catalogo solo tenga una variante, pregunta igual', () => {
    const r = resolverModelo('waka 50', [MODELOS[0]!]);
    expect(r.estado).toBe('varios');
  });
  it('sin ninguna variante en el catalogo, no inventa: ninguno', () => {
    expect(resolverModelo('waka 50', [MODELOS[7]!]).estado).toBe('ninguno');
  });
  it('un alias propio ("jupiter") si resuelve', () => {
    expect(resolverModelo('jupiter', MODELOS)).toMatchObject({ estado: 'unico', id: 'm3' });
  });
});

describe('Omar a secas: SIEMPRE pregunta cuando lo escribe un socio', () => {
  it.each(['Omar', 'omar', ' OMAR ', 'Omár'])('"%s" -> varios entre la bodega y el cliente', (t) => {
    const r = resolverCliente(t, CLIENTES, SOCIO);
    expect(r.estado).toBe('varios');
    if (r.estado === 'varios') {
      expect(r.motivo).toBe('regla');
      expect(r.candidatos[0]).toEqual({ id: ID_TOMA_OMAR_BODEGA, nombre: 'Toma de Omar (bodega)' });
      expect(r.candidatos.some((c) => c.id === 'c3')).toBe(true);
    }
  });
  it('si Omar escribe "Omar" es su toma propia', () => {
    expect(resolverCliente('omar', CLIENTES, OMAR)).toEqual({ estado: 'toma_propia' });
  });
  it('aunque no exista cliente Omar, pregunta (solo la opcion de bodega)', () => {
    const r = resolverCliente('omar', CLIENTES.slice(0, 2), SOCIO);
    expect(r.estado).toBe('varios');
    if (r.estado === 'varios') expect(r.candidatos).toHaveLength(1);
  });
  it('"Omar Ejemplo" completo si resuelve', () => {
    expect(resolverCliente('Omar Ejemplo', CLIENTES, SOCIO)).toMatchObject({ estado: 'unico', id: 'c3' });
  });
});

describe('resolucion general', () => {
  it('alias exacto y por tokens', () => {
    expect(resolverCliente('el norte', CLIENTES, SOCIO)).toMatchObject({ estado: 'unico', id: 'c1', via: 'exacto' });
    expect(resolverCliente('Cliente Sur', CLIENTES, SOCIO)).toMatchObject({ estado: 'unico', id: 'c2' });
    expect(resolverModelo('icon', MODELOS)).toMatchObject({ estado: 'unico', id: 'm1', via: 'tokens' });
  });
  it('alias compartido -> varios', () => {
    const r = resolverCliente('gemelo', CLIENTES, SOCIO);
    expect(r).toMatchObject({ estado: 'varios', motivo: 'alias_compartido' });
  });
  it('tokens ambiguos -> varios (Fasta Burst sin cifra)', () => {
    expect(resolverModelo('fasta burst', MODELOS)).toMatchObject({ estado: 'varios', motivo: 'tokens' });
  });
  it('con la marca resuelve (35K vs 37K)', () => {
    expect(resolverModelo('fasta burst 37', MODELOS)).toMatchObject({ estado: 'unico', id: 'm7' });
  });
  it('vacio y sin coincidencia', () => {
    expect(resolverModelo('   ', MODELOS)).toEqual({ estado: 'vacio' });
    expect(resolverModelo('???', MODELOS)).toEqual({ estado: 'vacio' });
    expect(resolverModelo('zzzzzzzz', MODELOS)).toEqual({ estado: 'ninguno', sugerencias: [] });
  });
  it('un error de dedo solo SUGIERE, no decide', () => {
    const r = resolverModelo('jupitr', MODELOS);
    expect(r.estado).toBe('ninguno');
    if (r.estado === 'ninguno') expect(r.sugerencias.map((s) => s.id)).toContain('m3');
  });
  it('palabras cortas no generan sugerencias', () => {
    expect(resolverModelo('abc', MODELOS)).toEqual({ estado: 'ninguno', sugerencias: [] });
  });
  it('sabores: solo dentro de los que hay en existencia', () => {
    const sabores: EntradaCatalogo[] = [{ id: 's1', nombre: 'Sandia', alias: ['sandia ice'] }, { id: 's2', nombre: 'Mango', alias: [] }];
    expect(resolverSabor('sandía', sabores)).toMatchObject({ estado: 'unico', id: 's1' });
    expect(resolverSabor('fresa', sabores)).toMatchObject({ estado: 'ninguno' });
  });
  it('propiedad: nunca devuelve unico con un id fuera del catalogo', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (t) => {
        const r = resolverModelo(t, MODELOS);
        if (r.estado === 'unico') expect(MODELOS.some((m) => m.id === r.id)).toBe(true);
        if (r.estado === 'varios') expect(r.candidatos.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });
});

describe('proveedores', () => {
  it('Karen y Vapemate son el mismo proveedor', () => {
    expect(resolverProveedor('Karen')).toEqual({ estado: 'unico', id: 'karen', nombre: 'Karen' });
    expect(resolverProveedor('vapemate')).toEqual({ estado: 'unico', id: 'karen', nombre: 'Karen' });
    expect(resolverProveedor('Vape Mate')).toEqual({ estado: 'unico', id: 'karen', nombre: 'Karen' });
    expect(resolverProveedor('Isaac')).toEqual({ estado: 'unico', id: 'isaac', nombre: 'Isaac' });
  });
  it('Mr Cactus NO es alias: se pregunta', () => {
    expect(resolverProveedor('Mr Cactus')).toEqual({ estado: 'ninguno' });
  });
  it('dos proveedores en una indicacion: se pregunta, nunca se mezclan', () => {
    expect(resolverProveedor('Isaac y Karen')).toMatchObject({ estado: 'varios' });
  });
  it('vacio', () => {
    expect(resolverProveedor('')).toEqual({ estado: 'vacio' });
  });
});
