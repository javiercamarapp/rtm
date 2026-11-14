// Paridad TypeScript <-> SQL de la deteccion de duplicados: cada par del catalogo real (128 sabores) y varios nombres de modelos/clientes
// deben dar el MISMO puntaje, clase, motivo y bandera de ambiguedad en catalogo.comparar_nombres y en compararNombres.
// Se salta si no hay base: RTM_DB_URL=postgres://postgres:postgres@127.0.0.1:53322/<base> npx vitest run --config vitest.integracion.config.mts test/integracion/duplicados_paridad.test.ts
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import catalogo from '../fixtures/sabores_catalogo.json';
import { compararNombres, DICCIONARIO_AMBIGUO, DICCIONARIO_EXACTO, type TipoDuplicado } from '@/dominio/catalogo/duplicados';

const url = process.env.RTM_DB_URL;
const d = url ? describe : describe.skip;

d('paridad de la deteccion', () => {
  const c = new pg.Client({ connectionString: url });
  const listo = c.connect();
  afterAll(async () => { await listo; await c.end(); });

  async function comparar(tipo: TipoDuplicado, pares: [string, string][]) {
    await listo;
    const { rows } = await c.query<{ r: { puntaje: number; clase: string; motivo: string; ambiguo: boolean } }>(
      'select catalogo.comparar_nombres($1, x.a, x.b) as r from unnest($2::text[], $3::text[]) with ordinality x(a, b, o) order by x.o',
      [tipo, pares.map((p) => p[0]), pares.map((p) => p[1])],
    );
    return rows.map((x) => x.r);
  }

  it('el diccionario de la base es el del codigo', async () => {
    await listo;
    const { rows } = await c.query<{ token: string; reemplazo: string; ambiguo: boolean }>('select token, reemplazo, ambiguo from catalogo.diccionario_sabor');
    const base = Object.fromEntries(rows.map((r) => [`${r.ambiguo ? 'A' : 'E'}:${r.token}`, r.reemplazo]));
    const codigo = { ...Object.fromEntries(Object.entries(DICCIONARIO_EXACTO).map(([k, v]) => [`E:${k}`, v])), ...Object.fromEntries(Object.entries(DICCIONARIO_AMBIGUO).map(([k, v]) => [`A:${k}`, v])) };
    expect(base).toEqual(codigo);
  });

  it('8,128 pares de sabores reales', async () => {
    const cat = (catalogo as { nombre: string }[]).map((x) => x.nombre);
    const pares: [string, string][] = [];
    for (let i = 0; i < cat.length; i++) for (let j = i + 1; j < cat.length; j++) pares.push([cat[i]!, cat[j]!]);
    const sql = await comparar('sabor', pares);
    const malos: string[] = [];
    pares.forEach(([a, b], i) => {
      const ts = compararNombres('sabor', a, b);
      const q = sql[i]!;
      if (ts.puntaje !== q.puntaje || ts.clase !== q.clase || ts.motivo !== q.motivo || ts.ambiguo !== q.ambiguo) malos.push(`${a} | ${b}: TS ${JSON.stringify(ts)} SQL ${JSON.stringify(q)}`);
    });
    expect(malos.slice(0, 5)).toEqual([]);
  });

  it.each(['sabor', 'modelo', 'cliente'] as const)('casos sinteticos (%s)', async (tipo) => {
    const nombres = ['Waka Blade', 'Waka Blade 50K', 'wakablade', 'Alex Perez', 'Alex', 'Sandia', 'Watermelon', 'Fresa', 'Straw Banana', 'Strawberry Banana', 'Strawberries Bananas', 'BP', 'Black Pepper', 'Mint 2', 'Mint 3', 'Ñoño', 'Nono', 'Icy Peach', 'Peach Ice', 'Maracuyá', 'Passion Fruit', 'Coco Mint', 'Coconut Mint', 'x', '', 'Cool Mint', 'Coolmint', 'Mora Azul', 'Blackberry Blue'];
    const pares: [string, string][] = [];
    for (const a of nombres) for (const b of nombres) pares.push([a, b]);
    const sql = await comparar(tipo, pares);
    pares.forEach(([a, b], i) => {
      const ts = compararNombres(tipo, a, b);
      expect({ a, b, ...ts }).toEqual({ a, b, ...sql[i]! });
    });
  });
});
