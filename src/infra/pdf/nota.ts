// Motor de PDF minimo con HUELLA ESTABLE: mismo contenido => mismos bytes => mismo sha256. Carta, una sola tinta (negro sobre blanco), linea fina de 0.5 pt,
// cifras alineadas a la derecha. Fuentes incrustadas (Geist, la misma tipografia de la interfaz; archivos locales, SIL OFL 1.1 permite incrustarla), con cifras tabulares (tnum). Sin fechas del reloj, sin azar: el PDF se genera UNA vez y se guarda.
// La nota del cliente NO contiene costos, utilidad ni margen; la hoja interna es solo para socios.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import type { NotaFuente } from '@/dominio/operacion/tipos';

export const ANCHO = 612;
export const ALTO = 792;
export const M = 54;
export const UTIL = ANCHO - 2 * M;
const NEGRO = rgb(0, 0, 0);

export interface Fuentes { cuerpo: PDFFont; negrita: PDFFont; marca: PDFFont }

function archivoFuente(nombre: string): Uint8Array {
  return readFileSync(join(process.cwd(), 'src', 'fuentes', nombre));
}

export function huella(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Math.random fijo durante la generacion: pdf-lib sufija con azar el nombre de la fuente subconjunto; sin eso dos corridas no darian los mismos bytes. */
export async function sinAzar<T>(fn: () => Promise<T>): Promise<T> {
  const original = Math.random;
  let semilla = 0x2f6e2b1;
  Math.random = () => {
    semilla = (semilla * 1664525 + 1013904223) >>> 0;
    return semilla / 0x1_0000_0000;
  };
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

export async function nuevoDocumento(titulo: string, emitidaAt: string): Promise<{ pdf: PDFDocument; f: Fuentes }> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fecha = new Date(emitidaAt);
  pdf.setCreationDate(fecha);
  pdf.setModificationDate(fecha);
  pdf.setProducer('RTM');
  pdf.setCreator('RTM');
  pdf.setTitle(titulo);
  pdf.setAuthor('RTM');
  // Geist trae cifras proporcionales por omision: `tnum` las vuelve tabulares para que las columnas de dinero alineen digito con digito.
  const features = { tnum: true };
  const cuerpo = await pdf.embedFont(archivoFuente('geist-latin-400-normal.woff'), { subset: true, features });
  const negrita = await pdf.embedFont(archivoFuente('geist-latin-600-normal.woff'), { subset: true, features });
  const marca = await pdf.embedFont(archivoFuente('geist-latin-400-normal.woff'), { subset: true, features });
  return { pdf, f: { cuerpo, negrita, marca } };
}

/** Simbolos que Geist (subconjunto latino) no trae y su equivalente en texto: se sustituyen ANTES de caer en el signo '?'. */
const EQUIVALENTE_TEXTO: Readonly<Record<string, string>> = {
  '✓': 'OK', '✔': 'OK', '✗': 'X', '✘': 'X', '≥': '>=', '≤': '<=', '≠': '!=', '→': '->', '←': '<-', '↔': '<->', '★': '*', '☆': '*', '●': '-', '▪': '-', '‣': '-', '−': '-',
};

/** Convierte lo que la fuente no puede dibujar: primero a su equivalente en texto (✓ -> OK, >= <= ->), y lo que no tenga equivalente (por ejemplo emojis) a '?', en lugar de fallar al generar. */
export function limpio(fuente: PDFFont, t: string): string {
  const juego = new Set(fuente.getCharacterSet());
  let s = '';
  for (const ch of t) {
    if (juego.has(ch.codePointAt(0)!)) { s += ch; continue; }
    const eq = EQUIVALENTE_TEXTO[ch];
    s += eq !== undefined && [...eq].every((c) => juego.has(c.codePointAt(0)!)) ? eq : '?';
  }
  return s;
}

export class Hoja {
  pagina!: PDFPage;
  y = 0;
  readonly paginas: PDFPage[] = [];
  constructor(private readonly pdf: PDFDocument, private readonly f: Fuentes) {
    this.nueva();
  }
  nueva(): void {
    this.pagina = this.pdf.addPage([ANCHO, ALTO]);
    this.paginas.push(this.pagina);
    this.y = ALTO - M;
  }
  asegurar(alto: number, repetir?: () => void): void {
    if (this.y - alto < M + 28) {
      this.nueva();
      repetir?.();
    }
  }
  texto(t: string, x: number, size: number, opts: { fuente?: PDFFont; derecha?: boolean; ancho?: number } = {}): void {
    const fuente = opts.fuente ?? this.f.cuerpo;
    let s = limpio(fuente, t);
    if (opts.ancho !== undefined) while (s.length > 1 && fuente.widthOfTextAtSize(s, size) > opts.ancho) s = `${s.slice(0, -2)}…`;
    const w = fuente.widthOfTextAtSize(s, size);
    this.pagina.drawText(s, { x: opts.derecha ? x - w : x, y: this.y, size, font: fuente, color: NEGRO });
  }
  linea(grosor = 0.5, x1 = M, x2 = M + UTIL): void {
    this.pagina.drawLine({ start: { x: x1, y: this.y }, end: { x: x2, y: this.y }, thickness: grosor, color: NEGRO });
  }
  bajar(n: number): void {
    this.y -= n;
  }
}

export function pie(f: Fuentes, hoja: Hoja, folio: string): void {
  const total = hoja.paginas.length;
  hoja.paginas.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: M + UTIL, y: M + 14 }, thickness: 0.5, color: NEGRO });
    p.drawText(limpio(f.cuerpo, folio), { x: M, y: M, size: 8, font: f.cuerpo, color: NEGRO });
    const t = `Página ${i + 1} de ${total}`;
    p.drawText(t, { x: M + UTIL - f.cuerpo.widthOfTextAtSize(t, 8), y: M, size: 8, font: f.cuerpo, color: NEGRO });
  });
}

function partirPalabras(fuente: PDFFont, t: string, size: number, ancho: number): string[] {
  const salida: string[] = [];
  for (const parrafo of t.split('\n')) {
    let actual = '';
    for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (fuente.widthOfTextAtSize(limpio(fuente, prueba), size) > ancho && actual) {
        salida.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    salida.push(actual);
  }
  return salida;
}

/** Nota para el cliente: marca, folio y fecha, nombre del cliente (sin direccion ni telefono), producto / sabor / cantidad / precio / total con subtotal por modelo. */
export async function pdfNotaCliente(n: NotaFuente): Promise<Uint8Array> {
  return sinAzar(async () => {
    const c = n.cliente;
    const { pdf, f } = await nuevoDocumento(`Nota ${n.folio_documento}`, n.emitida_at);
    const h = new Hoja(pdf, f);
    const marca = (typeof n.marca_texto === 'string' && n.marca_texto.trim() !== '' ? n.marca_texto : 'RTM').trim();

    h.bajar(14);
    h.texto(marca, M, 26, { fuente: f.marca });
    h.texto(n.tipo === 'correccion' ? 'NOTA CORREGIDA' : 'NOTA', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    h.bajar(15);
    h.texto(n.folio_documento, M + UTIL, 10, { derecha: true });
    h.bajar(13);
    h.texto(c.fecha ? etiquetaFecha(c.fecha) : '', M + UTIL, 10, { derecha: true });
    h.bajar(10);
    h.linea();
    h.bajar(22);
    h.texto('CLIENTE', M, 8, { fuente: f.negrita });
    h.texto('ENTREGA', M + 300, 8, { fuente: f.negrita });
    h.bajar(14);
    h.texto(c.cliente, M, 12, { fuente: f.negrita, ancho: 280 });
    h.texto(c.entrega, M + 300, 10, { ancho: UTIL - 300 });
    if (n.corrige) {
      h.bajar(14);
      h.texto(`Esta nota corrige la ${n.corrige}.`, M, 9);
    }
    h.bajar(26);

    const X = { prod: M, sabor: M + 200, cant: M + 372, precio: M + 436, total: M + UTIL };
    const cabecera = () => {
      h.texto('PRODUCTO', X.prod, 8, { fuente: f.negrita });
      h.texto('SABOR', X.sabor, 8, { fuente: f.negrita });
      h.texto('CANTIDAD', X.cant, 8, { fuente: f.negrita, derecha: true });
      h.texto('PRECIO', X.precio, 8, { fuente: f.negrita, derecha: true });
      h.texto('TOTAL', X.total, 8, { fuente: f.negrita, derecha: true });
      h.bajar(5);
      h.linea();
      h.bajar(14);
    };
    cabecera();
    for (const g of c.grupos) {
      h.asegurar(16 + 14 * g.sabores.length, cabecera);
      h.texto(g.modelo, X.prod, 10, { fuente: f.negrita, ancho: 330 });
      h.texto(String(g.piezas), X.cant, 10, { fuente: f.negrita, derecha: true });
      h.texto(formatearMoneda(g.subtotal_cent), X.total, 10, { fuente: f.negrita, derecha: true });
      h.bajar(14);
      for (const s of g.sabores) {
        h.texto(s.sabor, X.sabor, 10, { ancho: 165 });
        h.texto(String(s.piezas), X.cant, 10, { derecha: true });
        h.texto(formatearMoneda(s.precio_cent), X.precio, 10, { derecha: true });
        h.texto(formatearMoneda(s.total_cent), X.total, 10, { derecha: true });
        h.bajar(14);
      }
      h.bajar(2);
    }
    h.linea();
    h.bajar(18);

    h.asegurar(120);
    const fila = (etiqueta: string, valor: string, fuerte = false) => {
      h.texto(etiqueta, X.precio - 120, fuerte ? 12 : 10, { fuente: fuerte ? f.negrita : f.cuerpo });
      h.texto(valor, X.total, fuerte ? 12 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, derecha: true });
      h.bajar(fuerte ? 18 : 14);
    };
    fila('Cantidad total', `${c.piezas_total} piezas`);
    fila('Subtotal', formatearMoneda(c.subtotal_cent));
    if (c.envio_cent > 0n) fila('Envío', formatearMoneda(c.envio_cent));
    if (c.recargo_cent > 0n) fila('Recargo', formatearMoneda(c.recargo_cent));
    if (c.descuento_cent > 0n) fila('Descuento', `-${formatearMoneda(c.descuento_cent)}`);
    h.linea(0.5, X.precio - 120, X.total);
    h.bajar(14);
    fila('Total a saldar', formatearMoneda(c.total_cent), true);

    if (n.datos_pago_texto && n.datos_pago_texto.trim() !== '') {
      const lineas = partirPalabras(f.cuerpo, n.datos_pago_texto, 9, UTIL);
      h.bajar(14);
      h.asegurar(24 + 12 * lineas.length);
      h.texto('INFORMACIÓN DE PAGO', M, 8, { fuente: f.negrita });
      h.bajar(13);
      for (const l of lineas) {
        h.texto(l, M, 9);
        h.bajar(12);
      }
    }
    pie(f, h, n.folio_documento);
    return pdf.save({ useObjectStreams: false });
  });
}

/** Hoja interna (solo socios): costo, utilidad por modelo y por pedido, cascada y comprobaciones C1 y C2. */
export async function pdfHojaInterna(n: NotaFuente): Promise<Uint8Array> {
  return sinAzar(async () => {
    const i = n.interno;
    const { pdf, f } = await nuevoDocumento(`Hoja interna ${n.folio_documento}`, n.emitida_at);
    const h = new Hoja(pdf, f);
    h.bajar(14);
    h.texto('Hoja interna', M, 24, { fuente: f.marca });
    h.texto('SOLO PARA SOCIOS', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    h.bajar(15);
    h.texto(n.folio_documento, M + UTIL, 10, { derecha: true });
    h.bajar(10);
    h.linea();
    h.bajar(20);
    h.texto(`${i.cliente} · origen ${i.origen.replaceAll('_', ' ')}`, M, 10, { ancho: UTIL });
    h.bajar(24);

    const x = { a: M, b: M + 190, c: M + 280, d: M + 360, e: M + 440, f: M + UTIL };
    const cab = (t1: string) => {
      h.texto(t1, x.a, 8, { fuente: f.negrita });
      h.texto('PIEZAS', x.c, 8, { fuente: f.negrita, derecha: true });
      h.texto('VENTA', x.d, 8, { fuente: f.negrita, derecha: true });
      h.texto('COSTO', x.e, 8, { fuente: f.negrita, derecha: true });
      h.texto('UTILIDAD', x.f, 8, { fuente: f.negrita, derecha: true });
      h.bajar(5);
      h.linea();
      h.bajar(13);
    };
    cab('POR MODELO');
    for (const m of i.por_modelo) {
      h.asegurar(16, () => cab('POR MODELO'));
      h.texto(m.modelo, x.a, 10, { ancho: 215 });
      h.texto(String(m.piezas), x.c, 10, { derecha: true });
      h.texto(formatearMoneda(m.venta_cent), x.d, 10, { derecha: true });
      h.texto(formatearMoneda(m.costo_cent), x.e, 10, { derecha: true });
      h.texto(formatearMoneda(m.utilidad_cent), x.f, 10, { derecha: true });
      h.bajar(14);
    }
    h.linea();
    h.bajar(22);

    const k = i.cascada;
    h.asegurar(190);
    h.texto('CASCADA DE LA UTILIDAD', M, 8, { fuente: f.negrita });
    h.bajar(14);
    const fila = (t: string, v: string, fuerte = false) => {
      h.texto(t, M, fuerte ? 11 : 10, { fuente: fuerte ? f.negrita : f.cuerpo });
      h.texto(v, M + 260, fuerte ? 11 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, derecha: true });
      h.bajar(14);
    };
    fila('Venta', formatearMoneda(k.venta_cent));
    fila('Envío cobrado', formatearMoneda(k.envio_cent));
    if (k.recargo_cent > 0n) fila('Recargo', formatearMoneda(k.recargo_cent));
    if (k.descuento_cent !== 0n) fila('Descuento', formatearMoneda(k.descuento_cent));
    fila('Total del pedido', formatearMoneda(k.total_cent), true);
    fila('Costo de las piezas', formatearMoneda(-k.costo_cent));
    fila('Renta de bodega', formatearMoneda(-k.renta_cent));
    fila('Guía', k.guia_cent === null ? 'Sin costear' : formatearMoneda(-k.guia_cent));
    fila(k.utilidad_provisional ? 'Utilidad provisional' : 'Utilidad', formatearMoneda(k.utilidad_cent), true);
    h.bajar(10);

    h.asegurar(80);
    h.texto('COMPROBACIONES', M, 8, { fuente: f.negrita });
    h.bajar(14);
    const c1 = i.comprobaciones.c1;
    const c2 = i.comprobaciones.c2;
    h.texto(`C1 renglón por renglón = por modelo: ${formatearMoneda(c1.renglones_cent)} y ${formatearMoneda(c1.modelos_cent)} — ${c1.cuadra ? 'Cuadra' : 'No cuadra'}`, M, 10);
    h.bajar(14);
    h.texto(`C2 pedidas ${c2.pedidas}, salidas ${c2.salidas}, en nota ${c2.en_nota}, cobradas ${c2.cobradas}; pendientes ${c2.pendientes} — ${c2.cuadra ? 'Cuadra' : 'No cuadra'}`, M, 10);
    h.bajar(24);

    const det = () => {
      h.texto('DETALLE POR SABOR', x.a, 8, { fuente: f.negrita });
      h.texto('PIEZAS', x.c, 8, { fuente: f.negrita, derecha: true });
      h.texto('PRECIO', x.d, 8, { fuente: f.negrita, derecha: true });
      h.texto('COSTO UNIT.', x.e, 8, { fuente: f.negrita, derecha: true });
      h.texto('UTILIDAD', x.f, 8, { fuente: f.negrita, derecha: true });
      h.bajar(5);
      h.linea();
      h.bajar(13);
    };
    h.asegurar(40);
    det();
    for (const l of i.lineas) {
      h.asegurar(16, det);
      h.texto(`${l.modelo} · ${l.sabor}`, x.a, 9, { ancho: 215 });
      h.texto(String(l.piezas), x.c, 9, { derecha: true });
      h.texto(formatearMoneda(l.precio_cent), x.d, 9, { derecha: true });
      h.texto(formatearMoneda(l.costo_unit_cent), x.e, 9, { derecha: true });
      h.texto(formatearMoneda(l.utilidad_cent), x.f, 9, { derecha: true });
      h.bajar(13);
    }
    pie(f, h, `${n.folio_documento} · interna`);
    return pdf.save({ useObjectStreams: false });
  });
}
