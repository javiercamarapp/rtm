import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { claveCorreccion, leerDatos, preciosCentavos, renglonesBajoCosto, validarObjetivo } from '../../../scripts/cargador/correccion-precios-lib.mjs';

// Datos FICTICIOS (folios, modelos y cifras inventados): los reales viven fuera del repo y entran con --datos.
const ejemplo = JSON.parse(readFileSync('test/fixtures/cargador/precios-por-modelo-ejemplo.json', 'utf8'));

describe('correccion de precios por modelo (datos ficticios)', () => {
  it('el ejemplo cuadra exacto con su total', () => {
    const datos = leerDatos(ejemplo);
    expect(validarObjetivo(datos)).toEqual([]);
    expect(Object.keys(datos)).toEqual(['P-9001', 'P-9002']);
  });
  it('detecta un objetivo que no cuadra o con modelos distintos', () => {
    const malo = leerDatos({ 'P-9999': { total_pesos: 1000, precios: { X: 10 }, piezas: { X: 99 } } });
    expect(validarObjetivo(malo)[0]).toMatch(/P-9999.*suman 990/);
    const otro = leerDatos({ 'P-9999': { total_pesos: 10, precios: { X: 10 }, piezas: { Y: 1 } } });
    expect(validarObjetivo(otro)[0]).toMatch(/no coinciden/);
  });
  it('zod rechaza formatos invalidos', () => {
    expect(() => leerDatos({})).toThrow(/al menos un pedido/);
    expect(() => leerDatos({ 'x-1': { total_pesos: 10, precios: { X: 10 } } })).toThrow(/archivo de datos invalido/);
    expect(() => leerDatos({ 'P-9001': { total_pesos: 10.5, precios: { X: 10 } } })).toThrow(/archivo de datos invalido/);
    expect(() => leerDatos({ 'P-9001': { total_pesos: 10, precios: {} } })).toThrow(/al menos un modelo/);
    expect(() => leerDatos({ 'P-9001': { total_pesos: 10, precios: { X: -1 } } })).toThrow(/archivo de datos invalido/);
    expect(() => leerDatos({ 'P-9001': { total_pesos: 10, precios: { X: 10 }, extra: 1 } })).toThrow(/archivo de datos invalido/);
  });
  it('convierte a centavos enteros y rechaza pedidos fuera de alcance', () => {
    const datos = leerDatos(ejemplo);
    expect(preciosCentavos(datos, 'P-9002')).toEqual({ 'Modelo Ficticio Uno': 18900, 'Modelo Ficticio Cuatro': 22900 });
    expect(() => preciosCentavos(datos, 'P-0001')).toThrow(/fuera del alcance/);
  });
  it('cuenta los renglones bajo costo antes y despues', () => {
    const lineas = [{ modelo: 'A', piezas: 1, precio_cent: 14166, costo_unit_cent: 21500 }, { modelo: 'B', piezas: 1, precio_cent: 14167, costo_unit_cent: 9000 }];
    expect(renglonesBajoCosto(lineas)).toBe(1);
    expect(renglonesBajoCosto(lineas, { A: 23100, B: 9700 })).toBe(0);
  });
  it('la clave de idempotencia es fija y sin datos personales', () => {
    expect(claveCorreccion('P-9001')).toBe('correccion-precios-por-modelo:P-9001:v1');
  });
  it('el script exige --datos y solo usa la funcion oficial: ningun INSERT, UPDATE ni DELETE', () => {
    const src = readFileSync('scripts/cargador/corregir-precios-por-modelo.mjs', 'utf8');
    expect(src).not.toMatch(/\b(insert\s+into|update\s+\w+\.\w+\s+set|delete\s+from)\b/i);
    expect(src).toMatch(/operacion\.corregir_precio_por_modelo/);
    expect(src).toMatch(/--datos/);
  });
  it('ni el codigo ni el ejemplo del repo llevan folios reales P-0016 a P-0018', () => {
    for (const f of ['scripts/cargador/corregir-precios-por-modelo.mjs', 'scripts/cargador/correccion-precios-lib.mjs', 'test/fixtures/cargador/precios-por-modelo-ejemplo.json']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/P-001[678]/);
    }
  });
});
