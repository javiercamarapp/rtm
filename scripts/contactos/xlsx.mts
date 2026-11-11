// Lector minimo de XLSX (zip + XML) con node:zlib; sin dependencias. Devuelve una hoja como matriz de textos.
import { inflateRawSync } from 'node:zlib';

function entradasZip(b: Buffer): Map<string, Buffer> {
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 70000); i--) if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('Archivo XLSX invalido: sin directorio central');
  const total = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();
  for (let n = 0; n < total; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Archivo XLSX invalido: entrada corrupta');
    const metodo = b.readUInt16LE(p + 10);
    const tam = b.readUInt32LE(p + 20);
    const nom = b.readUInt16LE(p + 28);
    const ext = b.readUInt16LE(p + 30);
    const com = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nombre = b.toString('utf8', p + 46, p + 46 + nom);
    const datosIni = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const crudo = b.subarray(datosIni, datosIni + tam);
    salida.set(nombre, metodo === 0 ? crudo : inflateRawSync(crudo));
    p += 46 + nom + ext + com;
  }
  return salida;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificarXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTIDADES[e] ?? m;
  });
}

function textoDe(xml: string): string {
  let t = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += m[1];
  return decodificarXml(t);
}

function columna(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel guarda telefonos largos como numeros en notacion cientifica (5.2999E+11): se devuelven como enteros planos. */
function numeroPlano(v: string, tipo: string | undefined): string {
  if ((tipo === undefined || tipo === 'n') && /^-?\d+(\.\d+)?E[+-]?\d+$/i.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && Math.abs(n) < 1e21) return n.toFixed(0);
  }
  return v;
}

/** Lee una hoja de un XLSX como matriz de textos (celdas vacias = ''). */
export function leerXlsx(bytes: Uint8Array, hoja = 0): string[][] {
  const z = entradasZip(Buffer.from(bytes));
  const compartidas: string[] = [];
  const ss = z.get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textoDe(m[1]!));
  const nombres = [...z.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]));
  const datos = z.get(nombres[hoja] ?? '');
  if (!datos) throw new Error('Archivo XLSX invalido: hoja inexistente');
  const filas: string[][] = [];
  for (const fm of datos.toString('utf8').matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila: string[] = [];
    for (const cm of (fm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!;
      const ref = attrs.match(/\br="([A-Z]+)\d+"/);
      const tipo = attrs.match(/\bt="(\w+)"/)?.[1];
      const cuerpo = cm[2] ?? '';
      let valor = '';
      if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else {
        const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v !== undefined) valor = tipo === 's' ? (compartidas[Number(v)] ?? '') : numeroPlano(decodificarXml(v), tipo);
      }
      const i = ref ? columna(ref[1]!) : fila.length;
      while (fila.length < i) fila.push('');
      fila[i] = valor;
    }
    filas.push(fila);
  }
  return filas;
}
