// vCard con tarjetas SINTETICAS.
import { describe, expect, it } from 'vitest';
import { consolidar } from '@/dominio/contactos/consolidar';
import { decodificarTexto } from '@/dominio/contactos/csv';
import { leerTabla } from '@/dominio/contactos/leer';
import { leerVcf } from '@/dominio/contactos/vcard';

const v3 = [
  'BEGIN:VCARD', 'VERSION:3.0', 'N:Prueba;Ana;;;', 'FN:Ana Prueba',
  'TEL;type=CELL;type=VOICE;type=pref:+52 999 555 0101',
  'item1.TEL;type=pref:(999) 555-0102', 'item1.X-ABLabel:otro',
  'EMAIL;type=INTERNET:ana@example.test',
  'NOTE:linea larga que se dobla', ' y continua',
  'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'N:;;;;', 'FN:Sin Telefono', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'N:Solo;Nombre N;;;', 'TEL:tel:9995550103', 'END:VCARD',
].join('\r\n');

describe('leerVcf', () => {
  it('lee FN, N, varios TEL con grupo, EMAIL y descarta la tarjeta sin telefono', () => {
    const tabla = leerVcf(v3);
    const r = leerTabla(tabla, { archivo: 'numeros/Todos.vcf', tipo: 'vcf' });
    expect(r.filas).toBe(3);
    expect(r.registros).toHaveLength(2);
    expect(r.descartes.sin_telefono).toBe(1);
    expect(r.registros[0]!.telefonos).toEqual(['+529995550101', '+529995550102']);
    expect(r.registros[0]!.correos).toEqual(['ana@example.test']);
    expect(r.registros[0]!.nombre).toBe('Ana Prueba');
    expect(r.registros[1]!.nombre).toBe('Nombre N Solo');
    expect(r.registros[0]!.origenes[0]!.origen).toBe('google-vcf:todos');
  });

  it('vCard 2.1 con quoted-printable UTF-8 y lineas dobladas con =', () => {
    const texto = ['BEGIN:VCARD', 'VERSION:2.1', 'FN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Jos=C3=A9 =', 'P=C3=A9rez', 'TEL;CELL:9995550104', 'END:VCARD'].join('\n');
    const r = leerTabla(leerVcf(texto), { archivo: 'x.vcf', tipo: 'vcf' });
    expect(r.registros[0]!.nombre).toBe('José Pérez');
    expect(r.registros[0]!.telefonos).toEqual(['+529995550104']);
  });

  it('decodifica UTF-8 con BOM y se fusiona con otras fuentes por telefono', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(v3)]);
    const r = leerTabla(leerVcf(decodificarTexto(bytes)), { archivo: 'contacts.vcf', tipo: 'vcf' });
    const otra = leerTabla([['First Name', 'Phone 1 - Value'], ['Ana', '9995550102']], { archivo: 'g.csv', tipo: 'google' });
    const todos = consolidar([...r.registros, ...otra.registros]);
    expect(todos).toHaveLength(2);
    expect(todos.find((c) => c.telefonos.includes('+529995550101'))!.origenes.map((o) => o.origen)).toEqual(['google-lote:sin-etiqueta', 'google-vcf:contacts']);
  });

  it('un archivo sin tarjetas no rompe', () => {
    expect(leerTabla(leerVcf(''), { archivo: 'v.vcf', tipo: 'vcf' }).registros).toHaveLength(0);
  });
});
