// Datos ILUSTRATIVOS del reporte dorado (spec 16, sec. 9). Ningun dato real: nombres de clientes y cifras inventadas, coherentes entre si.
// Semana del 2 al 8 de noviembre de 2026 (semana ISO 45). Las cifras de la maqueta A se reproducen exactas:
// ventas $463,900, 2,310 pz, mercancia $415,570, guias $7,098, renta $360, mensajeros $450, utilidad de contribucion $40,422.
import type { ConteoInsumo, FlujoInsumo, GastoInsumo, HistoriaCliente, InsumosMensual, InsumosSemanal, ModeloInventario, PartidaCartera, PedidoHistoria, PedidoInsumo, RenglonResultados, SemanaHistoria } from '@/dominio/reportes/insumos';
import { agregarPorModelo, contribucionModelo } from '@/dominio/reportes/puente';
import type { ResultadoComprobacion } from '@/dominio/reportes/tipos';

export const PEDIDOS_SEMANA: PedidoInsumo[] = [
  { folio: 'P-0120', fecha: '2026-11-02', clienteId: 'c1', cliente: 'Plaza Norte', origen: 'directo', cobradoCent: 4186400n, guiaCent: 76818n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 140, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'Waka Jupiter', piezas: 110, precioCent: 18800n, costoCent: 16800n },
  ] },
  { folio: 'P-0121', fecha: '2026-11-03', clienteId: 'c1', cliente: 'Plaza Norte', origen: 'directo', cobradoCent: 3489800n, guiaCent: 61454n, mensajeroCent: 15000n, lineas: [
    { modelo: 'Elux 50K', piezas: 130, precioCent: 19800n, costoCent: 17600n },
    { modelo: 'Icon', piezas: 70, precioCent: 21200n, costoCent: 19000n },
  ] },
  { folio: 'P-0122', fecha: '2026-11-04', clienteId: 'c2', cliente: 'Distribuidora Sur', origen: 'directo', cobradoCent: 3701400n, guiaCent: 67600n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 160, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'Blast', piezas: 60, precioCent: 18400n, costoCent: 16400n },
  ] },
  { folio: 'P-0123', fecha: '2026-11-05', clienteId: 'c2', cliente: 'Distribuidora Sur', origen: 'directo', cobradoCent: 3199200n, guiaCent: 58381n, mensajeroCent: 0n, lineas: [
    { modelo: 'Waka Jupiter', piezas: 150, precioCent: 18800n, costoCent: 16800n },
    { modelo: 'Geek Bar 2GO 50K', piezas: 40, precioCent: 22500n, costoCent: 20200n },
  ] },
  { folio: 'P-0124', fecha: '2026-11-06', clienteId: 'c3', cliente: 'Tienda Centro', origen: 'directo', cobradoCent: 2154300n, guiaCent: 39945n, mensajeroCent: 15000n, lineas: [
    { modelo: 'Elux 50K', piezas: 100, precioCent: 19800n, costoCent: 17600n },
    { modelo: 'Fasta Kit 40K', piezas: 30, precioCent: 17500n, costoCent: 15700n },
  ] },
  { folio: 'P-0125', fecha: '2026-11-07', clienteId: 'c3', cliente: 'Tienda Centro', origen: 'bodega', cobradoCent: 2125900n, guiaCent: 36872n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 60, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'Icon', piezas: 60, precioCent: 21200n, costoCent: 19000n },
  ] },
  { folio: 'P-0126', fecha: '2026-11-08', clienteId: 'c4', cliente: 'Mayoreo Costa', origen: 'directo', cobradoCent: 3047800n, guiaCent: 58381n, mensajeroCent: 0n, lineas: [
    { modelo: 'Waka Jupiter', piezas: 120, precioCent: 18800n, costoCent: 16800n },
    { modelo: 'Blast', piezas: 70, precioCent: 18400n, costoCent: 16400n },
  ] },
  { folio: 'P-0127', fecha: '2026-11-02', clienteId: 'c4', cliente: 'Mayoreo Costa', origen: 'directo', cobradoCent: 2813900n, guiaCent: 46090n, mensajeroCent: 15000n, lineas: [
    { modelo: 'Icon', piezas: 110, precioCent: 21200n, costoCent: 19000n },
    { modelo: 'IPLAY Box Pro Max 50K', piezas: 40, precioCent: 23500n, costoCent: 21000n },
  ] },
  { folio: 'P-0128', fecha: '2026-11-03', clienteId: 'c5', cliente: 'Vapes del Valle', origen: 'directo', cobradoCent: 2408000n, guiaCent: 43018n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 140, precioCent: 20000n, costoCent: 17800n },
  ] },
  { folio: 'P-0129', fecha: '2026-11-04', clienteId: 'c5', cliente: 'Vapes del Valle', origen: 'bodega', cobradoCent: 1021600n, guiaCent: 18436n, mensajeroCent: 0n, lineas: [
    { modelo: 'Elux 50K', piezas: 60, precioCent: 19800n, costoCent: 17600n },
  ] },
  { folio: 'P-0130', fecha: '2026-11-05', clienteId: 'c6', cliente: 'Punto Oriente', origen: 'directo', cobradoCent: 2180900n, guiaCent: 36872n, mensajeroCent: 0n, lineas: [
    { modelo: 'Geek Bar 2GO 50K', piezas: 80, precioCent: 22500n, costoCent: 20200n },
    { modelo: 'Blast', piezas: 40, precioCent: 18400n, costoCent: 16400n },
  ] },
  { folio: 'P-0131', fecha: '2026-11-06', clienteId: 'c6', cliente: 'Punto Oriente', origen: 'directo', cobradoCent: 1616800n, guiaCent: 30727n, mensajeroCent: 0n, lineas: [
    { modelo: 'Waka Jupiter', piezas: 100, precioCent: 18800n, costoCent: 16800n },
  ] },
  { folio: 'P-0132', fecha: '2026-11-07', clienteId: 'c7', cliente: 'Casa Poniente', origen: 'directo', cobradoCent: 2154300n, guiaCent: 36872n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 90, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'IPLAY Box Pro Max 50K', piezas: 30, precioCent: 23500n, costoCent: 21000n },
  ] },
  { folio: 'P-0133', fecha: '2026-11-08', clienteId: 'c7', cliente: 'Casa Poniente', origen: 'directo', cobradoCent: 5719700n, guiaCent: 98334n, mensajeroCent: 0n, lineas: [
    { modelo: 'Blast', piezas: 300, precioCent: 21100n, costoCent: 19400n },
    { modelo: 'Nexa 50K', piezas: 20, precioCent: 20400n, costoCent: 17700n },
  ] },
];
export const PEDIDOS_SEMANA_ANTERIOR: PedidoInsumo[] = [
  { folio: 'P-0105', fecha: '2026-10-26', clienteId: 'c1', cliente: 'Plaza Norte', origen: 'directo', cobradoCent: 4186400n, guiaCent: 70725n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 140, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'Waka Jupiter', piezas: 110, precioCent: 18800n, costoCent: 16800n },
  ] },
  { folio: 'P-0106', fecha: '2026-10-27', clienteId: 'c1', cliente: 'Plaza Norte', origen: 'directo', cobradoCent: 3489800n, guiaCent: 56580n, mensajeroCent: 20000n, lineas: [
    { modelo: 'Elux 50K', piezas: 130, precioCent: 19800n, costoCent: 17600n },
    { modelo: 'Icon', piezas: 70, precioCent: 21200n, costoCent: 17600n },
  ] },
  { folio: 'P-0107', fecha: '2026-10-28', clienteId: 'c2', cliente: 'Distribuidora Sur', origen: 'directo', cobradoCent: 3701400n, guiaCent: 62238n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 160, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'Blast', piezas: 60, precioCent: 18400n, costoCent: 16400n },
  ] },
  { folio: 'P-0108', fecha: '2026-10-29', clienteId: 'c2', cliente: 'Distribuidora Sur', origen: 'directo', cobradoCent: 3199200n, guiaCent: 53751n, mensajeroCent: 0n, lineas: [
    { modelo: 'Waka Jupiter', piezas: 150, precioCent: 18800n, costoCent: 16800n },
    { modelo: 'Geek Bar 2GO 50K', piezas: 40, precioCent: 22500n, costoCent: 20200n },
  ] },
  { folio: 'P-0109', fecha: '2026-10-30', clienteId: 'c3', cliente: 'Tienda Centro', origen: 'directo', cobradoCent: 2154300n, guiaCent: 36777n, mensajeroCent: 20000n, lineas: [
    { modelo: 'Elux 50K', piezas: 100, precioCent: 19800n, costoCent: 17600n },
    { modelo: 'Fasta Kit 40K', piezas: 30, precioCent: 17500n, costoCent: 15700n },
  ] },
  { folio: 'P-0110', fecha: '2026-10-31', clienteId: 'c3', cliente: 'Tienda Centro', origen: 'bodega', cobradoCent: 2125900n, guiaCent: 33948n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 60, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'Icon', piezas: 60, precioCent: 21200n, costoCent: 17600n },
  ] },
  { folio: 'P-0111', fecha: '2026-11-01', clienteId: 'c4', cliente: 'Mayoreo Costa', origen: 'directo', cobradoCent: 3047800n, guiaCent: 53751n, mensajeroCent: 0n, lineas: [
    { modelo: 'Waka Jupiter', piezas: 120, precioCent: 18800n, costoCent: 16800n },
    { modelo: 'Blast', piezas: 70, precioCent: 18400n, costoCent: 16400n },
  ] },
  { folio: 'P-0112', fecha: '2026-10-26', clienteId: 'c4', cliente: 'Mayoreo Costa', origen: 'directo', cobradoCent: 2813900n, guiaCent: 42435n, mensajeroCent: 20000n, lineas: [
    { modelo: 'Icon', piezas: 110, precioCent: 21200n, costoCent: 17600n },
    { modelo: 'IPLAY Box Pro Max 50K', piezas: 40, precioCent: 23500n, costoCent: 21000n },
  ] },
  { folio: 'P-0113', fecha: '2026-10-27', clienteId: 'c5', cliente: 'Vapes del Valle', origen: 'directo', cobradoCent: 2408000n, guiaCent: 39606n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 140, precioCent: 20000n, costoCent: 17800n },
  ] },
  { folio: 'P-0114', fecha: '2026-10-28', clienteId: 'c5', cliente: 'Vapes del Valle', origen: 'bodega', cobradoCent: 1021600n, guiaCent: 16974n, mensajeroCent: 0n, lineas: [
    { modelo: 'Elux 50K', piezas: 60, precioCent: 19800n, costoCent: 17600n },
  ] },
  { folio: 'P-0115', fecha: '2026-10-29', clienteId: 'c6', cliente: 'Punto Oriente', origen: 'directo', cobradoCent: 2180900n, guiaCent: 33948n, mensajeroCent: 0n, lineas: [
    { modelo: 'Geek Bar 2GO 50K', piezas: 80, precioCent: 22500n, costoCent: 20200n },
    { modelo: 'Blast', piezas: 40, precioCent: 18400n, costoCent: 16400n },
  ] },
  { folio: 'P-0116', fecha: '2026-10-30', clienteId: 'c6', cliente: 'Punto Oriente', origen: 'directo', cobradoCent: 1616800n, guiaCent: 28290n, mensajeroCent: 0n, lineas: [
    { modelo: 'Waka Jupiter', piezas: 100, precioCent: 18800n, costoCent: 16800n },
  ] },
  { folio: 'P-0117', fecha: '2026-10-31', clienteId: 'c7', cliente: 'Casa Poniente', origen: 'directo', cobradoCent: 2154300n, guiaCent: 33948n, mensajeroCent: 0n, lineas: [
    { modelo: 'Nexa 50K', piezas: 90, precioCent: 20000n, costoCent: 17800n },
    { modelo: 'IPLAY Box Pro Max 50K', piezas: 30, precioCent: 23500n, costoCent: 21000n },
  ] },
  { folio: 'P-0118', fecha: '2026-11-01', clienteId: 'c7', cliente: 'Casa Poniente', origen: 'directo', cobradoCent: 6971700n, guiaCent: 127029n, mensajeroCent: 0n, lineas: [
    { modelo: 'Blast', piezas: 409, precioCent: 18900n, costoCent: 17900n },
    { modelo: 'Nexa 50K', piezas: 40, precioCent: 23450n, costoCent: 17900n },
  ] },
];

const FIN = '2026-11-08';
const piezasDe = (p: PedidoInsumo) => p.lineas.reduce((a, l) => a + l.piezas, 0);
const ventasDe = (p: PedidoInsumo) => p.lineas.reduce((a, l) => a + l.precioCent * BigInt(l.piezas), 0n);
const sumarDias = (f: string, d: number): string => {
  const ms = Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10))) + d * 86_400_000;
  const x = new Date(ms);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};

// ---------- historia de 13 semanas (la ultima es la semana anterior, calculada de sus pedidos) ----------
const prevContrib = (() => {
  const ag = agregarPorModelo(PEDIDOS_SEMANA_ANTERIOR);
  return ag.reduce((a, m) => a + contribucionModelo(m), 0n);
})();
const prevVentas = PEDIDOS_SEMANA_ANTERIOR.reduce((a, p) => a + ventasDe(p), 0n);
const prevPiezas = PEDIDOS_SEMANA_ANTERIOR.reduce((a, p) => a + piezasDe(p), 0);
const contribs = [38200, 39500, 40100, 41300, 39800, 42000, 41500, 40900, 43800, 45100, 44200];
const ventasH = [410000, 421000, 425000, 436000, 428000, 441000, 439000, 433000, 440000, 446000, 450799];
const piezasH = [2230, 2290, 2310, 2360, 2330, 2400, 2390, 2350, 2420, 2440, 2425];
export const HISTORIA: SemanaHistoria[] = [
  ...contribs.map((c, i): SemanaHistoria => ({ inicio: sumarDias('2026-08-03', 7 * i), ventasCent: BigInt(ventasH[i]! * 100), piezas: piezasH[i]!, contribCent: BigInt(c * 100), cobradoCent: BigInt(Math.round(ventasH[i]! * 0.85) * 100) })),
  { inicio: '2026-10-26', ventasCent: prevVentas, piezas: prevPiezas, contribCent: prevContrib, cobradoCent: (prevVentas * 85n) / 100n },
  { inicio: '2026-11-02', ventasCent: 0n, piezas: 0, contribCent: 0n, cobradoCent: 0n },
].slice(0, 12) as SemanaHistoria[];

// ---------- clientes: 13 semanas de pedidos (la mas reciente sale de los pedidos reales de la semana) ----------
function historiaCliente(id: string, nombre: string, ventasPesos: readonly number[], precioPz: number, sabores: Readonly<Record<string, number>>, pedidosSemana: readonly PedidoInsumo[]): HistoriaCliente {
  const pedidos: PedidoHistoria[] = [];
  ventasPesos.forEach((v, k) => {
    if (v <= 0) return;
    const semanasAtras = ventasPesos.length - 1 - k;
    const fecha = sumarDias(FIN, -7 * semanasAtras - 2);
    const piezas = Math.round(v / precioPz);
    const reparto: Record<string, number> = {};
    let resto = piezas;
    const claves = Object.keys(sabores);
    claves.forEach((s, i) => {
      const n = i === claves.length - 1 ? resto : Math.round(piezas * sabores[s]!);
      reparto[s] = n;
      resto -= n;
    });
    pedidos.push({ fecha, piezas, ventasCent: BigInt(v * 100), contribCent: BigInt(Math.round(v * 0.09 * 100)), sabores: reparto });
  });
  const ult = pedidosSemana.filter((p) => p.clienteId === id);
  if (ult.length) {
    const piezas = ult.reduce((a, p) => a + piezasDe(p), 0);
    pedidos.push({ fecha: sumarDias(FIN, -2), piezas, ventasCent: ult.reduce((a, p) => a + ventasDe(p), 0n), contribCent: ult.reduce((a, p) => a + ventasDe(p) / 11n, 0n), sabores: { [Object.keys(sabores)[0]!]: piezas } });
  }
  return { clienteId: id, cliente: nombre, pedidos };
}
const SAB3 = { Sandía: 0.4, Mango: 0.35, 'Grape Ice': 0.25 };
const SAB3b = { Sandía: 0.55, Mango: 0.45, 'Grape Ice': 0 };
const PLAZA = [44000, 45000, 46000, 45000, 45000, 44000, 46000, 45000, 45000, 45000, 45000, 45000];
export const CLIENTES_HIST: HistoriaCliente[] = [
  { ...historiaCliente('c1', 'Plaza Norte', PLAZA, 200, SAB3, PEDIDOS_SEMANA), declarado: { ventasSemanaCent: 4_500_000n, rangoPct: 20 } },
  historiaCliente('c2', 'Distribuidora Sur', [60000, 62000, 61000, 63000, 58000, 60000, 59000, 61000, 20000, 18000, 21000, 19000], 200, { ...SAB3, 'Grape Ice': 0.25 }, PEDIDOS_SEMANA),
  historiaCliente('c3', 'Tienda Centro', [30000, 0, 28000, 0, 29000, 0, 31000, 0, 30000, 0, 29000, 0], 190, SAB3b, PEDIDOS_SEMANA),
  historiaCliente('c4', 'Mayoreo Costa', [40000, 42000, 41000, 40000, 43000, 41000, 40000, 42000, 41000, 40000, 42000, 41000], 200, SAB3, PEDIDOS_SEMANA),
  historiaCliente('c5', 'Vapes del Valle', [25000, 0, 0, 26000, 0, 0, 24000, 0, 0, 25000, 0, 0], 195, SAB3b, PEDIDOS_SEMANA),
  historiaCliente('c6', 'Punto Oriente', [32000, 33000, 31000, 32000, 34000, 33000, 31000, 32000, 33000, 32000, 31000, 33000], 200, SAB3, PEDIDOS_SEMANA),
  { ...historiaCliente('c7', 'Casa Poniente', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 200, SAB3, PEDIDOS_SEMANA) },
];

// ---------- inventario: 8 modelos ----------
const sabs = (a: number, b: number, c: number, vendidas: [number, number, number]): ModeloInventario['sabores'] => [
  { sabor: 'Sandía', existencia: a, vendidas28: vendidas[0], diasAgotado: 0 },
  { sabor: 'Mango', existencia: b, vendidas28: vendidas[1], diasAgotado: 0 },
  { sabor: 'Grape Ice', existencia: c, vendidas28: vendidas[2], diasAgotado: c === 0 ? 9 : 0 },
];
const LT = { dias: 7, reposiciones: 5, declarado: false };
export const INVENTARIO: ModeloInventario[] = [
  { modelo: 'Nexa 50K', existencia: 312, enTransito: 0, costoPromCent: 17800n, ventasSemanales: [340, 360, 370, 355, 365, 360, 372, 368], contribPorPiezaCent: 1800n, diasSinVenta: 0, proveedor: 'Isaac', costoReposicionCent: 17800n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(120, 150, 42, [300, 310, 280]) },
  { modelo: 'Waka Jupiter', existencia: 480, enTransito: 0, costoPromCent: 16800n, ventasSemanales: [300, 310, 305, 298, 312, 308, 303, 309], contribPorPiezaCent: 900n, diasSinVenta: 0, proveedor: 'Isaac', costoReposicionCent: 16800n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(160, 160, 160, [100, 105, 100]), revisar: { semanasSeguidas: 3, rotacionMilesimas: 2300n } },
  { modelo: 'Elux 50K', existencia: 1200, enTransito: 0, costoPromCent: 17600n, ventasSemanales: [350, 340, 355, 349, 351, 346, 352, 347], contribPorPiezaCent: 1300n, diasSinVenta: 0, proveedor: 'Isaac', costoReposicionCent: 17600n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(400, 400, 400, [120, 115, 110]) },
  { modelo: 'Fasta Kit 40K', existencia: 565, enTransito: 0, costoPromCent: 15700n, ventasSemanales: [30, 35, 28, 32, 0, 0, 0, 0], contribPorPiezaCent: 1200n, diasSinVenta: 21, proveedor: 'Isaac', costoReposicionCent: 15700n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(190, 190, 185, [10, 12, 8]) },
  { modelo: 'Icon', existencia: 300, enTransito: 0, costoPromCent: 19000n, ventasSemanales: [200, 210, 190, 205, 198, 202, 207, 199], contribPorPiezaCent: 1100n, diasSinVenta: 0, proveedor: 'Isaac', costoReposicionCent: 19000n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(100, 100, 100, [70, 65, 68]), cambioCosto: { anteriorCent: 17600n, nuevoCent: 19000n, clientesAlMismoPrecio: 3 }, contribMedianaPorPiezaCent: 2600n },
  { modelo: 'Blast', existencia: 350, enTransito: 0, costoPromCent: 16400n, ventasSemanales: [180, 175, 185, 182, 178, 181, 179, 180], contribPorPiezaCent: 1500n, diasSinVenta: 0, proveedor: 'Isaac', costoReposicionCent: 16400n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(120, 120, 110, [60, 62, 58]) },
  { modelo: 'Geek Bar 2GO 50K', existencia: 260, enTransito: 0, costoPromCent: 20200n, ventasSemanales: [90, 95, 92, 88, 94, 91, 93, 90], contribPorPiezaCent: 1700n, diasSinVenta: 0, proveedor: 'Karen', costoReposicionCent: 19500n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(90, 90, 80, [30, 31, 29]) },
  { modelo: 'IPLAY Box Pro Max 50K', existencia: 210, enTransito: 0, costoPromCent: 21000n, ventasSemanales: [60, 65, 62, 58, 64, 61, 63, 60], contribPorPiezaCent: 1500n, diasSinVenta: 0, proveedor: 'Karen', costoReposicionCent: 20500n, leadTime: LT, piezasPorCaja: 150, sabores: sabs(70, 70, 70, [20, 22, 21]) },
];

export const CARTERA: PartidaCartera[] = [
  { clienteId: 'c1', cliente: 'Plaza Norte', saldoCent: 2_150_000n, dias: 38, ticketMedianoCent: 4_500_000n, pagosMasLentos: true, pedidosHistoria: 13 },
  { clienteId: 'c5', cliente: 'Vapes del Valle', saldoCent: 1_884_800n, dias: 45, ticketMedianoCent: 2_500_000n, pagosMasLentos: false, pedidosHistoria: 4 },
  { clienteId: 'c2', cliente: 'Distribuidora Sur', saldoCent: 6_500_000n, dias: 12, ticketMedianoCent: 6_000_000n, pagosMasLentos: false, pedidosHistoria: 13 },
  { clienteId: 'c3', cliente: 'Tienda Centro', saldoCent: 3_805_200n, dias: 5, ticketMedianoCent: 3_000_000n, pagosMasLentos: false, pedidosHistoria: 7 },
  { clienteId: 'c4', cliente: 'Mayoreo Costa', saldoCent: 4_000_000n, dias: 22, ticketMedianoCent: 4_100_000n, pagosMasLentos: false, pedidosHistoria: 13 },
];

export const GASTOS: GastoInsumo[] = [
  { concepto: 'Renta de bodega (180 pz x $2)', categoria: 'variable', plataforma: false, montoCent: 36_000n, pagadoPor: 'Sociedad' },
  { concepto: 'Guías de salida', categoria: 'variable', plataforma: false, montoCent: 709_800n, pagadoPor: 'Angelo' },
  { concepto: 'Mensajeros', categoria: 'variable', plataforma: false, montoCent: 45_000n, pagadoPor: 'Javier' },
  { concepto: 'Comisión de terminal', categoria: 'variable', plataforma: false, montoCent: 12_000n, pagadoPor: 'Angelo' },
  { concepto: 'Vercel (cuota semanal)', categoria: 'fijo', plataforma: true, montoCent: 40_000n, pagadoPor: 'Javier' },
  { concepto: 'Supabase (cuota semanal)', categoria: 'fijo', plataforma: true, montoCent: 50_000n, pagadoPor: 'Javier' },
  { concepto: 'IA', categoria: 'fijo', plataforma: true, montoCent: 12_000n, pagadoPor: 'Javier' },
  { concepto: 'Dominio (un doceavo)', categoria: 'fijo', plataforma: false, montoCent: 2_000n, pagadoPor: 'Javier' },
];

export const CONTEO: ConteoInsumo = { lineasTotal: 44, lineasCuadran: 41, piezasPuente: 12, valorPuenteCent: 109_855n };

export const FLUJO: FlujoInsumo = {
  saldoInicialCent: 30_000_000n,
  cobrosSemanalesCent: [34_000_000n, 36_500_000n, 35_000_000n, 38_000_000n, 37_000_000n, 36_000_000n, 39_000_000n, 39_820_000n, 38_500_000n, 37_500_000n],
  cobrosPrometidosCent: [20_000_000n, 15_000_000n, 0n, 0n],
  pagosProveedorCent: [42_266_800n, 41_000_000n, 41_000_000n, 41_000_000n],
  omarCent: [44_000n, 44_000n, 44_000n, 44_000n],
  gastosCent: [800_000n, 800_000n, 800_000n, 800_000n],
};

export function comprobacionesVerdes(): ResultadoComprobacion[] {
  const nombres = ['Nota de venta cuadra', 'Fuga de piezas', 'Balanza en cero', 'Auxiliares = control', 'Valuación del inventario', 'Pagos aplicados', 'Saldo del proveedor', 'Saldo de Omar', 'Saldo entre socios', 'Asientos cuadrados', 'Periodo cerrado sin asientos nuevos', 'Pedidos a libro', 'Desglose por cliente', 'Gastos contra cuentas'];
  const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12', 'C14', 'C22'];
  return ids.map((id, i) => ({ id, nombre: nombres[i]!, via1: 1n, via2: 1n, ok: true }));
}

export function insumosSemanalDorado(sobre: Partial<InsumosSemanal> = {}): InsumosSemanal {
  return {
    inicio: '2026-11-02',
    fin: '2026-11-08',
    corteIso: '2026-11-09T11:59:00Z',
    aprobadoEn: '2026-11-09',
    enCurso: false,
    datosIncompletos: [],
    semanaIso: 45,
    anio: 2026,
    pedidos: PEDIDOS_SEMANA,
    pedidosSemanaAnterior: PEDIDOS_SEMANA_ANTERIOR,
    historia: HISTORIA,
    clientes: CLIENTES_HIST,
    inventario: INVENTARIO,
    cartera: CARTERA,
    liquidacion: { proveedor: 'Isaac', mercanciaCent: 41_557_000n, guiasCent: 709_800n, pagadoCent: 0n, segunProveedorCent: 42_266_800n, fondosDisponiblesCent: 30_000_000n, cobrosEsperadosHastaViernesCent: 24_950_000n },
    gastos: GASTOS,
    conteo: CONTEO,
    socios: { diferenciaCent: 930_750n, diferenciaAnteriorCent: 1_430_750n, omarNetoCent: -26_000n, omarRentaCent: 44_000n, omarTomasCent: 70_000n, omarPagosCent: 0n, omarTomaPendienteHoras: 20 },
    comparacionProveedores: [
      { modelo: 'Elux 50K', costoIsaacCent: 17_600n, costoKarenCent: 16_800n, pedidosCaroSinCausa: 2, piezasCaroSinCausa: 190, guiaPorPiezaCent: 380n },
      { modelo: 'Nexa 50K', costoIsaacCent: 17_800n, costoKarenCent: 18_100n, pedidosCaroSinCausa: 0, piezasCaroSinCausa: 0, guiaPorPiezaCent: 380n },
      { modelo: 'Blast', costoIsaacCent: 16_400n, costoKarenCent: 16_900n, pedidosCaroSinCausa: 0, piezasCaroSinCausa: 0, guiaPorPiezaCent: 380n },
    ],
    flujo: FLUJO,
    comprobaciones: comprobacionesVerdes(),
    plataforma: { topeCent: 54_000n, gastoCent: 12_000n },
    gastoVariablePorPiezaMedianaCent: 330n,
    ...sobre,
  };
}

// ---------- mensual: octubre 2026 ----------
const reetiquetar = (ps: readonly PedidoInsumo[], mes: string, pref: string): PedidoInsumo[] => ps.map((p, i) => ({ ...p, folio: `${pref}-${p.folio.slice(2)}`, fecha: `${mes}-${String(3 + (i % 25)).padStart(2, '0')}` }));
export const PEDIDOS_OCTUBRE: PedidoInsumo[] = [...reetiquetar(PEDIDOS_SEMANA_ANTERIOR, '2026-10', 'PO'), ...reetiquetar(PEDIDOS_SEMANA, '2026-10', 'PQ')];
export const PEDIDOS_SEPTIEMBRE: PedidoInsumo[] = [...reetiquetar(PEDIDOS_SEMANA_ANTERIOR, '2026-09', 'PS'), ...reetiquetar(PEDIDOS_SEMANA_ANTERIOR, '2026-09', 'PT')];

function resultadosOctubre(): { renglones: RenglonResultados[]; utilidadNeta: bigint } {
  const ag = agregarPorModelo(PEDIDOS_OCTUBRE);
  const agPrev = agregarPorModelo(PEDIDOS_SEPTIEMBRE);
  const suma = (a: typeof ag, f: (m: (typeof ag)[number]) => bigint) => a.reduce((s, m) => s + f(m), 0n);
  const hoja = (id: string, etiqueta: string, cuenta: string, f: (m: (typeof ag)[number]) => bigint, signo: 1 | -1): RenglonResultados => ({ id, etiqueta, cuenta, montoCent: suma(ag, f), mesAnteriorCent: suma(agPrev, f), medianaTresMesesCent: (suma(ag, f) + suma(agPrev, f)) / 2n, subtotal: false, signo });
  const fijos = (id: string, etiqueta: string, cuenta: string, monto: bigint): RenglonResultados => ({ id, etiqueta, cuenta, montoCent: monto, mesAnteriorCent: monto, medianaTresMesesCent: monto, subtotal: false, signo: -1 });
  const hojas: RenglonResultados[] = [
    hoja('ventas', 'Ventas netas', '4110', (m) => m.ventaCent, 1),
    hoja('costo', 'Costo de mercancía vendida', '5100', (m) => m.costoCent, -1),
    hoja('guias', 'Guías de salida', '6120', (m) => m.guiaCent, -1),
    hoja('otros', 'Renta de bodega y mensajeros', '6110', (m) => m.otrosCent, -1),
    fijos('software', 'Software y nube', '6210', 360_000n),
    fijos('ia', 'IA', '6220', 54_000n),
    fijos('sistema', 'Costos de mantenimiento del sistema', '6290', 120_000n),
  ];
  const subt = (id: string, etiqueta: string, despuesDe: string[]): RenglonResultados => {
    const base = hojas.filter((h) => despuesDe.includes(h.id));
    const f = (g: (h: RenglonResultados) => bigint) => base.reduce((s, h) => s + BigInt(h.signo) * g(h), 0n);
    return { id, etiqueta, cuenta: '', montoCent: f((h) => h.montoCent), mesAnteriorCent: f((h) => h.mesAnteriorCent), medianaTresMesesCent: f((h) => h.medianaTresMesesCent), subtotal: true, signo: 1 };
  };
  const renglones = [hojas[0]!, hojas[1]!, subt('bruta', 'Utilidad bruta', ['ventas', 'costo']), hojas[2]!, hojas[3]!, subt('contribucion', 'Margen de contribución', ['ventas', 'costo', 'guias', 'otros']), hojas[4]!, hojas[5]!, hojas[6]!, subt('neta', 'Utilidad neta', ['ventas', 'costo', 'guias', 'otros', 'software', 'ia', 'sistema'])];
  return { renglones, utilidadNeta: renglones[renglones.length - 1]!.montoCent };
}

export function insumosMensualDorado(sobre: Partial<InsumosMensual> = {}): InsumosMensual {
  const { renglones, utilidadNeta } = resultadosOctubre();
  const sem = insumosSemanalDorado();
  const base: InsumosMensual = {
    ...sem,
    mes: '2026-10',
    inicio: '2026-10-01',
    fin: '2026-10-31',
    corteIso: '2026-11-01T12:15:00Z',
    aprobadoEn: '2026-11-01',
    semanaIso: 0,
    pedidos: PEDIDOS_OCTUBRE,
    pedidosSemanaAnterior: PEDIDOS_SEPTIEMBRE,
    mesAnterior: PEDIDOS_SEPTIEMBRE,
    resultados: renglones,
    utilidadNetaCent: utilidadNeta,
    costosSistema: { cargoSociedadCent: 120_000n, comoSeriaCent: 118_000n, comoDeberiaSerCent: 120_000n, bolsilloJavierCent: 27_000n, reembolsadoCent: 40_000n, pendienteCent: 80_000n },
    ventasMensualesCent: Array.from({ length: 12 }, (_, i) => BigInt(1_700_000 + i * 35_000) * 100n),
    clienteSabor: [
      { cliente: 'Plaza Norte', sabor: 'Sandía', piezas: 360 },
      { cliente: 'Plaza Norte', sabor: 'Mango', piezas: 315 },
      { cliente: 'Plaza Norte', sabor: 'Grape Ice', piezas: 225 },
      { cliente: 'Mayoreo Costa', sabor: 'Sandía', piezas: 330 },
      { cliente: 'Mayoreo Costa', sabor: 'Mango', piezas: 250 },
      { cliente: 'Mayoreo Costa', sabor: 'Grape Ice', piezas: 180 },
    ],
    rankSemanalClientes: [
      { cliente: 'Plaza Norte', rank: [1, 1, 2, 1, 1, 1, 2, 1] },
      { cliente: 'Mayoreo Costa', rank: [2, 3, 1, 2, 3, 2, 1, 2] },
      { cliente: 'Punto Oriente', rank: [3, 2, 3, 3, 2, 3, 3, 3] },
    ],
    dsoDias: 21,
    tendenciaCarteraBp: [1500n, 1700n, 1600n, 1900n, 2000n, 2100n, 2200n, 2200n],
  };
  return { ...base, ...sobre };
}
