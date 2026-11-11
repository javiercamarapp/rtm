import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonNumero, diasTexto, enteroTexto, formatearCifra, formatearValor, numerosAutorizados, pesosEnteros, piezasTexto, porcentaje0, porcentaje1, razon, variacionTexto } from '@/dominio/reportes/formato';
import { decidirEstado, esBloqueante, etiquetaEstadoTexto, resumenComprobaciones } from '@/dominio/reportes/estado';
import { LibroCifras } from '@/dominio/reportes/cifras';
import { marcadoresDe, palabras, renderMarcadores, textoSinDatos } from '@/dominio/reportes/texto';
import { ErrorReporte, type ResultadoComprobacion } from '@/dominio/reportes/tipos';
import { PARAMETROS } from '@/dominio/reportes/parametros';

const cmp = (id: string, ok = true): ResultadoComprobacion => ({ id, nombre: id, via1: 1n, via2: ok ? 1n : 2n, ok });

describe('formato unico de reportes', () => {
  it('pesos enteros con separador, signo real y medio arriba', () => {
    expect(pesosEnteros(4_042_200n)).toBe('$40,422');
    expect(pesosEnteros(-109_855n)).toBe('−$1,099');
    expect(pesosEnteros(50n)).toBe('$1');
    expect(pesosEnteros(49n)).toBe('$0');
    expect(pesosEnteros(-49n)).toBe('$0');
  });
  it('porcentajes, razones, dias y piezas', () => {
    expect(porcentaje1(871n)).toBe('8.7 %');
    expect(porcentaje0(896n)).toBe('9 %');
    expect(porcentaje1(-871n)).toBe('−8.7 %');
    expect(razon(1300n)).toBe('1.3');
    expect(razon(940n)).toBe('0.94');
    expect(razon(1000n)).toBe('1.0');
    expect(diasTexto(1)).toBe('1 día');
    expect(diasTexto(6)).toBe('6 días');
    expect(piezasTexto(2310)).toBe('2,310 pz');
    expect(enteroTexto(-1234)).toBe('−1,234');
  });
  it('variacion con palabra', () => {
    expect(variacionTexto(-896n)).toBe('9 % menos');
    expect(variacionTexto(1196n)).toBe('12 % más');
    expect(variacionTexto(10n)).toBe('sin cambio');
  });
  it('formatearValor cubre todos los formatos', () => {
    expect(formatearValor(123_456n, 'cent', 'centavos')).toBe('$1,234.56');
    expect(formatearValor(4_000n, 'cent')).toBe('$40');
    expect(formatearValor(12n, 'n')).toBe('12');
    expect(formatearValor(12n, 'dias', 'dias')).toBe('12 días');
    expect(formatearValor(12n, 'pz', 'pz')).toBe('12 pz');
    expect(formatearValor(1500n, 'milesimas')).toBe('1.5');
  });
  it('canonNumero normaliza separadores, signo y ceros', () => {
    expect(canonNumero('$40,422')).toBe('40422');
    expect(canonNumero('−$1,098.55')).toBe('1098.55');
    expect(canonNumero('17.50')).toBe('17.5');
    expect(canonNumero('2,310 pz')).toBe('2310');
    expect(canonNumero('8.7 %')).toBe('8.7');
    expect(canonNumero('007')).toBe('7');
  });
  it('propiedad: toda forma de mostrar una cifra de dinero esta autorizada por su cifra', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -9_000_000_000n, max: 9_000_000_000n }), (v) => {
        const l = new LibroCifras();
        const c = l.agregar('x', 'x', v, 'cent', { clase: 'Calculado', fuente: 't', periodo: 'p' });
        expect(numerosAutorizados(c)).toContain(canonNumero(formatearCifra(c)));
        expect(numerosAutorizados(c)).toContain(canonNumero(formatearValor(v, 'cent', 'centavos')));
      }),
      { numRuns: 300 },
    );
  });
  it('propiedad: el formato de pesos nunca pierde mas de 50 centavos', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000_000n }), (v) => {
        const pesos = BigInt(canonNumero(pesosEnteros(v)));
        const dif = v - pesos * 100n;
        expect(dif >= -50n && dif <= 49n).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('estados del reporte', () => {
  const base = { periodoAprobado: true, enCurso: false, datosIncompletos: [] as string[] };
  it('DEFINITIVO: aprobado y todo verde', () => {
    const d = decidirEstado({ ...base, comprobaciones: [cmp('C1'), cmp('C3')] });
    expect(d.sale).toBe(true);
    expect(d.etiquetas).toEqual(['DEFINITIVO']);
    expect(etiquetaEstadoTexto(d)).toBe('DEFINITIVO');
  });
  it('PRELIMINAR por no aprobado o por falla no bloqueante (C7)', () => {
    expect(decidirEstado({ ...base, periodoAprobado: false, comprobaciones: [cmp('C1')] }).etiquetas).toEqual(['PRELIMINAR']);
    const d = decidirEstado({ ...base, comprobaciones: [cmp('C7', false)] });
    expect(d.etiquetas).toEqual(['PRELIMINAR']);
    expect(d.fallas).toEqual(['C7']);
    expect(d.motivo).toContain('C7');
  });
  it('PARCIAL por periodo en curso o datos incompletos, y se combina', () => {
    expect(decidirEstado({ ...base, enCurso: true, comprobaciones: [] }).etiquetas).toEqual(['PARCIAL']);
    expect(decidirEstado({ ...base, datosIncompletos: ['guía pendiente'], comprobaciones: [] }).motivo).toContain('guía pendiente');
    const d = decidirEstado({ periodoAprobado: false, enCurso: true, datosIncompletos: [], comprobaciones: [] });
    expect(etiquetaEstadoTexto(d)).toBe('PRELIMINAR · PARCIAL');
  });
  it.each(PARAMETROS.bloqueantes)('NO SALE si falla la bloqueante %s', (id) => {
    const d = decidirEstado({ ...base, comprobaciones: [cmp('C1'), cmp(id, false)] });
    expect(d.sale).toBe(false);
    expect(d.bloqueantes).toEqual([id]);
    expect(etiquetaEstadoTexto(d)).toBe('NO SALE');
    expect(d.motivo).toContain('reintentar reporte');
  });
  it('una comprobacion interna R.* fallida siempre bloquea', () => {
    expect(esBloqueante('R.CIFRAS')).toBe(true);
    expect(esBloqueante('C7')).toBe(false);
    expect(decidirEstado({ ...base, comprobaciones: [cmp('R.PUENTE', false)] }).sale).toBe(false);
  });
  it('el reporte de Omar solo se bloquea con C8 o C9', () => {
    const o = { ...base, bloqueantes: PARAMETROS.bloqueantesOmar };
    expect(decidirEstado({ ...o, comprobaciones: [cmp('C3', false)] }).sale).toBe(true);
    expect(decidirEstado({ ...o, comprobaciones: [cmp('C9', false)] }).sale).toBe(false);
  });
  it('resumen de comprobaciones', () => {
    expect(resumenComprobaciones([cmp('C1'), cmp('C2', false), cmp('R.CIFRAS')])).toEqual({ ok: 1, total: 2 });
  });
});

describe('libro de cifras y texto con marcadores', () => {
  const libro = () => {
    const l = new LibroCifras();
    l.agregar('ventas', 'Ventas', 46_390_000n, 'cent', { clase: 'Observado', fuente: 't', periodo: 'p', n: 14 });
    l.agregar('pct', 'Pct', -896n, 'bp', { clase: 'Calculado', fuente: 't', periodo: 'p', formato: 'pct0' });
    l.sinDatos('falta', 'Falta', 'bp', { clase: 'Estimado', fuente: 't', periodo: 'p', n: 3, requeridos: 6 });
    return l;
  };
  it('sustituye marcadores y modificadores', () => {
    const l = libro();
    expect(renderMarcadores('Ventas {{cifra:ventas}} y {{cifra:pct|abs}} y {{cifra:ventas|centavos}}', l)).toBe('Ventas $463,900 y 9 % y $463,900.00');
    expect(marcadoresDe('{{cifra:a}} {{cifra:b.c|abs}}')).toEqual(['a', 'b.c']);
  });
  it('cifra sin datos fuerza la frase fija', () => {
    const l = libro();
    expect(renderMarcadores('{{cifra:falta}}', l)).toBe('no hay datos suficientes (3 de 6 requeridos)');
    expect(textoSinDatos(l.obtener('falta'))).toContain('3 de 6');
    expect(textoSinDatos({ ...l.obtener('falta'), metodo: undefined })).toContain('?');
  });
  it('errores tipados: cifra inexistente, duplicada y modificador desconocido', () => {
    const l = libro();
    expect(() => renderMarcadores('{{cifra:no_existe}}', l)).toThrow(ErrorReporte);
    expect(() => l.agregar('ventas', 'x', 1n, 'n', { clase: 'Observado', fuente: 't', periodo: 'p' })).toThrow(ErrorReporte);
    expect(() => renderMarcadores('{{cifra:ventas|raro}}', l)).toThrow(ErrorReporte);
    try {
      l.obtener('zzz');
    } catch (e) {
      expect((e as ErrorReporte).codigo).toBe('CIFRA_INEXISTENTE');
    }
  });
  it('una cifra con vias distintas queda marcada y la comprobacion interna falla', () => {
    const l = new LibroCifras();
    l.agregar('a', 'a', 5n, 'n', { clase: 'Calculado', fuente: 't', periodo: 'p', via2: 5n });
    expect(l.comprobaciones()[0]!.ok).toBe(true);
    l.agregar('b', 'b', 5n, 'n', { clase: 'Calculado', fuente: 't', periodo: 'p', via2: 6n });
    const c = l.comprobaciones()[0]!;
    expect(c.ok).toBe(false);
    expect(c.detalle).toContain('b');
    expect(l.tiene('b')).toBe(true);
    expect(l.valor('a')).toBe(5n);
  });
  it('titular de accion: conteo de palabras', () => {
    expect(palabras('La utilidad baja 9 % por mayor costo.')).toBe(8);
    expect(palabras('')).toBe(0);
  });
});
