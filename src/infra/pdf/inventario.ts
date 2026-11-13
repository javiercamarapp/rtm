// PDF del inventario: Carta, formal, minimalista, una sola tinta (negro sobre blanco), la misma linea de la nota. Mismo contenido => mismos bytes (huella estable).
// Version CLIENTES: nunca lleva costos, utilidad, valor ni proveedor; por defecto solo "Disponible" o "Agotado". Version INTERNA: piezas, costo promedio, valor y semaforo.
import { PALABRA_COBERTURA, textoDias } from '@/dominio/inventario/cobertura';
import { marcasDelDocumento, tituloDisponible } from '@/dominio/inventario/compartir';
import type { ModeloDocumento, SnapshotInventario } from '@/dominio/inventario/tipos';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { Hoja, M, UTIL, nuevoDocumento, pie, sinAzar } from './nota';

function piezasDe(m: ModeloDocumento): number {
  return typeof m.disponible === 'number' ? m.disponible : (m.cantidad ?? 0);
}

export async function pdfInventario(s: SnapshotInventario, folio: string, huella: string): Promise<Uint8Array> {
  return sinAzar(async () => {
    const interna = s.version === 'interna';
    const { pdf, f } = await nuevoDocumento(`${interna ? 'Inventario interno' : 'Disponible'} ${folio}`, s.corte);
    const h = new Hoja(pdf, f);
    const marcas = marcasDelDocumento(s);

    h.bajar(14);
    h.texto(interna ? 'Inventario' : tituloDisponible(s), M, interna ? 26 : 20, { fuente: f.marca, ancho: UTIL - 120 });
    h.texto(interna ? 'SOLO PARA SOCIOS' : 'LISTA DE DISPONIBLE', M + UTIL, 10, { fuente: f.negrita, derecha: true });
    h.bajar(15);
    h.texto(folio, M + UTIL, 10, { derecha: true });
    h.bajar(13);
    h.texto(`Corte: ${etiquetaFechaHora(s.corte)}`, M + UTIL, 10, { derecha: true });
    if (interna) {
      h.bajar(13);
      h.texto(`Fecha de negocio: ${etiquetaFecha(s.hoy)}`, M + UTIL, 10, { derecha: true });
    }
    h.bajar(10);
    h.linea();
    h.bajar(22);

    // Columnas
    const X = interna
      ? { modelo: M, sabor: M + 150, pzs: M + 285, disp: M + 340, costo: M + 405, valor: M + UTIL, estado: 0, precio: 0 }
      : { modelo: M, sabor: M + 200, pzs: 0, disp: 0, costo: 0, valor: 0, estado: M + 360, precio: M + UTIL };
    const conCantidad = !interna && s.parametros.mostrar_cantidades;
    const conPrecio = !interna && s.modelos.some((m) => m.precio_cent !== undefined && m.precio_cent !== null);
    const cabecera = () => {
      if (interna) {
        h.texto('MODELO', X.modelo, 8, { fuente: f.negrita });
        h.texto('SABOR', X.sabor, 8, { fuente: f.negrita });
        h.texto('PIEZAS', X.pzs, 8, { fuente: f.negrita, derecha: true });
        h.texto('DISPONIBLE', X.disp, 8, { fuente: f.negrita, derecha: true });
        h.texto('COSTO PROM.', X.costo, 8, { fuente: f.negrita, derecha: true });
        h.texto('VALOR', X.valor, 8, { fuente: f.negrita, derecha: true });
      } else {
        h.texto('MODELO', X.modelo, 8, { fuente: f.negrita });
        h.texto('SABOR', X.sabor, 8, { fuente: f.negrita });
        h.texto(conCantidad ? 'PIEZAS' : 'ESTADO', X.estado, 8, { fuente: f.negrita, derecha: conCantidad });
        if (conPrecio) h.texto('PRECIO', X.precio, 8, { fuente: f.negrita, derecha: true });
      }
      h.bajar(5);
      h.linea();
      h.bajar(14);
    };

    let totalPz = 0;
    let totalValor = 0n;
    for (const marca of marcas) {
      const modelos = s.modelos.filter((m) => m.marca === marca);
      h.asegurar(60);
      if (marcas.length > 1) {
        h.texto(marca.toUpperCase(), M, 11, { fuente: f.negrita });
        h.bajar(14);
      }
      cabecera();
      let subPz = 0;
      let subValor = 0n;
      for (const m of modelos) {
        h.asegurar(16 + 13 * Math.max(m.sabores.length, 1), cabecera);
        const puffs = s.parametros.con_caladas && m.puffs ? ` · ${formatearPiezas(m.puffs).replace(/\s*pz$/, '')} caladas` : '';
        h.texto(`${m.modelo}${puffs}`, X.modelo, 10, { fuente: f.negrita, ancho: interna ? 225 : 340 });
        if (interna) {
          h.texto(String(m.piezas ?? 0), X.pzs, 10, { fuente: f.negrita, derecha: true });
          h.texto(String(piezasDe(m)), X.disp, 10, { fuente: f.negrita, derecha: true });
          h.texto(m.costo_prom_cent == null ? 'Sin dato' : formatearMoneda(m.costo_prom_cent), X.costo, 10, { fuente: f.negrita, derecha: true });
          h.texto(m.valor_cent == null ? 'Sin dato' : formatearMoneda(m.valor_cent), X.valor, 10, { fuente: f.negrita, derecha: true });
          subPz += m.piezas ?? 0;
          subValor += m.valor_cent ?? 0n;
        } else {
          h.texto(m.disponible ? 'Disponible' : 'Agotado', X.estado, 10, { fuente: f.negrita, derecha: conCantidad });
          if (conCantidad) h.texto(String(piezasDe(m)), X.estado + 60, 10, { fuente: f.negrita, derecha: true });
          if (conPrecio) h.texto(m.precio_cent == null ? 'Sin precio' : formatearMoneda(m.precio_cent), X.precio, 10, { fuente: f.negrita, derecha: true });
        }
        h.bajar(14);
        for (const sa of m.sabores) {
          h.asegurar(14, cabecera);
          h.texto(sa.sabor, X.sabor, 10, { ancho: interna ? 128 : 150 });
          if (interna) {
            h.texto(String(sa.piezas ?? 0), X.pzs, 10, { derecha: true });
            h.texto(String(typeof sa.disponible === 'number' ? sa.disponible : 0), X.disp, 10, { derecha: true });
            h.texto(sa.estado ? PALABRA_COBERTURA[sa.estado] : '', X.costo, 8, { derecha: true });
            h.texto(sa.valor_cent === undefined ? '' : formatearMoneda(sa.valor_cent), X.valor, 10, { derecha: true });
          } else {
            h.texto(sa.disponible ? 'Disponible' : 'Agotado', X.estado, 10);
            if (conCantidad) h.texto(String(sa.cantidad ?? 0), X.estado + 60, 10, { derecha: true });
          }
          h.bajar(13);
        }
        if (interna) {
          h.texto(`Cobertura ${m.estado ? `${PALABRA_COBERTURA[m.estado]} · ` : ''}${textoDias(m.cobertura_dias ?? null)}`, X.sabor, 8);
          h.bajar(12);
        }
        h.bajar(3);
      }
      if (interna) {
        h.asegurar(30, cabecera);
        h.linea();
        h.bajar(13);
        h.texto(`Subtotal ${marca}`, X.modelo, 10, { fuente: f.negrita });
        h.texto(String(subPz), X.pzs, 10, { fuente: f.negrita, derecha: true });
        h.texto(formatearMoneda(subValor), X.valor, 10, { fuente: f.negrita, derecha: true });
        h.bajar(20);
        totalPz += subPz;
        totalValor += subValor;
      } else {
        h.bajar(8);
      }
    }
    if (s.modelos.length === 0) {
      h.texto('No hay modelos que cumplan los filtros elegidos.', M, 10);
      h.bajar(16);
    }
    if (interna && s.modelos.length > 0) {
      h.asegurar(40);
      h.linea(1);
      h.bajar(15);
      h.texto('Total del inventario', X.modelo, 11, { fuente: f.negrita });
      h.texto(String(totalPz), X.pzs, 11, { fuente: f.negrita, derecha: true });
      h.texto(formatearMoneda(totalValor), X.valor, 11, { fuente: f.negrita, derecha: true });
      h.bajar(16);
    }
    h.asegurar(30);
    h.bajar(6);
    h.texto(`Huella del contenido: ${huella.slice(0, 16)}`, M, 8);
    pie(f, h, `${folio} · ${interna ? 'interna' : 'clientes'}`);
    return pdf.save({ useObjectStreams: false });
  });
}
