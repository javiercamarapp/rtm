import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { baseDeVariedad, saboresDisponibles } from '@/dominio/proveedores/variedad';
import { evaluarAnomalia } from '@/dominio/proveedores/validacion';
import { parsearCatalogo } from '@/dominio/proveedores/catalogo_json';
import { procesarLectura } from '@/dominio/proveedores/detector';
import { estadoVacio } from '@/dominio/proveedores/tipos';
import { catalogoJson, ctxDeteccion, en, modeloConSabores } from './ayudas';

describe('base de variedad', () => {
  it('sin historia es cero; con menos de 7 dias es el maximo observado; con 7 o mas, la mediana', () => {
    expect(baseDeVariedad([])).toBe(0);
    expect(baseDeVariedad([{ dia: 'a', n: 3 }, { dia: 'b', n: 12 }, { dia: 'c', n: 5 }])).toBe(12);
    const siete = [10, 12, 11, 3, 12, 11, 12].map((n, i) => ({ dia: `d${i}`, n }));
    expect(baseDeVariedad(siete)).toBe(11);
    const ocho = [1, 10, 12, 11, 3, 12, 11, 12].map((n, i) => ({ dia: `d${i}`, n }));
    expect(baseDeVariedad(ocho)).toBe(11); // solo cuentan los ultimos 7
    const par = [10, 12, 11, 3, 12, 11, 12, 13].map((n, i) => ({ dia: `d${i}`, n }));
    expect(baseDeVariedad(par.slice(-7))).toBe(12);
  });

  it('propiedad: la base nunca supera el maximo ni baja del minimo', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 1, maxLength: 12 }), (ns) => {
        const base = baseDeVariedad(ns.map((n, i) => ({ dia: `d${i}`, n })));
        expect(base).toBeLessThanOrEqual(Math.max(...ns));
        expect(base).toBeGreaterThanOrEqual(Math.min(...ns.slice(-7)));
      }),
    );
  });

  it('cuenta los sabores disponibles de un modelo, sin los descontinuados', () => {
    const p = parsearCatalogo(catalogoJson([modeloConSabores(1, 'A', 4, 3), modeloConSabores(2, 'B', 2, 2)]));
    if (!p.ok) throw new Error('fixture');
    const e = procesarLectura(estadoVacio(), { clave: 'k', en: en(0), lectura: p.lectura }, ctxDeteccion()).estado;
    expect(saboresDisponibles(e, '1')).toBe(3);
    e.variantes['1001']!.estado = 'descontinuada';
    expect(saboresDisponibles(e, '1')).toBe(2);
  });
});

describe('validacion de anomalias', () => {
  it('sin estado previo no hay con que comparar', () => {
    const p = parsearCatalogo(catalogoJson([modeloConSabores(1, 'A', 1, 1)]));
    if (!p.ok) throw new Error('fixture');
    expect(evaluarAnomalia(estadoVacio(), p.lectura)).toEqual({ estado: 'ok' });
  });
});
