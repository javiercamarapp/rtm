// Lector XLSX con un archivo sintetico armado en memoria (zip sin compresion y con deflate).
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { leerXlsx } from '../../scripts/contactos/xlsx.mjs';

function zip(archivos: Record<string, string>, comprimir: boolean): Uint8Array {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const datos = Buffer.from(texto, 'utf8');
    const cuerpo = comprimir ? deflateRawSync(datos) : datos;
    const nom = Buffer.from(nombre);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(comprimir ? 8 : 0, 8);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nom.length, 26);
    partes.push(local, nom, cuerpo);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(comprimir ? 8 : 0, 10);
    c.writeUInt32LE(cuerpo.length, 20);
    c.writeUInt32LE(datos.length, 24);
    c.writeUInt16LE(nom.length, 28);
    c.writeUInt32LE(desplazamiento, 42);
    central.push(c, nom);
    desplazamiento += 30 + nom.length + cuerpo.length;
  }
  const dc = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(dc.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partes, dc, fin]);
}

const hoja = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>5.2999555010E+11</v></c><c r="C2" t="inlineStr"><is><t>a &amp; b</t></is></c></row>
<row r="3"/>
</sheetData></worksheet>`;
const compartidas = '<sst><si><t>Nombre</t></si><si><t>Tel</t></si><si><r><t>Ana </t></r><r><t>Prueba</t></r></si></sst>';

describe('leerXlsx', () => {
  for (const comprimir of [false, true]) {
    it(`lee celdas compartidas, en linea, huecos y notacion cientifica (deflate=${comprimir})`, () => {
      const filas = leerXlsx(zip({ 'xl/sharedStrings.xml': compartidas, 'xl/worksheets/sheet1.xml': hoja }, comprimir));
      expect(filas[0]).toEqual(['Nombre', '', 'Tel']);
      expect(filas[1]).toEqual(['Ana Prueba', '529995550100', 'a & b']);
      expect(filas[2]).toEqual([]);
    });
  }

  it('falla con un archivo que no es XLSX', () => {
    expect(() => leerXlsx(new Uint8Array(100))).toThrow(/XLSX invalido/);
  });
});
