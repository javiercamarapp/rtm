// Motor de PDF con huella estable (G11) y texto de WhatsApp (G1). Las cifras salen del documento del dueno (nota de Villa: 13,590.00 y 62 piezas),
// no del codigo. Los datos del cliente son ILUSTRATIVOS.
import { describe, expect, it } from 'vitest';
import { pdfHojaInterna, pdfNotaCliente, huella, limpio, nuevoDocumento } from '@/infra/pdf/nota';
import { textoNota } from '@/dominio/nota/texto';
import type { NotaFuente } from '@/dominio/operacion/tipos';

function villa(sobre: Partial<NotaFuente['cliente']> = {}, tipo: 'original' | 'correccion' = 'original'): NotaFuente {
  const grupos = [
    { modelo: 'Waka DM 15K', piezas: 24, subtotal_cent: 444000n, sabores: [{ sabor: 'Mango', piezas: 24, precio_cent: 18500n, total_cent: 444000n }] },
    { modelo: 'Fasta Kit 40K', piezas: 10, subtotal_cent: 185000n, sabores: [{ sabor: 'Uva', piezas: 10, precio_cent: 18500n, total_cent: 185000n }] },
    { modelo: 'Waka Jupiter 50K', piezas: 28, subtotal_cent: 700000n, sabores: [{ sabor: 'Mango', piezas: 16, precio_cent: 25000n, total_cent: 400000n }, { sabor: 'Sandía', piezas: 12, precio_cent: 25000n, total_cent: 300000n }] },
  ];
  return {
    id: 1, pedido_id: 1, folio_documento: tipo === 'correccion' ? 'P-0123-C1' : 'P-0123', tipo, emitida_at: '2026-11-10T18:00:00.000Z', motivo_correccion: tipo === 'correccion' ? 'ajuste' : null,
    corrige: tipo === 'correccion' ? 'P-0123' : null, marca_texto: null, datos_pago_texto: 'Transferencia a la cuenta que te indiquemos por mensaje.',
    cliente: {
      folio: 'P-0123', fecha: '2026-11-10', cliente: 'Cliente Ilustrativo', entrega: 'Envío por paquetería', grupos,
      lineas_texto: [
        { modelo: 'Waka Jupiter 50K', piezas: 28, precio_cent: 25000n, total_cent: 700000n },
        { modelo: 'Waka DM 15K', piezas: 24, precio_cent: 18500n, total_cent: 444000n },
        { modelo: 'Fasta Kit 40K', piezas: 10, precio_cent: 18500n, total_cent: 185000n },
      ],
      piezas_total: 62, subtotal_cent: 1329000n, envio_cent: 30000n, recargo_cent: 0n, descuento_cent: 0n, total_cent: 1359000n, ...sobre,
    },
    interno: {
      folio: 'P-0123', cliente: 'Cliente Ilustrativo', duenio: 'Javier', origen: 'bodega_omar', lineas: [], por_modelo: [
        { modelo: 'Waka DM 15K', piezas: 24, venta_cent: 444000n, costo_cent: 288000n, utilidad_cent: 156000n },
      ],
      cascada: { venta_cent: 1329000n, envio_cent: 30000n, recargo_cent: 0n, descuento_cent: 0n, total_cent: 1359000n, costo_cent: 900000n, renta_cent: 12400n, guia_cent: null, guia_pendiente: true, utilidad_cent: 446600n, utilidad_provisional: true },
      comprobaciones: { c1: { renglones_cent: 1329000n, modelos_cent: 1329000n, cuadra: true }, c2: { pedidas: 62, salidas: 62, en_nota: 62, cobradas: 62, pendientes: 0, cuadra: true } },
    },
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

describe('texto de WhatsApp (G1)', () => {
  it('es identico al formato del documento del dueno', () => {
    expect(textoNota(villa().cliente)).toBe(
      'Nota Cliente Ilustrativo\nWaka Jupiter 50K 28pz x $250 = 7,000\nWaka DM 15K 24pz x $185 = 4,440\nFasta Kit 40K 10pz x $185 = 1,850\nEnvío $300\n\ntotal a saldar 13,590.00',
    );
  });
  it('sin envio no hay renglon de envio; con descuento lo escribe', () => {
    expect(textoNota(villa({ envio_cent: 0n, total_cent: 1329000n }).cliente)).not.toContain('Envío');
    expect(textoNota(villa({ descuento_cent: 5000n, total_cent: 1354000n }).cliente)).toContain('Descuento -$50');
  });
});

describe('PDF de la nota para el cliente (G11)', () => {
  it('generarlo dos veces da el mismo sha256 (huella estable)', async () => {
    const a = await pdfNotaCliente(villa());
    const b = await pdfNotaCliente(villa());
    expect(huella(a)).toBe(huella(b));
    expect(Buffer.from(a).subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('trae las cifras exactas, 62 piezas y ninguna palabra de costo, utilidad ni margen', async () => {
    const t = await textoDe(await pdfNotaCliente(villa()));
    for (const c of ['7,000.00', '4,440.00', '1,850.00', '13,290.00', '300.00', '13,590.00', '62 piezas']) expect(t).toContain(c);
    expect(t.toLowerCase()).not.toMatch(/costo|utilidad|margen/);
    expect(t).toContain('Cliente Ilustrativo');
    expect(t).not.toMatch(/tel[eé]fono|direcci[oó]n|calle/i);
  });
  it('la suma de los subtotales por modelo es igual al subtotal general', () => {
    const c = villa().cliente;
    expect(c.grupos.reduce((s, g) => s + g.subtotal_cent, 0n)).toBe(c.subtotal_cent);
  });
  it('una correccion lleva su folio -C1 y la leyenda de a cual corrige; otro contenido, otra huella', async () => {
    const orig = await pdfNotaCliente(villa());
    const corr = await pdfNotaCliente(villa({ envio_cent: 35000n, total_cent: 1364000n }, 'correccion'));
    const t = await textoDe(corr);
    expect(t).toContain('P-0123-C1');
    expect(t).toContain('corrige la P-0123');
    expect(huella(orig)).not.toBe(huella(corr));
  });
  it('un nombre largo y muchas lineas paginan sin cortar ni fallar', async () => {
    const base = villa();
    const muchos = Array.from({ length: 70 }, (_, i) => ({ modelo: `Modelo de prueba ${i + 1}`, piezas: 20, subtotal_cent: 300000n, sabores: [{ sabor: `Sabor ${i + 1}`, piezas: 20, precio_cent: 15000n, total_cent: 300000n }] }));
    const bytes = await pdfNotaCliente({ ...base, cliente: { ...base.cliente, grupos: muchos } });
    const t = await textoDe(bytes);
    expect(t).toMatch(/Página 1 de [2-9]/);
    expect(t).toContain('Modelo de prueba 70');
  });
});

describe('simbolos que Geist no trae', () => {
  it('✓ ≥ → ★ salen como texto, no como signos de interrogacion', async () => {
    const { f } = await nuevoDocumento('prueba', '2026-11-10T18:00:00.000Z');
    expect(limpio(f.cuerpo, 'Listo ✓ cobrado ≥ 50 piezas → bodega ★ prioridad')).toBe('Listo OK cobrado >= 50 piezas -> bodega * prioridad');
    expect(limpio(f.cuerpo, 'Sandía, niño, año — 5 × 2 ± 1')).toBe('Sandía, niño, año — 5 × 2 ± 1');
  });
  it('lo que no tiene equivalente (emoji) sigue sin romper la generacion', async () => {
    const { f } = await nuevoDocumento('prueba', '2026-11-10T18:00:00.000Z');
    expect(limpio(f.cuerpo, 'A😀B')).toBe('A?B');
  });
  it('una nota con esos simbolos en su motivo llega al PDF como texto', async () => {
    const bytes = await pdfNotaCliente({ ...villa(), datos_pago_texto: 'Pago ≥ acordado ✓ → cuenta ★' });
    const t = await textoDe(bytes);
    expect(t).not.toContain('?');
    expect(t).toContain('Pago >= acordado OK -> cuenta *');
  });
});

describe('hoja interna', () => {
  it('lleva costo y utilidad (solo socios) y tambien es determinista', async () => {
    const a = await pdfHojaInterna(villa());
    expect(huella(a)).toBe(huella(await pdfHojaInterna(villa())));
    const t = await textoDe(a);
    expect(t).toContain('SOLO PARA SOCIOS');
    expect(t).toMatch(/Utilidad provisional/);
    expect(t).toContain('Sin costear');
  });
});
