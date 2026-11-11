// Pruebas con datos SINTETICOS (numeros 555 / ficticios). Nunca datos reales.
import { describe, expect, it } from 'vitest';
import { construirInforme, consolidar } from '@/dominio/contactos/consolidar';
import { decodificarTexto, parsearCsv } from '@/dominio/contactos/csv';
import { leerEtiquetas, leerTabla, slugEtiqueta } from '@/dominio/contactos/leer';
import { enmascararTelefono, normalizarTelefono, separarTelefonos } from '@/dominio/contactos/telefono';

const utf16 = (s: string) => {
  const b = new Uint8Array(2 + s.length * 2);
  b[0] = 0xff; b[1] = 0xfe;
  for (let i = 0; i < s.length; i++) { b[2 + i * 2] = s.charCodeAt(i) & 0xff; b[3 + i * 2] = s.charCodeAt(i) >> 8; }
  return b;
};

describe('telefonos', () => {
  it.each([
    ['9995550101', '+529995550101'],
    ['999 555 0101', '+529995550101'],
    ['(999) 555-0101', '+529995550101'],
    ['+52 999 555 0101', '+529995550101'],
    ['+52 1 999 555 0101', '+529995550101'],
    ['5219995550101', '+529995550101'],
    ['529995550101', '+529995550101'],
    ['044 999 555 0101', '+529995550101'],
    ['01 999 555 0101', '+529995550101'],
    ['p:+5219995550101', '+529995550101'],
    ['999 555 0101 ext. 22', '+529995550101'],
  ])('normaliza %s', (entrada, esperado) => {
    expect(normalizarTelefono(entrada)).toEqual({ ok: true, e164: esperado, extranjero: false });
  });

  it('acepta extranjeros con + explicito y los marca', () => {
    expect(normalizarTelefono('+1 415 555 0123')).toEqual({ ok: true, e164: '+14155550123', extranjero: true });
  });

  it.each([
    ['', 'vacio'],
    ['   ', 'vacio'],
    ['911', 'corto'],
    ['555 0101', 'sin_lada'],
    ['99955501012345', 'largo'],
    ['0000000000', 'patron_falso'],
    ['1234567890', 'patron_falso'],
    ['9990000000', 'patron_falso'],
    ['1995550101', 'patron_falso'],
  ])('rechaza %s como %s', (entrada, motivo) => {
    expect(normalizarTelefono(entrada)).toEqual({ ok: false, motivo });
  });

  it('separa varios telefonos por celda', () => {
    expect(separarTelefonos('9995550101 ::: 9995550102')).toEqual(['9995550101', '9995550102']);
    expect(separarTelefonos('9995550101 / 9995550102; 9995550103')).toHaveLength(3);
    expect(separarTelefonos('')).toEqual([]);
  });

  it('enmascara dejando solo los ultimos 2 digitos', () => {
    const m = enmascararTelefono('+529995550142');
    expect(m.endsWith('42')).toBe(true);
    expect(m).not.toContain('555');
  });
});

describe('csv', () => {
  it('lee UTF-16 con BOM y UTF-8 con BOM igual', () => {
    const txt = 'First Name,Phone # - Value\nAna,9995550101\n';
    expect(parsearCsv(decodificarTexto(utf16(txt)))).toEqual([['First Name', 'Phone # - Value'], ['Ana', '9995550101']]);
    const u8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(txt)]);
    expect(parsearCsv(decodificarTexto(u8))).toEqual(parsearCsv(decodificarTexto(utf16(txt))));
  });

  it('detecta UTF-16 sin BOM y tabulador', () => {
    const txt = 'a\tb\n1\t2\n';
    const b = new Uint8Array(txt.length * 2);
    for (let i = 0; i < txt.length; i++) { b[i * 2] = txt.charCodeAt(i); b[i * 2 + 1] = 0; }
    expect(parsearCsv(decodificarTexto(b))).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('respeta comillas, saltos dentro de celda y CRLF', () => {
    expect(parsearCsv('a,b\r\n"x, y","l1\nl2"\r\n"c""d",z')).toEqual([['a', 'b'], ['x, y', 'l1\nl2'], ['c"d', 'z']]);
  });
});

describe('lectura de tablas', () => {
  const google = [
    ['First Name', 'Last Name', 'Labels', 'E-mail 1 - Value', 'Phone 1 - Value', 'Phone 2 - Value'],
    ['Ana', 'Prueba', '* myContacts ::: Importado el 9/10', 'ana@ejemplo.test', '999 555 0101', '+52 999 555 0102'],
    ['', '', '', '', '', ''],
    ['Sin', 'Telefono', '', 'x@ejemplo.test', '', ''],
    ['Basura', 'Corta', '', '', '123', '0000000000'],
    ['Mala', 'Mezcla', '', 'no-es-correo', '9995550103 ::: 12', ''],
  ];

  it('separa varios telefonos, ignora la etiqueta de sistema y cuenta cada descarte', () => {
    const r = leerTabla(google, { archivo: 'g.csv', tipo: 'google' });
    expect(r.filas).toBe(5);
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]!.telefonos).toEqual(['+529995550101', '+529995550102']);
    expect(r.registros[0]!.origenes.map((o) => o.origen)).toEqual(['google-lote:importado-el-9-10']);
    expect(r.registros[0]!.correos).toEqual(['ana@ejemplo.test']);
    expect(r.descartes.fila_vacia).toBe(1);
    expect(r.descartes.sin_telefono).toBe(2);
    expect(r.descartes.telefono_vacio).toBe(1);
    expect(r.descartes.corto).toBe(2);
    expect(r.descartes.patron_falso).toBe(1);
    expect(r.descartes.correo_invalido).toBe(1);
    expect(r.registros[1]!.correos).toEqual([]);
  });

  it('sin etiqueta usa google-lote:sin-etiqueta', () => {
    const r = leerTabla([['Name', 'Phone 1 - Value'], ['Luis', '9995550104']], { archivo: 'g.csv', tipo: 'google' });
    expect(r.registros[0]!.origenes[0]!.origen).toBe('google-lote:sin-etiqueta');
  });

  it('Meta conserva anuncio, formulario y campana y acepta el prefijo p:', () => {
    const meta = [
      ['id', 'ad_name', 'form_name', 'campaign_name', 'full_name', 'phone_number', 'email'],
      ['1', 'Anuncio A', 'Formulario 1', 'Campana 1', 'Eva', 'p:+5219995550105', 'eva@ejemplo.test'],
    ];
    const r = leerTabla(meta, { archivo: 'm.csv', tipo: 'meta' });
    expect(r.registros[0]!.origenes).toEqual([{ origen: 'meta', anuncio: 'Anuncio A', formulario: 'Formulario 1', campana: 'Campana 1' }]);
    expect(r.registros[0]!.telefonos).toEqual(['+529995550105']);
  });

  it('Toocloudy y Vapeunion llevan su origen fijo', () => {
    const t = leerTabla([['COLONIA', 'WHATSAPP'], ['Centro', '9995550106']], { archivo: 't.xlsx', tipo: 'toocloudy' });
    expect(t.registros[0]!.origenes[0]!.origen).toBe('toocloudy');
    const v = leerTabla([['First Name', 'Labels', 'Phone # - Value'], ['Ivo', '', '9995550107']], { archivo: 'v.csv', tipo: 'vapeunion' });
    expect(v.registros[0]!.origenes[0]!.origen).toBe('vapeunion');
  });

  it('una tabla sin columna de telefono descarta todo y lo cuenta', () => {
    const r = leerTabla([['a', 'b'], ['1', '2'], ['3', '4']], { archivo: 'x.csv', tipo: 'google' });
    expect(r.registros).toHaveLength(0);
    expect(r.descartes.sin_telefono).toBe(2);
  });

  it('lee etiquetas y su slug', () => {
    expect(leerEtiquetas('* myContacts ::: Restored from X - 1 ::: starred')).toEqual(['Restored from X - 1', 'starred']);
    expect(slugEtiqueta('Se restableció/eron')).toBe('se-restablecio-eron');
  });
});

describe('consolidacion', () => {
  const tabla = (nombre: string, tel: string, extra: string[] = ['', '']) => [['First Name', 'Labels', 'E-mail 1 - Value', 'Phone 1 - Value'], [nombre, extra[0]!, extra[1]!, tel]];
  const lec = (archivo: string, tipo: 'google' | 'meta' | 'toocloudy' | 'vapeunion', t: string[][]) => leerTabla(t, { archivo, tipo });

  it('deduplica entre archivos y conserva todos los origenes, etiquetas y lotes', () => {
    const a = lec('a.csv', 'google', tabla('Ana', '999 555 0101', ['Lote Uno', '']));
    const b = lec('b.csv', 'google', tabla('Ana Prueba', '+52 999 555 0101', ['Lote Dos', 'ana@ejemplo.test']));
    const c = lec('c.csv', 'vapeunion', tabla('A.', '9995550101'));
    const todos = consolidar([a, b, c].flatMap((l) => l.registros));
    expect(todos).toHaveLength(1);
    const k = todos[0]!;
    expect(k.nombre).toBe('Ana Prueba');
    expect(k.correos).toEqual(['ana@ejemplo.test']);
    expect(k.etiquetas).toEqual(['Lote Dos', 'Lote Uno']);
    expect(k.lotes).toEqual(['a.csv', 'b.csv', 'c.csv']);
    expect(k.origenes.map((o) => o.origen)).toEqual(['google-lote:lote-dos', 'google-lote:lote-uno', 'vapeunion']);
    expect(k.tipo).toBe('menudeo');
  });

  it('une por correo cuando los telefonos difieren y por cierre transitivo', () => {
    const regs = [
      ...lec('a.csv', 'google', tabla('Ana', '9995550101', ['', 'misma@ejemplo.test'])).registros,
      ...lec('b.csv', 'google', tabla('Ana', '9995550102', ['', 'misma@ejemplo.test'])).registros,
      ...lec('c.csv', 'google', tabla('Ana', '9995550102')).registros,
    ];
    const r = consolidar(regs);
    expect(r).toHaveLength(1);
    expect(r[0]!.telefonos).toEqual(['+529995550101', '+529995550102']);
    expect(r[0]!.telefono).toBe('+529995550101');
  });

  it('no mezcla contactos distintos y es determinista sin importar el orden', () => {
    const regs = [
      ...lec('a.csv', 'google', tabla('Ana', '9995550101')).registros,
      ...lec('b.csv', 'toocloudy', [['WHATSAPP'], ['9995550102'], ['9995550103']]).registros,
    ];
    const uno = consolidar(regs);
    const dos = consolidar([...regs].reverse());
    expect(uno).toHaveLength(3);
    expect(JSON.stringify(uno)).toBe(JSON.stringify(dos));
  });

  it('es idempotente: consolidar el resultado otra vez no cambia contactos ni telefonos', () => {
    const regs = [
      ...lec('a.csv', 'google', tabla('Ana', '9995550101 ::: 9995550102')).registros,
      ...lec('b.csv', 'google', tabla('Ana', '9995550102')).registros,
    ];
    const uno = consolidar(regs);
    const dos = consolidar(uno.map((k) => ({ archivo: k.lotes[0]!, nombre: k.nombre, telefonos: k.telefonos, correos: k.correos, etiquetas: k.etiquetas, origenes: k.origenes })));
    expect(dos.map((k) => [k.telefono, k.telefonos, k.correos])).toEqual(uno.map((k) => [k.telefono, k.telefonos, k.correos]));
  });

  it('el informe cuenta duplicados e invalidos y no trae datos personales', () => {
    const l1 = lec('a.csv', 'google', [['First Name', 'Labels', 'Phone 1 - Value'], ['Ana Secreta', 'Lote Uno', '9995550101'], ['Dup', 'Lote Uno', '9995550101'], ['Mala', '', '12']]);
    const l2 = lec('m.csv', 'meta', [['ad_name', 'form_name', 'full_name', 'phone_number', 'email'], ['Anuncio A', 'F1', 'Beto Secreto', '9995550101', 'beto@ejemplo.test'], ['Anuncio B', 'F1', 'Cris', '9995550109', '']]);
    const contactos = consolidar([...l1.registros, ...l2.registros]);
    const inf = construirInforme([l1, l2], contactos);
    expect(inf.totales).toMatchObject({ filas: 5, registros_validos: 4, contactos_unicos: 2, duplicados_eliminados: 2, invalidos: 1, con_correo: 1, sin_correo: 1, telefonos_unicos: 2 });
    expect(inf.por_origen).toEqual([{ origen: 'meta', contactos: 2 }, { origen: 'google-lote:lote-uno', contactos: 1 }]);
    expect(inf.por_anuncio.map((a) => a.anuncio).sort()).toEqual(['Anuncio A', 'Anuncio B']);
    expect(inf.etiquetas).toEqual([{ etiqueta: 'Lote Uno', contactos: 1 }]);
    const texto = JSON.stringify(inf);
    for (const dato of ['Secreta', 'Secreto', '9995550101', '5550109', 'ejemplo.test']) expect(texto).not.toContain(dato);
  });
});
