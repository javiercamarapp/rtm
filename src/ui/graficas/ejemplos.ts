// Datos ILUSTRATIVOS para el catalogo /diseno/graficas y las pruebas. No son datos reales: ningun nombre de cliente, de proveedor ni cifra del negocio.
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { DatoBarraDelta, PuntoLinea, PasoCascadaVista, DatoPareto, PuntoBurbuja, NodoTreemap, SerieRadar, SerieBump, FilaAntiguedad, FilaCobertura, UmbralCobertura, CeldaCalor } from './index';

const m = (pesos: number): string => formatearMoneda(BigInt(pesos) * 100n);
const mc = (pesos: number): string => formatearMoneda(BigInt(pesos) * 100n, { conSigno: true });
const pz = (n: number): string => formatearPiezas(n);

export const EJ_BARRAS: DatoBarraDelta[] = [
  { id: 'a', etiqueta: 'Modelo A', valor: 420, texto: pz(420), delta: { texto: '+12 %', sentido: 'sube' }, destacado: true },
  { id: 'b', etiqueta: 'Modelo B', valor: 310, texto: pz(310), delta: { texto: '−4 %', sentido: 'baja' } },
  { id: 'c', etiqueta: 'Modelo C', valor: 265, texto: pz(265), delta: { texto: '0 %', sentido: 'igual' } },
  { id: 'd', etiqueta: 'Modelo D', valor: 190, texto: pz(190), delta: { texto: '+30 %', sentido: 'sube' } },
  { id: 'e', etiqueta: 'Modelo E', valor: 96, texto: pz(96), delta: { texto: '−18 %', sentido: 'baja' } },
];

export const EJ_LINEA: PuntoLinea[] = [
  { id: 's1', etiqueta: 'S1', valor: 41, texto: pz(41) },
  { id: 's2', etiqueta: 'S2', valor: 46, texto: pz(46) },
  { id: 's3', etiqueta: 'S3', valor: 44, texto: pz(44) },
  { id: 's4', etiqueta: 'S4', valor: 58, texto: pz(58) },
  { id: 's5', etiqueta: 'S5', valor: 39, texto: pz(39) },
  { id: 's6', etiqueta: 'S6', valor: 52, texto: pz(52) },
  { id: 's7', etiqueta: 'S7', valor: 61, texto: pz(61), tipo: 'observado' },
  { id: 's8', etiqueta: 'S8', valor: 64, texto: `${pz(64)} (est.)`, tipo: 'estimado', bajo: 55, alto: 73 },
  { id: 's9', etiqueta: 'S9', valor: 66, texto: `${pz(66)} (est.)`, tipo: 'estimado', bajo: 54, alto: 78 },
  { id: 's10', etiqueta: 'S10', valor: 67, texto: `${pz(67)} (est.)`, tipo: 'estimado', bajo: 52, alto: 82 },
];

export const EJ_CASCADA: PasoCascadaVista[] = [
  { id: 'venta', etiqueta: 'Venta', valor: 12000, texto: m(12000), tipo: 'inicio' },
  { id: 'desc', etiqueta: 'Descuento', valor: -500, texto: mc(-500), tipo: 'delta' },
  { id: 'costo', etiqueta: 'Costo', valor: -7800, texto: mc(-7800), tipo: 'delta' },
  { id: 'renta', etiqueta: 'Renta', valor: -400, texto: mc(-400), tipo: 'delta' },
  { id: 'guia', etiqueta: 'Guía de envío', valor: -300, texto: mc(-300), tipo: 'delta' },
  { id: 'util', etiqueta: 'Utilidad', valor: 3000, texto: m(3000), tipo: 'total' },
];

export const EJ_PARETO: DatoPareto[] = [
  { id: 'c1', etiqueta: 'Cliente 1', valor: 9200, texto: m(9200) },
  { id: 'c2', etiqueta: 'Cliente 2', valor: 6100, texto: m(6100) },
  { id: 'c3', etiqueta: 'Cliente 3', valor: 4300, texto: m(4300) },
  { id: 'c4', etiqueta: 'Cliente 4', valor: 2100, texto: m(2100) },
  { id: 'c5', etiqueta: 'Cliente 5', valor: 1500, texto: m(1500) },
  { id: 'c6', etiqueta: 'Cliente 6', valor: 900, texto: m(900) },
  { id: 'c7', etiqueta: 'Cliente 7', valor: 400, texto: m(400) },
];

export const EJ_CALOR_FILAS = ['Modelo A', 'Modelo B', 'Modelo C', 'Modelo D'];
export const EJ_CALOR_COLUMNAS = ['Sabor 1', 'Sabor 2', 'Sabor 3', 'Sabor 4', 'Sabor 5'];
const c = (n: number): CeldaCalor => ({ valor: n, texto: String(n) });
export const EJ_CALOR: Array<Array<CeldaCalor | null>> = [
  [c(48), c(31), c(12), c(5), c(22)],
  [c(20), c(44), c(27), null, c(9)],
  [c(8), c(15), c(36), c(41), c(3)],
  [c(0), c(6), c(11), c(18), c(26)],
];

export const EJ_GRUPOS_BURBUJA = ['Estrella', 'Vaca', 'Nicho', 'Revisar'];
export const EJ_BURBUJAS: PuntoBurbuja[] = [
  { id: 'a', etiqueta: 'Modelo A', x: 420, y: 38, tamano: 12600, textoX: pz(420), textoY: '38 %', textoTamano: m(12600), grupo: 'Estrella' },
  { id: 'b', etiqueta: 'Modelo B', x: 380, y: 14, tamano: 8200, textoX: pz(380), textoY: '14 %', textoTamano: m(8200), grupo: 'Vaca' },
  { id: 'c', etiqueta: 'Modelo C', x: 90, y: 44, tamano: 2400, textoX: pz(90), textoY: '44 %', textoTamano: m(2400), grupo: 'Nicho' },
  { id: 'd', etiqueta: 'Modelo D', x: 70, y: 9, tamano: 900, textoX: pz(70), textoY: '9 %', textoTamano: m(900), grupo: 'Revisar' },
  { id: 'e', etiqueta: 'Modelo E', x: 240, y: 27, tamano: 5100, textoX: pz(240), textoY: '27 %', textoTamano: m(5100), grupo: 'Estrella' },
];

export const EJ_TREEMAP_GRUPOS = ['Fijo', 'Variable'];
export const EJ_TREEMAP: NodoTreemap[] = [
  { id: 'renta', etiqueta: 'Renta de bodega', valor: 8000, texto: m(8000), grupo: 'Fijo' },
  { id: 'plataforma', etiqueta: 'Plataforma', valor: 1800, texto: m(1800), grupo: 'Fijo' },
  { id: 'envios', etiqueta: 'Envíos', valor: 6200, texto: m(6200), grupo: 'Variable' },
  { id: 'empaque', etiqueta: 'Empaque', valor: 2100, texto: m(2100), grupo: 'Variable' },
  { id: 'comision', etiqueta: 'Comisiones', valor: 3400, texto: m(3400), grupo: 'Variable' },
  { id: 'varios', etiqueta: 'Varios', valor: 900, texto: m(900), grupo: 'Variable' },
];

export const EJ_RADAR_EJES = ['Marca A', 'Marca B', 'Marca C', 'Marca D', 'Marca E', 'Marca F', 'Marca G', 'Marca H'];
export const EJ_RADAR: SerieRadar[] = [
  { id: 'cliente', etiqueta: 'Este cliente', valores: [60, 20, 45, 10, 35, 5, 25, 15], textos: ['60 %', '20 %', '45 %', '10 %', '35 %', '5 %', '25 %', '15 %'] },
  { id: 'promedio', etiqueta: 'Promedio', valores: [30, 25, 30, 20, 30, 15, 20, 20], textos: ['30 %', '25 %', '30 %', '20 %', '30 %', '15 %', '20 %', '20 %'] },
];

export const EJ_BUMP_PERIODOS = ['Ago', 'Sep', 'Oct', 'Nov'];
export const EJ_BUMP: SerieBump[] = [
  { id: 'c1', etiqueta: 'Cliente 1', posiciones: [1, 1, 2, 1], destacada: true },
  { id: 'c2', etiqueta: 'Cliente 2', posiciones: [2, 3, 1, 2] },
  { id: 'c3', etiqueta: 'Cliente 3', posiciones: [3, 2, 3, 4] },
  { id: 'c4', etiqueta: 'Cliente 4', posiciones: [4, 4, 4, 3] },
];

export const EJ_SPARK = { etiquetas: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], valores: [12, 14, 13, 18, 16, 21, 19, 24], textos: [12, 14, 13, 18, 16, 21, 19, 24].map(pz) };

const f = (id: string, etiqueta: string, v: [number, number, number, number]): FilaAntiguedad => ({ id, etiqueta, valores: v, textos: v.map(m), total: m(v.reduce((s, x) => s + x, 0)) });
export const EJ_ANTIGUEDAD: FilaAntiguedad[] = [
  f('c1', 'Cliente 1', [4200, 1800, 600, 0]),
  f('c2', 'Cliente 2', [1500, 2200, 1900, 800]),
  f('c3', 'Cliente 3', [0, 900, 0, 2400]),
  f('c4', 'Cliente 4', [2600, 0, 0, 0]),
];

export const EJ_COBERTURA: FilaCobertura[] = [
  { id: 'a', etiqueta: 'Modelo A', dias: 6, textoDias: '6 d', estado: 'urge' },
  { id: 'b', etiqueta: 'Modelo B', dias: 10, textoDias: '10 d', estado: 'brevedad' },
  { id: 'c', etiqueta: 'Modelo C', dias: 20, textoDias: '20 d', estado: 'siguiente' },
  { id: 'd', etiqueta: 'Modelo D', dias: 33, textoDias: '33 d', estado: 'excelente' },
  { id: 'e', etiqueta: 'Modelo E', dias: 120, textoDias: '120 d', estado: 'sobrestock' },
  { id: 'f', etiqueta: 'Modelo F', dias: null, textoDias: '', estado: 'sin_historia' },
];
export const EJ_UMBRALES: UmbralCobertura[] = [
  { id: 'lt', etiqueta: 'Tiempo de entrega', dias: 7 },
  { id: 'ciclo', etiqueta: 'Siguiente pedido', dias: 14 },
  { id: 'obj', etiqueta: 'Objetivo', dias: 28 },
];
