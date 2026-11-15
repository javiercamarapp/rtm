import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ambiguosDeDiccionario, bloqueosReales, cargarPares, paresDeDiccionario, sqlAplicar as sqlAlias } from '../../../scripts/catalogo/unificar-alias-waka.mjs';
import { aCentavos, clasificar, proponer, sqlAplicar as sqlTab, validarDatos } from '../../../scripts/catalogo/cargar-tabulador.mjs';

// Datos ficticios: nada de clientes, precios ni ventas reales.
describe('unificar alias Waka', () => {
  it('los pares salen del diccionario y no incluyen un nombre igual a su destino', () => {
    const pares = paresDeDiccionario({ alias: [{ alias: 'Waka Zeta', tambien: ['Zeta', 'Waka Zeta 10K'], destino: 'Waka Zeta 10K' }] });
    expect(pares).toEqual([{ origen: 'Waka Zeta', destino: 'Waka Zeta 10K' }, { origen: 'Zeta', destino: 'Waka Zeta 10K' }]);
  });
  it('el diccionario real: Optimus va a 100K y ningun origen se repite', () => {
    const pares = cargarPares();
    expect(pares.find((p: { origen: string }) => p.origen === 'Optimus')?.destino).toBe('Waka Optimus 100K');
    expect(new Set(pares.map((p: { origen: string }) => p.origen.toLowerCase())).size).toBe(pares.length);
  });
  it('v3: Burst, Waka Burst y Waka Burst 36K van a Waka 36K', () => {
    const pares = cargarPares();
    for (const o of ['Waka Burst', 'Burst', 'Waka Burst 36K']) expect(pares.find((p: { origen: string }) => p.origen === o)?.destino).toBe('Waka 36K');
  });
  it('v3: los destinos ambiguos (Waka 50K, Waka 15K, Waka Sopro 30K) no son destino ni origen de ninguna union', () => {
    const pares = cargarPares();
    const prohibidos = ['waka 50k', 'waka 15k', 'waka sopro 30k'];
    for (const p of pares as { origen: string; destino: string }[]) {
      expect(prohibidos).not.toContain(p.destino.toLowerCase());
      expect(prohibidos).not.toContain(p.origen.toLowerCase());
    }
    expect(pares.find((p: { origen: string }) => p.origen === 'Waka Icon')?.destino).toBe('Waka Icon 50K');
    expect(pares.find((p: { origen: string }) => p.origen === 'Waka SoPro')).toBeUndefined();
    expect(ambiguosDeDiccionario(JSON.parse(readFileSync(new URL('../../../scripts/catalogo/alias-waka.json', import.meta.url), 'utf8'))).map((a: { texto: string }) => a.texto))
      .toEqual(['Waka 50K', 'Waka 15K', 'Waka Sopro 30K']);
  });
  it('v3: Blade (costo 200) va antes que Waka Blade, cuyo costo queda como historia', () => {
    const pares = cargarPares();
    const iBlade = pares.findIndex((p: { origen: string }) => p.origen === 'Blade');
    const iWaka = pares.findIndex((p: { origen: string }) => p.origen === 'Waka Blade');
    expect(iBlade).toBeGreaterThanOrEqual(0);
    expect(iBlade).toBeLessThan(iWaka);
    expect(pares[iWaka]).toMatchObject({ destino: 'Waka Blade 33K', costoHistorico: true });
    expect(pares[iBlade]!.costoHistorico).toBeUndefined();
  });
  it('un alias sin destino no se une', () => {
    expect(paresDeDiccionario({ alias: [{ alias: 'X', destino: null, tambien: ['Y'] }] })).toEqual([]);
  });
  it('los bloqueos de precio y costo vigentes se heredan; los demas siguen bloqueando', () => {
    expect(bloqueosReales(['tiene existencia', 'tiene un precio de cliente vigente que el destino no tiene: fijalo primero en el destino', 'tiene un costo de lista vigente que el destino no tiene: x'])).toEqual(['tiene existencia']);
  });
  it('el SQL de aplicar es una transaccion con guarda de huella, regla aprobada y sin escribir en tablas inmutables', () => {
    const sql = sqlAlias([{ origen: 'A', destino: 'B' }]);
    expect(sql).toMatch(/^begin;/);
    expect(sql).toMatch(/commit;\s*$/);
    expect(sql).toContain('catalogo.huella_inmutables()');
    expect(sql).toContain("'alias-waka-2026-11-14'");
    expect(sql).toContain('catalogo.unificar_modelo(');
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+(operacion|contabilidad)\./i);
    expect(sqlAlias([{ origen: 'A', destino: 'B' }], { omitirBloqueados: true })).toContain('v_omitir boolean := true');
  });
  it('el costo historico no se hereda ni bloquea', () => {
    const sql = sqlAlias([{ origen: 'A', destino: 'B', costoHistorico: true }]);
    expect(sql).toContain("('A', 'B', true)");
    expect(sql).toContain('not r.costo_historico');
  });
  it("escapa comillas en los nombres", () => {
    expect(sqlAlias([{ origen: "O'Brien", destino: 'B' }])).toContain("'O''Brien'");
  });
});

describe('cargar tabulador', () => {
  it('precio unico y redondo se propone; varios precios o centavos raros quedan ambiguos', () => {
    expect(clasificar([{ precio_cent: 17500 }])).toMatchObject({ estado: 'propuesto', precio_cent: 17500 });
    expect(clasificar([{ precio_cent: 22450 }])).toMatchObject({ estado: 'propuesto', precio_cent: 22450 });
    expect(clasificar([{ precio_cent: 17000 }, { precio_cent: 17500 }])).toMatchObject({ estado: 'ambiguo', precio_cent: null });
    expect(clasificar([{ precio_cent: 24341 }])).toMatchObject({ estado: 'ambiguo', motivo: expect.stringContaining('prorrateado') });
    expect(clasificar([{ precio_cent: 16903 }, { precio_cent: 16904 }]).estado).toBe('ambiguo');
  });
  it('proponer agrupa por cliente y modelo', () => {
    const r = proponer([
      { cliente: 'C1', modelo: 'M1', precio_cent: 10000, lineas: 2, pedidos: 1, piezas: 10 },
      { cliente: 'C1', modelo: 'M1', precio_cent: 10000, lineas: 1, pedidos: 1, piezas: 5 },
      { cliente: 'C2', modelo: 'M1', precio_cent: 12001, lineas: 1, pedidos: 1, piezas: 1 },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ cliente: 'C1', estado: 'propuesto', precio_pesos: 100, lineas: 3, piezas: 15 });
    expect(r[1]).toMatchObject({ cliente: 'C2', estado: 'ambiguo', precio_pesos: null });
  });
  it('convierte pesos a centavos sin errores de coma flotante', () => {
    expect(aCentavos(243.42)).toBe(24342);
    expect(aCentavos(188.39)).toBe(18839);
    expect(aCentavos(0.1 + 0.2)).toBe(30);
  });
  it('valida el archivo privado y rechaza repetidos o precios invalidos', () => {
    expect(validarDatos([{ cliente: 'C', modelo: 'M', precio_pesos: 100 }])).toHaveLength(1);
    expect(() => validarDatos([{ cliente: 'C', modelo: 'M', precio_pesos: 0 }])).toThrow();
    expect(() => validarDatos([{ cliente: 'C', modelo: 'M', precio_pesos: 1 }, { cliente: 'c', modelo: 'm', precio_pesos: 2 }])).toThrow(/repetida/);
    expect(() => validarDatos([])).toThrow();
  });
  it('el SQL usa la funcion oficial, es idempotente y deja la marca de la carga historica', () => {
    const sql = sqlTab([{ cliente: 'C', modelo: 'M', precio_pesos: 100 }]);
    expect(sql).toContain('catalogo.fijar_precio(');
    expect(sql).toContain('catalogo.huella_inmutables()');
    expect(sql).toContain('carga historica 2026-11-14');
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\s+(catalogo\.tabulador_precio|operacion\.)/i);
    expect(sqlTab([{ cliente: 'C', modelo: 'M', precio_pesos: 100 }], { reemplazar: true })).toContain('v_reemplazo boolean := true');
  });
  it('el repo no lleva datos reales de la carga', () => {
    for (const f of ['unificar-alias-waka.mjs', 'cargar-tabulador.mjs']) {
      const t = readFileSync(new URL(`../../../scripts/catalogo/${f}`, import.meta.url), 'utf8');
      expect(t).not.toMatch(/postgres:\/\/postgres:[^.]/);
    }
  });
});
