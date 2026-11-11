import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  claveCompacta,
  confirmarPar,
  contextoVacio,
  derivarMarcaYPuffs,
  descartarPar,
  elementoDeCola,
  encolar,
  mapeoDeModelo,
  mapeoDeSabor,
  normalizarModelo,
  normalizarSabor,
  resolverModelo,
  resolverSabor,
  similitudTrigramas,
} from '@/dominio/proveedores/normalizador';
import type { ContextoNormalizacion } from '@/dominio/proveedores/normalizador';
import { en } from './ayudas';

const ctx: ContextoNormalizacion = {
  modelos: [
    { id: 'm-steel', nombre: 'Waka Steel 60K' },
    { id: 'm-icon', nombre: 'Waka Icon 50K' },
    { id: 'm-blast', nombre: 'Waka Blast 50K' },
    { id: 'm-jupiter', nombre: 'Waka Jupiter 50K' },
    { id: 'm-te', nombre: 'Elf Bar TE6000' },
    { id: 'm-pulse', nombre: 'Geek Bar Pulse X' },
    { id: 'm-sopro', nombre: 'Waka Sopro 30K' },
  ],
  aliasModelos: [
    { alias: 'Waka 50', modeloIds: ['m-icon', 'm-blast', 'm-jupiter'] },
    { alias: 'Titan', modeloIds: ['m-sopro'] },
  ],
  sabores: [
    { id: 's-mango', nombre: 'Mango Ice' },
    { id: 's-uva', nombre: 'Uva' },
    { id: 's-blue', nombre: 'Blue Razz Lemonade' },
  ],
  aliasSabores: [{ textoNorm: 'fcucking fab', saborId: 's-fab' }],
  descartados: [],
};

describe('limpieza de nombres', () => {
  it('"60,000" y "60K" son lo mismo; sin acentos ni espacios dobles', () => {
    expect(normalizarModelo('Waka  Steel 60,000')).toBe('waka steel 60k');
    expect(normalizarModelo('WAKA STEEL 60K')).toBe('waka steel 60k');
    expect(normalizarModelo('Pílow Tálk 40,000')).toBe('pilow talk 40k');
    expect(normalizarModelo('Bot It 8,000')).toBe('bot it 8k');
  });

  it('un codigo de modelo no se abrevia ("TE6000" se queda)', () => {
    expect(normalizarModelo('Elf Bar TE6000')).toBe('elf bar te6000');
    expect(normalizarModelo('Naked 4,500')).toBe('naked 4500');
  });

  it('"ELFBAR TE6000" y "Elf Bar TE6000" comparten clave compacta', () => {
    expect(claveCompacta(normalizarModelo('ELFBAR TE6000'))).toBe(claveCompacta(normalizarModelo('Elf Bar TE6000')));
    expect(claveCompacta(normalizarModelo('GEEKBAR PULSE X'))).toBe(claveCompacta(normalizarModelo('Geek Bar Pulse X')));
  });

  it('sabores: insensible a mayusculas y se quita "ice" solo para comparar', () => {
    expect(normalizarSabor('MANGO Ice')).toBe('mango');
    expect(normalizarSabor('Sandía  Hielo')).toBe('sandia hielo');
  });

  it('propiedad: normalizar es idempotente y estable', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (t) => {
        const n = normalizarModelo(t);
        expect(normalizarModelo(n)).toBe(n);
        const s = normalizarSabor(t);
        expect(normalizarSabor(s)).toBe(s);
      }),
    );
  });
});

describe('similitud de trigramas', () => {
  it('identicos = 1, sin nada en comun = 0, vacio = 0', () => {
    expect(similitudTrigramas('mango', 'mango')).toBe(1);
    expect(similitudTrigramas('abc', 'xyz')).toBe(0);
    expect(similitudTrigramas('', 'mango')).toBe(0);
  });
  it('propiedad: simetrica y entre 0 y 1', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (a, b) => {
        const x = similitudTrigramas(a, b);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(x).toBeCloseTo(similitudTrigramas(b, a), 12);
      }),
    );
  });
});

describe('resolucion de modelos contra catalogo y alias', () => {
  it('nombre canonico, aunque cambie el espaciado o las mayusculas', () => {
    expect(resolverModelo('Elf Bar TE6000', ctx)).toEqual({ tipo: 'exacto', canonicoId: 'm-te' });
    expect(resolverModelo('ELFBAR TE6000', ctx)).toEqual({ tipo: 'exacto', canonicoId: 'm-te' });
    expect(resolverModelo('Waka Steel 60,000', ctx)).toEqual({ tipo: 'exacto', canonicoId: 'm-steel' });
  });
  it('alias de un solo modelo', () => {
    expect(resolverModelo('titan', ctx)).toEqual({ tipo: 'alias', canonicoId: 'm-sopro' });
  });
  it('alias de grupo ("Waka 50"): apunta a los tres, no a uno', () => {
    expect(resolverModelo('Waka 50', ctx)).toEqual({ tipo: 'grupo', ids: ['m-icon', 'm-blast', 'm-jupiter'] });
    expect(mapeoDeModelo({ tipo: 'grupo', ids: ['a', 'b'] })).toEqual({ mapeo: 'pendiente', canonicoId: null, gruposCandidatos: ['a', 'b'] });
  });
  it('un nombre parecido solo se sugiere, nunca se vincula solo', () => {
    const r = resolverModelo('Geek Bar Pulse X 15K', ctx);
    expect(r.tipo).toBe('sugerido');
    expect(mapeoDeModelo(r).mapeo).toBe('pendiente');
  });
  it('un nombre sin parecido queda sin resolver y no bloquea', () => {
    expect(resolverModelo('Zzzz Qqqq', ctx)).toEqual({ tipo: 'sin_resolver' });
    expect(resolverModelo('   ', ctx)).toEqual({ tipo: 'sin_resolver' });
    expect(mapeoDeModelo({ tipo: 'sin_resolver' })).toEqual({ mapeo: 'pendiente', canonicoId: null, gruposCandidatos: [] });
  });
  it('un par rechazado no se vuelve a sugerir', () => {
    const r = resolverModelo('Geek Bar Pulse X 15K', ctx);
    if (r.tipo !== 'sugerido') throw new Error('fixture');
    const d = descartarPar([], ctx, 'modelo', normalizarModelo('Geek Bar Pulse X 15K'), r.canonicoId);
    expect(resolverModelo('Geek Bar Pulse X 15K', d.ctx).tipo).toBe('sin_resolver');
  });
  it('catalogo vacio: todo queda sin resolver', () => {
    expect(resolverModelo('Waka Steel', contextoVacio())).toEqual({ tipo: 'sin_resolver' });
  });
});

describe('resolucion de sabores', () => {
  it('alias confirmado gana ("Fcucking Fab" con su errata)', () => {
    const r = resolverSabor('Fcucking Fab', ctx);
    expect(r).toEqual({ tipo: 'confirmado', saborId: 's-fab' });
    expect(mapeoDeSabor(r)).toEqual({ mapeo: 'confirmado', saborCanonicoId: 's-fab' });
  });
  it('coincidencia exacta normalizada, con o sin "ice"', () => {
    expect(resolverSabor('MANGO', ctx)).toEqual({ tipo: 'exacto', saborId: 's-mango' });
    expect(resolverSabor('Mango Ice', ctx)).toEqual({ tipo: 'exacto', saborId: 's-mango' });
    expect(mapeoDeSabor(resolverSabor('Uva', ctx))).toEqual({ mapeo: 'auto', saborCanonicoId: 's-uva' });
  });
  it('similitud >= 0.9 vincula solo; entre 0.6 y 0.9 queda por confirmar; menos, sin resolver', () => {
    const grande: ContextoNormalizacion = { ...ctx, sabores: [{ id: 's-1', nombre: 'Strawberry Watermelon Kiwi Banana Mango Peach' }] };
    expect(similitudTrigramas('strawberry watermelon kiwi banana mango peach', 'strawberry watermelon kiwi banana mango peac')).toBeGreaterThanOrEqual(0.9);
    const casi = resolverSabor('Strawberry Watermelon Kiwi Banana Mango Peac', grande);
    expect(casi.tipo).toBe('auto');
    expect(mapeoDeSabor(casi)).toEqual({ mapeo: 'auto', saborCanonicoId: 's-1' });
    // una errata corta de un sabor breve cae en la cola de confirmacion (0.6 a 0.9), no se vincula sola
    const chico: ContextoNormalizacion = { ...ctx, sabores: [{ id: 's-otono', nombre: 'Autumn' }] };
    expect(resolverSabor('Autum', chico)).toMatchObject({ tipo: 'por_confirmar', saborId: 's-otono' });
    const medio = resolverSabor('Strawberry Watermelon Peach', { ...ctx, sabores: [{ id: 's-2', nombre: 'Strawberry Watermelon Kiwi' }] });
    expect(medio.tipo).toBe('por_confirmar');
    expect(resolverSabor('Chocolate', grande)).toEqual({ tipo: 'sin_resolver' });
    expect(resolverSabor('', grande)).toEqual({ tipo: 'sin_resolver' });
    expect(resolverSabor('Blue Razz', ctx).tipo).toBe('sin_resolver');
    const porConfirmar = resolverSabor('Autum', chico);
    expect(mapeoDeSabor(porConfirmar)).toEqual({ mapeo: 'pendiente', saborCanonicoId: null });
  });
  it('un sabor rechazado no se vuelve a sugerir', () => {
    const chico: ContextoNormalizacion = { ...ctx, sabores: [{ id: 's-otono', nombre: 'Autumn' }] };
    const d = descartarPar([], chico, 'sabor', 'autum', 's-otono');
    expect(resolverSabor('Autum', d.ctx).tipo).toBe('sin_resolver');
  });
});

describe('cola de confirmacion', () => {
  it('no duplica y lo confirmado no se vuelve a preguntar', () => {
    const e = elementoDeCola('sabor', 'Blue Razz', en(0), 's-blue', 0.7);
    const a = encolar([], e);
    expect(a.agregado).toBe(true);
    expect(encolar(a.cola, e).agregado).toBe(false);
    const c = confirmarPar(a.cola, ctx, 'sabor', e.textoNorm, 's-blue');
    expect(c.cola).toEqual([]);
    expect(resolverSabor('Blue Razz', c.ctx)).toEqual({ tipo: 'confirmado', saborId: 's-blue' });
    // confirmar dos veces el mismo texto no acumula alias
    const otra = confirmarPar([], c.ctx, 'sabor', e.textoNorm, 's-blue');
    expect(otra.ctx.aliasSabores.filter((x) => x.textoNorm === e.textoNorm)).toHaveLength(1);
  });
  it('confirmar un modelo lo vuelve alias', () => {
    const e = elementoDeCola('modelo', 'Pulse X 15K', en(0), 'm-pulse', 0.6);
    const c = confirmarPar([e], ctx, 'modelo', e.textoNorm, 'm-pulse');
    expect(resolverModelo('Pulse X 15K', c.ctx)).toEqual({ tipo: 'alias', canonicoId: 'm-pulse' });
    expect(c.cola).toEqual([]);
  });
});

describe('marca y puffs derivados del titulo', () => {
  it.each([
    ['Waka Steel 60,000', 'Waka', 60000],
    ['Elf Bar TE6000', 'Elf Bar', 6000],
    ['ELFBAR BC Pro 40K', 'Elf Bar', 40000],
    ['Geek Bar Pulse X', 'Geek Bar', null],
    ['Naked 4,500', 'Naked', 4500],
    ['Kros Unlimited 6,000', 'Kros', 6000],
    ['Marca Desconocida 20,000', 'Marca', 20000],
    ['', 'Sin marca', null],
  ])('%s', (titulo, marca, puffs) => {
    expect(derivarMarcaYPuffs(titulo)).toEqual({ marca, puffs });
  });
});
