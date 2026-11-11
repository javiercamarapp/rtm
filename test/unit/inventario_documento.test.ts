// PDF del inventario (adenda 28): la version para clientes no contiene costos, utilidad ni nombre del proveedor; mismo contenido => misma huella;
// el texto de compartir no lleva cifras sensibles. Datos ILUSTRATIVOS (ningun dato real).
import { describe, expect, it } from 'vitest';
import { enlaceWhatsApp, nombreArchivo, textoParaCompartir, tituloDisponible } from '@/dominio/inventario/compartir';
import { kardexCsv } from '@/dominio/inventario/csv';
import type { Kardex, SnapshotInventario } from '@/dominio/inventario/tipos';
import { pdfInventario } from '@/infra/pdf/inventario';
import { huella } from '@/infra/pdf/nota';

const PARAMS = { marca: null, modelo: null, solo_socios_venden: false, solo_disponibles: false, mostrar_cantidades: false, con_caladas: false, cliente_id: null };

function clientes(extra: Partial<SnapshotInventario['parametros']> = {}, conPrecio = false): SnapshotInventario {
  return {
    version: 'clientes', corte: '2026-11-11T16:00:00.000Z', hoy: '2026-11-11', parametros: { ...PARAMS, ...extra },
    modelos: [
      { marca: 'Marca Ilustrativa', modelo: 'Modelo Alfa 50K', puffs: 50000, disponible: true, cantidad: extra.mostrar_cantidades ? 42 : undefined, precio_cent: conPrecio ? 25000n : undefined,
        sabores: [{ sabor: 'Mango', disponible: true, cantidad: extra.mostrar_cantidades ? 30 : undefined }, { sabor: 'Uva', disponible: false, cantidad: extra.mostrar_cantidades ? 0 : undefined }] },
      { marca: 'Marca Ilustrativa', modelo: 'Modelo Beta 15K', puffs: 15000, disponible: false, sabores: [{ sabor: 'Sandía', disponible: false }] },
    ],
  };
}

function interna(): SnapshotInventario {
  return {
    version: 'interna', corte: '2026-11-11T16:00:00.000Z', hoy: '2026-11-11', parametros: { ...PARAMS, mostrar_cantidades: true },
    modelos: [{ marca: 'Marca Ilustrativa', modelo: 'Modelo Alfa 50K', puffs: 50000, disponible: 40, piezas: 42, reservado: 2, valor_cent: 385000n, costo_prom_cent: 9166n, estado: 'buena', cobertura_dias: 24.5,
      sabores: [{ sabor: 'Mango', disponible: true, piezas: 30, valor_cent: 275000n, estado: 'excelente' }, { sabor: 'Uva', disponible: true, piezas: 12, valor_cent: 110000n, estado: 'urge' }] }],
    totales: { piezas: 42, valor_cent: 385000n, reservado: 2, modelos_con_existencia: 1 },
  };
}

async function textoDe(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let t = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    t += c.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return t;
}

describe('PDF del inventario para clientes', () => {
  it('no contiene costos, utilidad, valor, margen ni proveedor', async () => {
    const t = await textoDe(await pdfInventario(clientes(), 'INV-0001', 'a'.repeat(64)));
    expect(t).toContain('DISPONIBLE MARCA ILUSTRATIVA');
    expect(t).toContain('Disponible');
    expect(t).toContain('Agotado');
    expect(t).not.toMatch(/costo|utilidad|valor|margen|proveedor|Isaac|Karen|\$/i);
  });
  it('por defecto no trae cantidades exactas; con la opcion si', async () => {
    const sin = await textoDe(await pdfInventario(clientes(), 'INV-0001', 'a'.repeat(64)));
    expect(sin).not.toContain('42');
    const con = await textoDe(await pdfInventario(clientes({ mostrar_cantidades: true }), 'INV-0001', 'a'.repeat(64)));
    expect(con).toContain('42');
    expect(con).toContain('30');
  });
  it('los precios del tabulador salen solo si se pidieron', async () => {
    expect(await textoDe(await pdfInventario(clientes(), 'INV-0001', 'a'.repeat(64)))).not.toContain('$250');
    expect(await textoDe(await pdfInventario(clientes({ cliente_id: 7 }, true), 'INV-0001', 'a'.repeat(64)))).toContain('$250');
  });
  it('no lleva caladas por defecto y las lleva si se piden', async () => {
    expect(await textoDe(await pdfInventario(clientes(), 'INV-0001', 'a'.repeat(64)))).not.toMatch(/caladas/);
    expect(await textoDe(await pdfInventario(clientes({ con_caladas: true }), 'INV-0001', 'a'.repeat(64)))).toMatch(/50,000 caladas/);
  });
  it('mismo contenido, mismos bytes y misma huella', async () => {
    const a = await pdfInventario(clientes(), 'INV-0001', 'b'.repeat(64));
    const b = await pdfInventario(clientes(), 'INV-0001', 'b'.repeat(64));
    expect(huella(a)).toBe(huella(b));
    const c = await pdfInventario(clientes(), 'INV-0002', 'b'.repeat(64));
    expect(huella(c)).not.toBe(huella(a));
  });
});

describe('PDF interno del inventario', () => {
  it('trae piezas exactas, costo promedio, valor, semaforo y total', async () => {
    const t = await textoDe(await pdfInventario(interna(), 'INV-0003', 'c'.repeat(64)));
    expect(t).toContain('SOLO PARA SOCIOS');
    expect(t).toContain('$91.66');
    expect(t).toContain('$3,850.00');
    expect(t).toContain('Urge pedir');
    expect(t).toContain('Total del inventario');
    expect(t).not.toMatch(/Isaac|Karen/);
  });
});

describe('Compartir', () => {
  it('el titulo es DISPONIBLE <MARCA> (fecha) y el texto de compartir no lleva cifras sensibles', () => {
    const s = clientes({ mostrar_cantidades: true }, true);
    expect(tituloDisponible(s)).toMatch(/^DISPONIBLE MARCA ILUSTRATIVA \(.+\)$/);
    const texto = textoParaCompartir(s);
    expect(texto).not.toMatch(/\$|costo|valor|utilidad|42|30|250/);
    expect(texto).toContain('Marca Ilustrativa');
    expect(enlaceWhatsApp(texto)).toBe(`https://wa.me/?text=${encodeURIComponent(texto)}`);
    expect(nombreArchivo('INV-0001', 'clientes')).toBe('INV-0001-disponible.pdf');
  });
});

describe('CSV del kardex', () => {
  const k = (mensaje: string | null): Kardex => ({
    modelo: { id: 1, marca: 'M', nombre: 'Alfa' }, apertura: null, total: 1, truncado: false, sabores: [], modelos: [],
    comprobacion: { via1: 'a', via1_valor_cent: 0n, via2: 'b', via2_valor_cent: 0n, cuadra: true },
    movimientos: [{ id: 1, hora: '2026-11-11T10:00:00Z', fecha_neg: '2026-11-11', tipo: 'entrada_compra', sabor: 'Mango', sku_id: 1, ubicacion: 'bodega_omar', referencia: 'C-0001', entra_piezas: 100, entra_unit_cent: 12000n, entra_total_cent: 1200000n,
      sale_piezas: null, sale_unit_cent: null, sale_total_cent: null, saldo_piezas: 100, saldo_valor_cent: 1200000n, costo_prom_cent: 12000n, saldo_sabor_piezas: 100, evento: 'E-0001', canal: 'web', mensaje_origen: mensaje, autor: 'Javier', reversa_de: null, es_reversa: false, nota: null }],
  });
  it('escribe centavos exactos y las columnas del Excel', () => {
    const csv = kardexCsv(k(null));
    expect(csv).toContain('Entra piezas,Entra unitario,Entra total,Sale piezas');
    expect(csv).toContain('100,120.00,12000.00');
  });
  it('neutraliza formulas y comillas en el mensaje original', () => {
    expect(kardexCsv(k('=SUMA(A1)'))).toContain("'=SUMA(A1)");
    expect(kardexCsv(k('dijo "hola", ok'))).toContain('"dijo ""hola"", ok"');
  });
});
