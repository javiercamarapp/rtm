import { describe, expect, it } from 'vitest';
import { fechaDesdeTexto, leerMovimientos, montoDesdeTexto } from '@/dominio/movimientos/importar';

describe('fechaDesdeTexto', () => {
  it.each([
    ['2026-11-05', '2026-11-05'],
    ['5/11/2026', '2026-11-05'],
    ['05-11-2026', '2026-11-05'],
    ['5/11/26', '2026-11-05'],
    ['29/02/2028', '2028-02-29'],
  ])('lee %s', (t, esperado) => expect(fechaDesdeTexto(t)).toBe(esperado));
  it.each(['', 'ayer', '30/02/2026', '2026-13-01', '31/04/2026', '0/1/2026', '29/02/2027'])('rechaza %s', (t) => expect(fechaDesdeTexto(t)).toBeNull());
});

describe('montoDesdeTexto', () => {
  it.each([
    ['1,234.50', 123450n],
    ['$9,000', 900000n],
    ['-250', -25000n],
    ['(1,234.50)', -123450n],
    ['0.05', 5n],
  ])('lee %s', (t, esperado) => expect(montoDesdeTexto(t)).toBe(esperado));
  it.each(['', 'abc', '1.234,50', '12.345'])('rechaza %s', (t) => expect(montoDesdeTexto(t)).toBeNull());
});

describe('leerMovimientos', () => {
  it('lee texto pegado con tabuladores y sin encabezado en el orden fecha, monto, cuenta, origen, mensaje', () => {
    const r = leerMovimientos('2026-11-01\t10,000.00\tCuenta A\tCliente\tCobro uno\n2026-11-02\t-2,500.00\tCuenta A\tProveedor\tPago');
    expect(r.errores).toEqual([]);
    expect(r.conEncabezado).toBe(false);
    expect(r.filas.map((f) => f.monto_cent)).toEqual([1000000n, -250000n]);
    expect(r.filas[0]).toMatchObject({ fecha: '2026-11-01', cuenta: 'Cuenta A', origen: 'Cliente', mensaje: 'Cobro uno', linea: 1 });
  });

  it('reconoce el encabezado de un CSV con comillas y comas dentro del campo', () => {
    const r = leerMovimientos('Fecha,Importe,Cuenta,Origen,Descripción\n01/11/2026,"1,500.00",Caja,"Perez, Juan","Pago ""parcial"""\n');
    expect(r.conEncabezado).toBe(true);
    expect(r.delimitador).toBe(',');
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ monto_cent: 150000n, origen: 'Perez, Juan', mensaje: 'Pago "parcial"', linea: 2 });
  });

  it('con columnas de entrada y salida el monto es entrada menos salida', () => {
    const r = leerMovimientos('fecha;entrada;salida;mensaje\n2026-11-01;1000;;Cobro\n2026-11-02;;300.50;Gasto');
    expect(r.delimitador).toBe(';');
    expect(r.filas.map((f) => f.monto_cent)).toEqual([100000n, -30050n]);
  });

  it('reporta cada fila mala con su linea y conserva las buenas', () => {
    const r = leerMovimientos('2026-11-01\t100\n31/04/2026\t100\n2026-11-03\tabc\n2026-11-04\t0\n2026-11-05\t5');
    expect(r.filas.map((f) => f.linea)).toEqual([1, 5]);
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3, 4]);
  });

  it('ignora lineas vacias y el BOM, y un texto vacio no da filas', () => {
    expect(leerMovimientos('\n\n').filas).toEqual([]);
    expect(leerMovimientos('﻿2026-11-01\t5').filas).toHaveLength(1);
  });

  it('rechaza una fila de CSV con comas cuyo monto lleva comas de miles sin comillas, sin encabezado', () => {
    const r = leerMovimientos('2026-11-01,1,500.00,Caja,Cliente,Cobro\n2026-11-02,"1,500.00",Caja,Cliente,Cobro');
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]).toMatchObject({ linea: 1 });
    expect(r.errores[0]!.motivo).toMatch(/6 columnas y se esperaban 5/);
    expect(r.filas.map((f) => f.monto_cent)).toEqual([150000n]);
  });

  it('con encabezado tambien: mas celdas que columnas se rechaza', () => {
    const r = leerMovimientos('fecha,monto,cuenta,origen,mensaje\n2026-11-01,1,500.00,Caja,Cliente,Cobro');
    expect(r.filas).toEqual([]);
    expect(r.errores[0]).toMatchObject({ linea: 2 });
  });

  it('detecta el monto partido aunque falten columnas al final', () => {
    const r = leerMovimientos('2026-11-01,1,500.00,Caja,Cliente');
    expect(r.filas).toEqual([]);
    expect(r.errores[0]!.motivo).toMatch(/parece partido/);
    expect(leerMovimientos('fecha,entrada,salida\n2026-11-01,,"2,000"').filas.map((f) => f.monto_cent)).toEqual([-200000n]);
  });

  it('una coma de mas al final no cuenta como columna', () => {
    const r = leerMovimientos('2026-11-01,1500.00,Caja,Cliente,Cobro,');
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toMatchObject({ monto_cent: 150000n, mensaje: 'Cobro' });
  });

  it('rechaza mas de 5,000 filas en una importacion', () => {
    const r = leerMovimientos(Array.from({ length: 5001 }, () => '2026-11-01\t1').join('\n'));
    expect(r.filas).toEqual([]);
    expect(r.errores[0]!.motivo).toMatch(/5000/);
  });
});
