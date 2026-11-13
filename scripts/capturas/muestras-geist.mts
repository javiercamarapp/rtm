// Muestras de los PDF para comparar tipografias: node --import tsx scripts/capturas/muestras-geist.mts <carpeta-salida>
// Genera nota de pedido (cliente y hoja interna), acta de corte, inventario y los reportes semanal/mensual (Chromium) con los datos ilustrativos de las pruebas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cascadaCalcular } from '@/dominio/dinero/reparto';
import type { Cascada, CierreReparto, NotaFuente } from '@/dominio/operacion/tipos';
import type { SnapshotInventario } from '@/dominio/inventario/tipos';
import { pdfActaCorte } from '@/infra/pdf/acta';
import { pdfInventario } from '@/infra/pdf/inventario';
import { pdfHojaInterna, pdfNotaCliente } from '@/infra/pdf/nota';
import { armarPaquete } from '@/dominio/reportes/paquete';
import { construirReporte } from '@/dominio/reportes/paginas';
import { renderHtml } from '@/dominio/reportes/html';
import { RenderizadorChromium } from '@/infra/reportes/render_pdf_chromium';
import { cargarCssFuentes } from '@/infra/reportes/fuentes_css';
import { insumosMensualDorado, insumosSemanalDorado } from '../../test/fixtures/reportes/datos';

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

function acta(): CierreReparto {
  const r = cascadaCalcular({
    utilidad: 1_727_900n, arrastre: 0n, caja: 2_000_000n, comprometido: 0n, reembolsos: { Angelo: 50_000n, Javier: 222_100n }, aportaciones: { Angelo: 0n, Javier: 0n },
    poder: { Angelo: 0n, Javier: 0n }, deuda: { Angelo: 0n, Javier: 0n }, anticipos: { Angelo: 0n, Javier: 0n }, ppm: { Angelo: 500_000n, Javier: 500_000n }, rotor: 0,
  });
  const socio = (k: 'Angelo' | 'Javier') => ({
    reembolso_pendiente_cent: r.porSocio[k]!.reembolsoPendiente, aportacion_pendiente_cent: 0n, paga_reembolso_cent: r.porSocio[k]!.pagaReembolso, utilidad_cent: r.porSocio[k]!.utilidad,
    anticipo_cent: 0n, asignado_cent: r.porSocio[k]!.asignado, tiene_en_poder_cent: 0n, debe_cent: 0n, resultado_cent: r.porSocio[k]!.resultado, sigue_pendiente_cent: 0n,
  });
  const snapshot = {
    periodo_ini: '2026-10-01', periodo_fin: '2026-10-31', utilidad_cent: r.utilidad, perdida_cent: 0n, utilidad_provisional: false, arrastre_ini_cent: 0n, arrastre_fin_cent: r.arrastreFin,
    utilidad_acumulada_cent: r.utilidad, efectivo: { en_poder_cent: 0n, caja_cent: 2_000_000n, total_cent: r.efectivoTotal, comprometido_cent: 0n, disponible_cent: r.disponible },
    reembolsos: { pendiente_cent: 272_100n, pagado_cent: r.pagadoReembolsos }, aportaciones: { pendiente_cent: 0n, pagado_cent: 0n }, repartible_cent: r.repartible, remanente_cent: r.remanente,
    limitado_por_efectivo: false, por_socio: { Angelo: socio('Angelo'), Javier: socio('Javier') }, suma_asignada_cent: r.sumaAsignada, suma_resultados_cent: r.sumaResultados, identidad_cuadra: true,
    identidad: { via1_cent: r.identidad.via1, via2_cent: r.identidad.via2, efectivo_repartido_cent: r.identidad.efectivoRepartido, deuda_no_efectivo_cent: 0n, cuadra: true }, liquidar: null,
    utilidad_detalle: { utilidad_pedidos_cent: 0n, pedidos: 0, utilidad_tomas_cent: 0n, gastos_cent: 0n, provisional: false, utilidad_cent: r.utilidad },
  } as unknown as Cascada;
  return {
    id: 1, folio: 'CR-0001', tipo: 'periodo', corrige_a: null, corregida: false, periodo_ini: '2026-10-01', periodo_fin: '2026-10-31', utilidad_cent: r.utilidad, utilidad_provisional: false,
    efectivo_caja_cent: 2_000_000n, nota: null, snapshot, decisiones: { Angelo: { retira: 863_950n, reinvierte: 0n }, Javier: { retira: 0n, reinvierte: 863_950n } },
    arrastre_ini_cent: 0n, arrastre_fin_cent: 0n, creado_at: '2026-11-01T18:00:00.000Z', propuesto_por: 'Angelo',
    firmas: [{ socio: 'Angelo', firmado_at: '2026-11-01T18:05:00.000Z' }, { socio: 'Javier', firmado_at: '2026-11-01T19:00:00.000Z' }], estado: 'cerrado', yo_firme: true,
  };
}


const PARAMS = { marca: null, modelo: null, solo_socios_venden: false, solo_disponibles: false, mostrar_cantidades: false, con_caladas: false, cliente_id: null };

function inventarioClientes(extra: Partial<SnapshotInventario['parametros']> = {}, conPrecio = false): SnapshotInventario {
  return {
    version: 'clientes', corte: '2026-11-11T16:00:00.000Z', hoy: '2026-11-11', parametros: { ...PARAMS, ...extra },
    modelos: [
      { marca: 'Marca Ilustrativa', modelo: 'Modelo Alfa 50K', puffs: 50000, disponible: true, cantidad: extra.mostrar_cantidades ? 42 : undefined, precio_cent: conPrecio ? 25000n : undefined,
        sabores: [{ sabor: 'Mango', disponible: true, cantidad: extra.mostrar_cantidades ? 30 : undefined }, { sabor: 'Uva', disponible: false, cantidad: extra.mostrar_cantidades ? 0 : undefined }] },
      { marca: 'Marca Ilustrativa', modelo: 'Modelo Beta 15K', puffs: 15000, disponible: false, sabores: [{ sabor: 'Sandía', disponible: false }] },
    ],
  };
}

function inventarioInterno(): SnapshotInventario {
  return {
    version: 'interna', corte: '2026-11-11T16:00:00.000Z', hoy: '2026-11-11', parametros: { ...PARAMS, mostrar_cantidades: true },
    modelos: [{ marca: 'Marca Ilustrativa', modelo: 'Modelo Alfa 50K', puffs: 50000, disponible: 40, piezas: 42, reservado: 2, valor_cent: 385000n, costo_prom_cent: 9166n, estado: 'buena', cobertura_dias: 24.5,
      sabores: [{ sabor: 'Mango', disponible: true, piezas: 30, valor_cent: 275000n, estado: 'excelente' }, { sabor: 'Uva', disponible: true, piezas: 12, valor_cent: 110000n, estado: 'urge' }] }],
    totales: { piezas: 42, valor_cent: 385000n, reservado: 2, modelos_con_existencia: 1 },
  };
}


const salida = process.argv[2];
if (!salida) throw new Error('uso: muestras-geist.mts <carpeta-salida>');
mkdirSync(salida, { recursive: true });
const guardar = (n: string, b: Uint8Array) => writeFileSync(join(salida, n), b);

guardar('nota-pedido.pdf', await pdfNotaCliente(villa()));
guardar('nota-correccion.pdf', await pdfNotaCliente(villa({ cliente: 'Peña Núñez & Hijos, S.A. — Ñandú', entrega: 'Envío: ¿recoge? «sí» · 100 % ✓' }, 'correccion')));
guardar('hoja-interna.pdf', await pdfHojaInterna(villa()));
guardar('inventario-clientes.pdf', await pdfInventario(inventarioClientes({ mostrar_cantidades: true }, true), 'INV-0001', 'a'.repeat(64)));
guardar('inventario-interno.pdf', await pdfInventario(inventarioInterno(), 'INV-0002', 'b'.repeat(64)));
guardar('acta.pdf', await pdfActaCorte(acta()));

const render = new RenderizadorChromium({ fecha14: '20261110000000' });
const css = cargarCssFuentes(join(process.cwd(), 'src', 'fuentes'));
guardar('reporte-semanal.pdf', (await render.renderizar(renderHtml(construirReporte(armarPaquete(insumosSemanalDorado())), { cssFuentes: css }))).bytes);
guardar('reporte-mensual.pdf', (await render.renderizar(renderHtml(construirReporte(armarPaquete(insumosMensualDorado())), { cssFuentes: css }))).bytes);
console.log('muestras en', salida);
