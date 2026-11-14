import { describe, expect, it } from 'vitest';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import { fichaDe, periodoDe, enlaceDePartida } from '@/dominio/explicar/fichas';
import { csvDeDetalle, nombreArchivoCsv, ordenarDetalle, paginar } from '@/dominio/explicar/tabla';
import { armarVista, type FilaDetalle } from '@/dominio/explicar/vista';

const base: Explicacion = { cifra: 'conta:v02', titulo: 'Deudas', unidad: 'mxn', valor: 300000, comprobacion: null, movimientos: [], precioCent: null, costos: [], renglones: [] };
const r = (concepto: string, montoCent: number, extra: Partial<Explicacion['renglones'][number]> = {}): Explicacion['renglones'][number] => ({ concepto, montoCent: BigInt(montoCent), saldoCent: null, hora: null, fechaNeg: null, evento: null, canal: null, autor: null, mensajeOrigen: null, ...extra });

describe('armarVista', () => {
  it('sin ficha, partidas ni movimientos no inventa secciones', () => {
    const v = armarVista({ ...base, cifra: 'zzz:1', comprobacion: { via1: 'a', via1Valor: 1, via2: 'b', via2Valor: 1, cuadra: true } });
    expect(v.secciones).toEqual(['comprobacion', 'supuestos', 'glosario']);
    expect(v.visual).toBeNull();
    expect(v.estado.clave).toBe('cuadra');
  });
  it('partidas con signo mixto arman cascada que termina en la cifra', () => {
    const v = armarVista({ ...base, cifra: 'cascada:utilidad:2026-11-01:2026-11-30', renglones: [r('Pedidos', 500000), r('Gastos', -200000)], valor: 300000 });
    expect(v.visual?.tipo).toBe('cascada');
    if (v.visual?.tipo === 'cascada') {
      expect(v.visual.pasos.map((p) => p.tipo)).toEqual(['delta', 'delta', 'total']);
      expect(v.visual.pasos[1]!.texto).toBe('−$2,000.00');
    }
    expect(v.periodo).toMatch(/^Del .* al /);
    expect(v.secciones).toEqual(expect.arrayContaining(['definicion', 'origen', 'visual', 'cuentas', 'glosario']));
  });
  it('mas de 8 partidas positivas pasan a barras con las mayores', () => {
    const rengs = Array.from({ length: 10 }, (_, i) => r(`P${i}`, (i + 1) * 100));
    const v = armarVista({ ...base, renglones: rengs });
    expect(v.visual?.tipo).toBe('barras');
    if (v.visual?.tipo === 'barras') {
      expect(v.visual.datos).toHaveLength(8);
      expect(v.visual.datos[0]!.etiqueta).toBe('P9');
      expect(v.visual.nota).toMatch(/8 mayores de 10/);
    }
  });
  it('un libro con hora y saldo da detalle, tendencia e historial, sin partidas', () => {
    const rengs = [r('A', 100, { hora: '2026-11-01T10:00:00Z', saldoCent: 100n, evento: 'E-1' }), r('B', 50, { hora: '2026-11-02T10:00:00Z', saldoCent: 150n, evento: 'E-2' })];
    const v = armarVista({ ...base, cifra: 'conta:saldo:1101', renglones: rengs, valor: 150 });
    expect(v.partidas).toEqual([]);
    expect(v.detalle).toHaveLength(2);
    expect(v.visual?.tipo).toBe('tendencia');
    expect(v.secciones).toEqual(expect.arrayContaining(['detalle', 'historial']));
    expect(v.resumenOrigen).toMatch(/2 movimientos/);
    expect(v.cuentas[0]!.codigo).toBe('1101');
  });
  it('existencia en piezas: detalle y serie desde los movimientos', () => {
    const mov = (n: number, saldo: number) => ({ hora: `2026-11-0${n}T10:00:00Z`, fechaNeg: `2026-11-0${n}`, tipo: 'entrada_compra', sabor: 'Menta', ubicacion: 'Bodega', cantidad: 10, saldo, valorCent: 0n, evento: `E-${n}`, canal: 'web', mensajeOrigen: null, autor: 'Ana' });
    const v = armarVista({ ...base, cifra: 'existencia:modelo:3', unidad: 'pz', valor: 20, movimientos: [mov(1, 10), mov(2, 20)] });
    expect(v.valorTexto).toBe('20 pz');
    expect(v.detalle[0]!.concepto).toBe('entrada compra · Menta · Bodega');
    expect(v.serie).toHaveLength(2);
  });
  it('valor nulo dice Sin dato y lo explica; el costo supuesto se advierte', () => {
    const v = armarVista({ ...base, cifra: 'margen:3:7', valor: null, precioCent: 15000n, costos: [{ proveedor: 'Isaac', costoCent: 10000n, desde: '2026-11-01', supuesto: true, fuente: 'lista', margenCent: 5000n, cuadra: true }] });
    expect(v.valorTexto).toBeNull();
    expect(v.supuestos.join(' ')).toMatch(/Sin dato/);
    expect(v.supuestos.join(' ')).toMatch(/supuesto/);
  });
  it('Omar no recibe costos, cuentas ni enlaces aunque lleguen', () => {
    const v = armarVista({ ...base, cifra: 'omar:saldo', precioCent: 1n, costos: [{ proveedor: 'Isaac', costoCent: 1n, desde: '2026-11-01', supuesto: false, fuente: 'x', margenCent: 1n, cuadra: true }], cuentas: [{ codigo: '1101', nombre: 'x', tipo: 'A', naturaleza: 'D', saldoCent: 1n }], renglones: [r('1101 Caja', 5)] }, 'omar');
    expect(v.margenes).toEqual([]);
    expect(v.cuentas).toEqual([]);
    expect(v.fuenteEnlace).toBeNull();
    expect(v.partidas[0]!.enlace).toBeNull();
  });
  it('estado: estimado, no cuadra, y diferencia solo si la base la manda', () => {
    expect(armarVista({ ...base, titulo: 'Utilidad estimada' }).estado.clave).toBe('estimado');
    const v = armarVista({ ...base, comprobacion: { via1: 'a', via1Valor: 100, via2: 'b', via2Valor: 90, cuadra: false, diferencia: 10 } });
    expect(v.estado.clave).toBe('no_cuadra');
    expect(v.comprobacion?.diferenciaTexto).toBe('$0.10');
    expect(armarVista({ ...base, comprobacion: { via1: 'a', via1Valor: 1, via2: 'b', via2Valor: 1, cuadra: true } }).comprobacion?.diferenciaTexto).toBeNull();
  });
});

describe('fichas', () => {
  it('cubre las familias del sistema', () => {
    for (const c of ['existencia:modelo:1', 'margen:1:2', 'pedido:total:1', 'pedido:saldo:1', 'cxc:total', 'proveedor:posicion:Isaac', 'socio:neto:Angelo', 'socios:cuadre', 'cascada:utilidad:2026-11-01:2026-11-30', 'omar:saldo', 'conta:saldo:1101', 'conta:v05', 'conta:utilidad:2026-11-01:2026-11-30:bruta', 'devolucion:cliente:1', 'inventario:valor', 'historial:valor:Javier', 'capital:x', 'dsu:utilidad:-:-']) {
      const f = fichaDe(c);
      expect(f, c).not.toBeNull();
      expect(f!.definicion.length).toBeGreaterThan(10);
    }
    expect(fichaDe('desconocida:1')).toBeNull();
  });
  it('periodo y enlaces por partida', () => {
    expect(periodoDe('cascada:utilidad:2026-11-01:2026-11-30')).toEqual({ inicio: '2026-11-01', fin: '2026-11-30' });
    expect(periodoDe('conta:saldo:1101:2026-11-14')).toEqual({ inicio: null, fin: '2026-11-14' });
    expect(periodoDe('existencia:modelo:1')).toBeNull();
    expect(enlaceDePartida('1310 Inventario en bodega')?.href).toBe('/contabilidad/mayor?cuenta=1310');
    expect(enlaceDePartida('Gastos')).toBeNull();
  });
});

describe('tabla del detalle', () => {
  const f = (id: string, monto: number, fecha: string, concepto = 'x'): FilaDetalle => ({ id, folio: id, fecha, fechaTexto: fecha, concepto, monto, montoTexto: `$${monto}`, saldoTexto: null, origen: 'web', nota: null });
  const filas = [f('E-2', 5, '2026-11-02'), f('E-10', 9, '2026-11-01'), f('E-1', -3, '2026-11-03')];
  it('ordena por monto, fecha y folio numerico, estable', () => {
    expect(ordenarDetalle(filas, 'monto', 'asc').map((x) => x.id)).toEqual(['E-1', 'E-2', 'E-10']);
    expect(ordenarDetalle(filas, 'fecha', 'desc').map((x) => x.id)).toEqual(['E-1', 'E-2', 'E-10']);
    expect(ordenarDetalle(filas, 'folio', 'asc').map((x) => x.id)).toEqual(['E-1', 'E-2', 'E-10']);
  });
  it('pagina y limita la pagina fuera de rango', () => {
    const muchas = Array.from({ length: 25 }, (_, i) => f(`E-${i}`, i, '2026-11-01'));
    expect(paginar(muchas, 2).filas).toHaveLength(5);
    expect(paginar(muchas, 99).pagina).toBe(2);
    expect(paginar([], 0).paginas).toBe(1);
  });
  it('CSV: BOM, comillas escapadas y formulas neutralizadas', () => {
    const csv = csvDeDetalle([{ ...f('E-1', 1, '2026-11-01', '=SUMA(A1)'), origen: 'dijo "hola"' }]);
    expect(csv.startsWith('﻿"Folio"')).toBe(true);
    expect(csv).toContain(`"'=SUMA(A1)"`);
    expect(csv).toContain('"dijo ""hola"""');
    expect(nombreArchivoCsv('conta:saldo:1101')).toBe('explicar-conta-saldo-1101.csv');
  });
});
