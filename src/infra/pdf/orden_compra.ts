// PDF de la orden de compra a un proveedor (Isaac o Karen). Mismo motor que la nota (huella estable, una sola tinta, fuentes incrustadas).
// Lleva proveedor, folio, fecha, renglones (producto, sabor, cantidad, costo por pieza e importe), total de piezas y de mercancia, guias y nota.
// NO lleva saldos, utilidad, margenes ni cuentas de socios: es el documento que se le manda al proveedor.
import { etiquetaFecha, formatearMoneda, nombreVape, saborMayus } from '@/dominio/formato';
import type { CompraDetalle } from '@/dominio/operacion/tipos';
import { Hoja, M, UTIL, nuevoDocumento, pie, sinAzar } from './nota';

export async function pdfOrdenCompra(c: CompraDetalle, emitidaAt: string): Promise<Uint8Array> {
  return sinAzar(async () => {
    const { pdf, f } = await nuevoDocumento(`Orden de compra ${c.folio}`, emitidaAt);
    const h = new Hoja(pdf, f);
    h.bajar(14);
    h.texto('RTM', M, 26, { fuente: f.marca });
    h.texto('ORDEN DE COMPRA', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    h.bajar(15);
    h.texto(c.folio, M + UTIL, 10, { derecha: true });
    h.bajar(13);
    h.texto(etiquetaFecha(c.fecha_neg), M + UTIL, 10, { derecha: true });
    h.bajar(10);
    h.linea();
    h.bajar(22);
    h.texto('PROVEEDOR', M, 8, { fuente: f.negrita });
    h.texto('ENVÍO', M + 300, 8, { fuente: f.negrita });
    h.bajar(14);
    h.texto(c.proveedor.nombre, M, 14, { fuente: f.negrita, ancho: 280 });
    h.texto(c.destino === 'bodega' ? 'Bodega de Mérida' : 'Directo al cliente', M + 300, 10, { ancho: UTIL - 300 });
    h.bajar(14);
    if (c.llegada_estimada) h.texto(`Llegada estimada: ${etiquetaFecha(c.llegada_estimada)}`, M + 300, 9, { ancho: UTIL - 300 });
    h.bajar(24);

    const X = { prod: M, sabor: M + 190, cant: M + 360, costo: M + 436, total: M + UTIL };
    const cabecera = () => {
      h.texto('PRODUCTO', X.prod, 8, { fuente: f.negrita });
      h.texto('SABOR', X.sabor, 8, { fuente: f.negrita });
      h.texto('CANTIDAD', X.cant, 8, { fuente: f.negrita, derecha: true });
      h.texto('COSTO', X.costo, 8, { fuente: f.negrita, derecha: true });
      h.texto('IMPORTE', X.total, 8, { fuente: f.negrita, derecha: true });
      h.bajar(5);
      h.linea();
      h.bajar(14);
    };
    cabecera();
    const lineas = [...c.lineas].sort((a, b) => a.modelo.localeCompare(b.modelo, 'es') || a.sabor.localeCompare(b.sabor, 'es'));
    let modeloActual = '';
    for (const l of lineas) {
      h.asegurar(16, cabecera);
      h.texto(l.modelo === modeloActual ? '' : nombreVape(l.modelo), X.prod, 10, { fuente: l.modelo === modeloActual ? f.cuerpo : f.negrita, ancho: 180 });
      modeloActual = l.modelo;
      h.texto(saborMayus(l.sabor), X.sabor, 10, { ancho: 160 });
      h.texto(String(l.pagadas), X.cant, 10, { derecha: true });
      h.texto(formatearMoneda(l.costo_unit_cent), X.costo, 10, { derecha: true });
      h.texto(formatearMoneda(BigInt(l.pagadas) * l.costo_unit_cent), X.total, 10, { derecha: true });
      h.bajar(14);
    }
    h.linea();
    h.bajar(18);

    h.asegurar(100);
    const fila = (etiqueta: string, valor: string, fuerte = false) => {
      h.texto(etiqueta, X.costo - 110, fuerte ? 12 : 10, { fuente: fuerte ? f.negrita : f.cuerpo });
      h.texto(valor, X.total, fuerte ? 12 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, derecha: true });
      h.bajar(fuerte ? 18 : 14);
    };
    fila('Piezas', String(c.lineas.reduce((a, l) => a + l.pagadas, 0)));
    fila('Mercancía', formatearMoneda(c.mercancia_cent));
    if (c.guia_cent > 0n) fila('Guía', formatearMoneda(c.guia_cent));
    if (c.seguro_cent > 0n) fila('Seguro', formatearMoneda(c.seguro_cent));
    fila('Total', formatearMoneda(c.total_cent), true);
    if (c.guias.length > 0) {
      h.bajar(6);
      h.texto(`Guías: ${c.guias.map((g) => `${g.paqueteria} ${g.numero}`).join(' · ')}`, M, 9, { ancho: UTIL });
      h.bajar(14);
    }
    if (c.nota) {
      h.bajar(6);
      h.texto(`Nota: ${c.nota}`, M, 9, { ancho: UTIL });
      h.bajar(14);
    }
    pie(f, h, `${c.folio} · Orden de compra a ${c.proveedor.nombre}`);
    return pdf.save({ useObjectStreams: false });
  });
}
