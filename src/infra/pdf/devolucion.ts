// PDF de la nota de credito de un cliente y de la devolucion a un proveedor. Mismo motor que la nota (huella estable, una sola tinta, fuentes incrustadas).
// La nota de credito NO lleva costos ni utilidad; la devolucion a proveedor lleva el credito acordado (valor), nunca precios de venta.
import { etiquetaFecha, formatearMoneda, nombreVape, saborMayus } from '@/dominio/formato';
import type { FuenteDevolucion } from '@/dominio/operacion/tipos';
import { Hoja, M, UTIL, nuevoDocumento, pie, sinAzar } from './nota';

export async function pdfDevolucion(fuente: FuenteDevolucion): Promise<Uint8Array> {
  return sinAzar(async () => {
    const s = fuente.snapshot;
    const esCliente = fuente.tipo === 'cliente';
    const { pdf, f } = await nuevoDocumento(`${esCliente ? 'Nota de crédito' : 'Devolución a proveedor'} ${fuente.folio}`, fuente.emitida_at);
    const h = new Hoja(pdf, f);
    h.bajar(14);
    h.texto('RTM', M, 26, { fuente: f.marca });
    h.texto(esCliente ? 'NOTA DE CRÉDITO' : 'DEVOLUCIÓN A PROVEEDOR', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    h.bajar(15);
    h.texto(fuente.folio, M + UTIL, 10, { derecha: true });
    h.bajar(13);
    h.texto(etiquetaFecha(s.fecha), M + UTIL, 10, { derecha: true });
    h.bajar(10);
    h.linea();
    h.bajar(22);
    h.texto(esCliente ? 'CLIENTE' : 'PROVEEDOR', M, 8, { fuente: f.negrita });
    h.texto(esCliente ? 'PEDIDO' : 'ORDEN DE COMPRA', M + 300, 8, { fuente: f.negrita });
    h.bajar(14);
    h.texto((esCliente ? s.cliente : s.proveedor) ?? '', M, 12, { fuente: f.negrita, ancho: 280 });
    h.texto((esCliente ? s.pedido : s.compra) ?? 'Sin orden', M + 300, 10, { ancho: UTIL - 300 });
    h.bajar(14);
    h.texto(`Motivo: ${s.motivo}`, M, 9, { ancho: UTIL });
    h.bajar(26);

    const X = { prod: M, sabor: M + 200, cant: M + 372, precio: M + 436, total: M + UTIL };
    const cabecera = () => {
      h.texto('PRODUCTO', X.prod, 8, { fuente: f.negrita });
      h.texto('SABOR', X.sabor, 8, { fuente: f.negrita });
      h.texto('CANTIDAD', X.cant, 8, { fuente: f.negrita, derecha: true });
      if (esCliente) h.texto('PRECIO', X.precio, 8, { fuente: f.negrita, derecha: true });
      h.texto(esCliente ? 'CRÉDITO' : 'VALOR', X.total, 8, { fuente: f.negrita, derecha: true });
      h.bajar(5);
      h.linea();
      h.bajar(14);
    };
    cabecera();
    for (const l of s.lineas) {
      h.asegurar(16, cabecera);
      h.texto(nombreVape(l.modelo), X.prod, 10, { ancho: 190 });
      h.texto(saborMayus(l.sabor) + (l.destino === 'merma' ? ' (dañado)' : ''), X.sabor, 10, { ancho: 165 });
      h.texto(String(l.piezas), X.cant, 10, { derecha: true });
      if (esCliente && l.precio_cent !== undefined) h.texto(formatearMoneda(l.precio_cent), X.precio, 10, { derecha: true });
      h.texto(formatearMoneda((esCliente ? l.total_cent : l.valor_cent) ?? 0n), X.total, 10, { derecha: true });
      h.bajar(14);
    }
    h.linea();
    h.bajar(18);

    h.asegurar(110);
    const fila = (etiqueta: string, valor: string, fuerte = false) => {
      h.texto(etiqueta, X.precio - 100, fuerte ? 12 : 10, { fuente: fuerte ? f.negrita : f.cuerpo });
      h.texto(valor, X.total, fuerte ? 12 : 10, { fuente: fuerte ? f.negrita : f.cuerpo, derecha: true });
      h.bajar(fuerte ? 18 : 14);
    };
    fila('Piezas devueltas', String(s.piezas_total));
    if (esCliente) {
      if (s.nota && s.total_nota_cent !== undefined) fila(`Total de la nota ${s.nota}`, formatearMoneda(s.total_nota_cent));
      fila('Crédito total', formatearMoneda(s.total_cent ?? 0n), true);
      if (s.liberado_cent !== undefined && s.liberado_cent > 0n) fila('Saldo a favor del cliente', formatearMoneda(s.liberado_cent));
      fila('Saldo del pedido después', formatearMoneda(s.saldo_despues_cent));
    } else {
      fila('Crédito a favor de la sociedad', formatearMoneda(s.valor_cent ?? 0n), true);
    }
    pie(f, h, fuente.folio);
    return pdf.save({ useObjectStreams: false });
  });
}
