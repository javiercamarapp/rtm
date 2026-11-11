// Paquete de cifras (spec 16, 2.1): JSON inmutable del que leen graficas, tablas, titulares e insights. Cada cifra nace con su
// comprobacion por dos vias; nada se calcula al dibujar. El paquete se arma de insumos (puertos) y de un reloj inyectado; es determinista.
import { etiquetaFechaHora } from '../formato';
import { LibroCifras } from './cifras';
import { decidirEstado } from './estado';
import { pesosEnteros } from './formato';
import type { InsumosMensual, InsumosSemanal, PedidoInsumo } from './insumos';
import { type Contexto, type ResultadoInsights, contribPedido, crearContexto, evaluarInsights, slug } from './insights';
import { PARAMETROS } from './parametros';
import { type DatosFlujo, coberturaViernes, escenarioConcentracion, escenarioCosto, escenarioMezcla, escenarioRetrasoCobro, estacionalidad, flujoCaja, promedioMovilExponencial, puntoReorden, tendenciaLineal } from './proyecciones';
import { type AgregadoModelo, type Puente, agregarPorModelo, calcularPuente, contribucionModelo, puenteCuadra } from './puente';
import type { Cifra, CeldaTabla, DecisionEstado, Periodicidad, PeriodoReporte, ResultadoComprobacion, Tabla } from './tipos';
import { bp, cmpTexto, jsonCanonico, medianaNum, sha256Hex, sumaBig } from './util';

export interface ItemPareto {
  readonly id: string;
  readonly etiqueta: string;
  readonly valorCent: bigint;
  readonly pctAcumBp: bigint;
}
export interface FilaCobertura {
  readonly modelo: string;
  readonly dias: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  readonly existencia: number;
  readonly sinVentaDias: number;
}
export interface CubetaAntiguedad {
  readonly id: string;
  readonly etiqueta: string;
  readonly montoCent: bigint;
}
export interface SegmentoGasto {
  readonly id: string;
  readonly etiqueta: string;
  readonly montoCent: bigint;
}
export interface PasoCascada {
  readonly id: string;
  readonly etiqueta: string;
  readonly montoCent: bigint;
  readonly subtotal: boolean;
  readonly signo: 1 | -1;
}
export interface CeldaCalor {
  readonly fila: string;
  readonly col: string;
  readonly piezas: number;
  readonly pctFilaBp: bigint;
}
export interface BurbujaModelo {
  readonly modelo: string;
  readonly contribPzCent: bigint;
  readonly rotacionMilesimas: bigint;
  readonly contribTotalCent: bigint;
  readonly cuadrante: 'Estrella' | 'Vaca' | 'Revisar' | 'Cola';
}
export interface Mancuerna {
  readonly modelo: string;
  readonly costoIsaacCent: bigint;
  readonly costoKarenCent: bigint;
}
export interface PuntoTendencia {
  readonly h: number;
  readonly centralCent: bigint;
  readonly loCent: bigint;
  readonly hiCent: bigint;
}
export interface BarraTornado {
  readonly id: string;
  readonly etiqueta: string;
  readonly deltaCent: bigint;
}

export interface GraficasPaquete {
  readonly puente: Puente | null;
  readonly pareto: { readonly items: readonly ItemPareto[]; readonly totalCent: bigint } | null;
  readonly cobertura: readonly FilaCobertura[];
  readonly antiguedad: readonly CubetaAntiguedad[];
  readonly flujo: DatosFlujo | null;
  readonly gastos: { readonly segmentos: readonly SegmentoGasto[]; readonly plataforma: { readonly gastoCent: bigint; readonly topeCent: bigint } | null };
  readonly socios: { readonly pasos: readonly { readonly etiqueta: string; readonly deltaCent: bigint }[]; readonly diferenciaCent: bigint } | null;
  readonly cascada: readonly PasoCascada[];
  readonly calor: { readonly filas: readonly string[]; readonly cols: readonly string[]; readonly celdas: readonly CeldaCalor[] } | null;
  readonly bump: { readonly periodos: number; readonly series: readonly { readonly cliente: string; readonly rank: readonly number[] }[] } | null;
  readonly burbujas: { readonly puntos: readonly BurbujaModelo[]; readonly medianaContribPzCent: bigint; readonly medianaRotacionMilesimas: bigint } | null;
  readonly mancuernas: readonly Mancuerna[];
  readonly tendencia: { readonly observados: readonly bigint[]; readonly proyectados: readonly PuntoTendencia[]; readonly metodo: string; readonly ventanaN: number } | null;
  readonly tornado: readonly BarraTornado[];
  readonly tendenciaCartera: readonly bigint[];
}

export interface Paquete {
  readonly version: 1;
  readonly tipo: Periodicidad;
  readonly periodo: PeriodoReporte;
  readonly corteIso: string;
  readonly corteEtiqueta: string;
  readonly cifras: readonly Cifra[];
  readonly comprobaciones: readonly ResultadoComprobacion[];
  readonly estado: DecisionEstado;
  readonly tablas: Readonly<Record<string, Tabla>>;
  readonly graficas: GraficasPaquete;
  readonly insights: ResultadoInsights;
  readonly nombres: readonly string[];
  readonly proyeccionNota: readonly string[];
  readonly huella: string;
}

export function cifraDe(p: Paquete, id: string): Cifra | undefined {
  return p.cifras.find((c) => c.id === id);
}

const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
const dia = (f: string) => Number(f.slice(8, 10));
const mesNum = (f: string) => Number(f.slice(5, 7));

export function etiquetaPeriodoSemanal(inicio: string, fin: string): string {
  const a = mesNum(inicio);
  const b = mesNum(fin);
  const y = fin.slice(0, 4);
  return a === b ? `${dia(inicio)} al ${dia(fin)} de ${MESES_LARGO[b - 1]} de ${y}` : `${dia(inicio)} de ${MESES_LARGO[a - 1]} al ${dia(fin)} de ${MESES_LARGO[b - 1]} de ${y}`;
}
export const etiquetaMes = (mes: string): string => `${MESES_LARGO[Number(mes.slice(5, 7)) - 1]![0]!.toUpperCase()}${MESES_LARGO[Number(mes.slice(5, 7)) - 1]!.slice(1)} ${mes.slice(0, 4)}`;

const esMensual = (ins: InsumosSemanal | InsumosMensual): ins is InsumosMensual => 'mes' in ins;
const vNum = (xs: readonly bigint[]): number[] => xs.map(Number);
const aBig = (x: number): bigint => BigInt(Math.round(x));

function textoCelda(v: string): CeldaTabla {
  return { t: 'texto', v };
}

export function armarPaquete(ins: InsumosSemanal | InsumosMensual): Paquete {
  const mensual = esMensual(ins);
  const tipo: Periodicidad = mensual ? 'mensual' : 'semanal';
  const periodo: PeriodoReporte = mensual
    ? { tipo, inicio: ins.inicio, fin: ins.fin, etiqueta: etiquetaMes(ins.mes), folio: `MES-${ins.mes.slice(0, 4)}-${ins.mes.slice(5, 7)}` }
    : { tipo, inicio: ins.inicio, fin: ins.fin, etiqueta: etiquetaPeriodoSemanal(ins.inicio, ins.fin), folio: `SEM-${ins.anio}-${String(ins.semanaIso).padStart(2, '0')}` };
  const per = `${ins.inicio}/${ins.fin}`;
  const L = new LibroCifras();
  const base = { periodo: per };
  const ctx: Contexto = crearContexto(ins);
  const modelos = ctx.modelos;
  const previos: readonly PedidoInsumo[] = mensual ? ins.mesAnterior : ins.pedidosSemanaAnterior;
  const modelosPrev = agregarPorModelo(previos);

  // ---------- Resumen: ventas, piezas, cobrado, utilidad (cada una por dos vias) ----------
  const ventas = ctx.ventasCent;
  const ventasVia2 = sumaBig(ins.pedidos.flatMap((p) => p.lineas.map((l) => l.precioCent * BigInt(l.piezas))));
  const piezas = modelos.reduce((a, m) => a + m.piezas, 0);
  const piezasVia2 = ins.pedidos.reduce((a, p) => a + p.lineas.reduce((s, l) => s + l.piezas, 0), 0);
  const mercancia = ctx.costoCent;
  const guias = sumaBig(modelos.map((m) => m.guiaCent));
  const otros = sumaBig(modelos.map((m) => m.otrosCent));
  const renta = sumaBig(ins.pedidos.filter((p) => p.origen === 'bodega').map((p) => PARAMETROS.rentaBodegaCentPorPz * BigInt(p.lineas.reduce((s, l) => s + l.piezas, 0))));
  const mensajeros = sumaBig(ins.pedidos.map((p) => p.mensajeroCent));
  const contrib = ctx.contribCent;
  const contribVia2 = sumaBig(ins.pedidos.map(contribPedido));
  const cobrado = sumaBig(ins.pedidos.map((p) => p.cobradoCent));
  const cobradoVia2 = sumaBig([...new Set(ins.pedidos.map((p) => p.clienteId))].map((id) => sumaBig(ins.pedidos.filter((p) => p.clienteId === id).map((p) => p.cobradoCent))));

  L.agregar('ventas', 'Ventas', ventas, 'cent', { ...base, clase: 'Observado', fuente: 'pedidos confirmados', n: ins.pedidos.length, via2: ventasVia2 });
  L.agregar('piezas', 'Piezas', BigInt(piezas), 'pz', { ...base, clase: 'Observado', fuente: 'pedidos confirmados', n: ins.pedidos.length, via2: BigInt(piezasVia2) });
  L.agregar('cobrado', 'Cobrado', cobrado, 'cent', { ...base, clase: 'Observado', fuente: 'pedidos confirmados', n: ins.pedidos.length, via2: cobradoVia2 });
  L.agregar('mercancia', 'Mercancía a costo', mercancia, 'cent', { ...base, clase: 'Calculado', fuente: 'kardex a costo promedio', n: ins.pedidos.length, via2: sumaBig(ins.pedidos.flatMap((p) => p.lineas.map((l) => l.costoCent * BigInt(l.piezas)))) });
  L.agregar('guias', 'Guías', guias, 'cent', { ...base, clase: 'Observado', fuente: 'guías de salida', n: ins.pedidos.length, via2: sumaBig(ins.pedidos.map((p) => p.guiaCent)) });
  L.agregar('renta', 'Renta de bodega', renta, 'cent', { ...base, clase: 'Calculado', fuente: 'piezas surtidas desde bodega x renta', n: ins.pedidos.length, via2: otros - mensajeros });
  L.agregar('mensajeros', 'Mensajeros', mensajeros, 'cent', { ...base, clase: 'Observado', fuente: 'gastos variables del pedido', n: ins.pedidos.length, via2: otros - renta });
  L.agregar('contrib', 'Utilidad de contribución', contrib, 'cent', { ...base, clase: 'Calculado', fuente: 'ventas - mercancía - guías - renta - mensajeros', n: ins.pedidos.length, via2: contribVia2 });
  if (piezas > 0) L.agregar('contribPz', 'Contribución por pieza', (contrib * 100n + BigInt(piezas) * 50n) / (BigInt(piezas) * 100n), 'cent', { ...base, clase: 'Calculado', fuente: 'contribución / piezas', n: piezas, formato: 'centavos' });
  if (ventas > 0n) L.agregar('contribPct', 'Contribución sobre ventas', bp(contrib, ventas), 'bp', { ...base, clase: 'Calculado', fuente: 'contribución / ventas', n: ins.pedidos.length });
  if (ventas > 0n) L.agregar('cobradoPct', 'Cobrado sobre ventas', bp(cobrado, ventas), 'bp', { ...base, clase: 'Calculado', fuente: 'cobrado / ventas', n: ins.pedidos.length, formato: 'pct0' });
  L.agregar('pedidosN', 'Pedidos', BigInt(ins.pedidos.length), 'n', { ...base, clase: 'Observado', fuente: 'pedidos confirmados', n: ins.pedidos.length });
  L.agregar('margenBruto', 'Margen bruto', ventas > 0n ? bp(ventas - mercancia, ventas) : 0n, 'bp', { ...base, clase: 'Calculado', fuente: '(ventas - costo) / ventas', n: ins.pedidos.length, estado: ventas > 0n ? 'ok' : 'sin_datos' });

  // Referencia: promedio de 4 semanas (semanal) o mes anterior (mensual).
  const refContrib = mensual ? sumaBig(modelosPrev.map(contribucionModelo)) : ins.historia.length ? sumaBig(ins.historia.slice(-4).map((h) => h.contribCent)) / BigInt(Math.min(4, ins.historia.length)) : null;
  const refVentas = mensual ? sumaBig(modelosPrev.map((m) => m.ventaCent)) : ins.historia.length ? sumaBig(ins.historia.slice(-4).map((h) => h.ventasCent)) / BigInt(Math.min(4, ins.historia.length)) : null;
  const refPiezas = mensual ? modelosPrev.reduce((a, m) => a + m.piezas, 0) : ins.historia.length ? Math.round(ins.historia.slice(-4).reduce((a, h) => a + h.piezas, 0) / Math.min(4, ins.historia.length)) : null;
  const nRef = mensual ? previos.length : Math.min(4, ins.historia.length);
  const refEtiqueta = mensual ? 'mes anterior' : 'promedio de 4 semanas';
  if (refContrib !== null && refContrib !== 0n) {
    L.agregar('refContrib', `Utilidad, ${refEtiqueta}`, refContrib, 'cent', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef });
    L.agregar('varContrib', `Variación de la utilidad contra ${refEtiqueta}`, bp(contrib - refContrib, refContrib < 0n ? -refContrib : refContrib), 'bp', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef, formato: 'pct0' });
  } else L.sinDatos('varContrib', 'Variación de la utilidad', 'bp', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef, requeridos: 1 });
  if (refVentas !== null && refVentas > 0n) {
    L.agregar('refVentas', `Ventas, ${refEtiqueta}`, refVentas, 'cent', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef });
    L.agregar('varVentas', `Variación de ventas contra ${refEtiqueta}`, bp(ventas - refVentas, refVentas), 'bp', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef, formato: 'pct0' });
  } else L.sinDatos('varVentas', 'Variación de ventas', 'bp', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef, requeridos: 1 });
  if (refPiezas !== null && refPiezas > 0) {
    L.agregar('refPiezas', `Piezas, ${refEtiqueta}`, BigInt(refPiezas), 'pz', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef });
    L.agregar('varPiezas', `Variación de piezas contra ${refEtiqueta}`, bp(BigInt(piezas - refPiezas), BigInt(refPiezas)), 'bp', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef, formato: 'pct0' });
  } else L.sinDatos('varPiezas', 'Variación de piezas', 'bp', { ...base, clase: 'Calculado', fuente: refEtiqueta, n: nRef, requeridos: 1 });

  // ---------- Puente de utilidad ----------
  const puente = calcularPuente(modelosPrev, modelos);
  if (puente) {
    const invertido = calcularPuente([...modelosPrev].reverse(), [...modelos].reverse());
    L.agregar('puente.inicio', 'Utilidad del periodo anterior', puente.inicioCent, 'cent', { ...base, clase: 'Calculado', fuente: 'puente', n: modelosPrev.length, via2: sumaBig(modelosPrev.map(contribucionModelo)) });
    L.agregar('puente.fin', 'Utilidad del periodo', puente.finCent, 'cent', { ...base, clase: 'Calculado', fuente: 'puente', n: modelos.length, via2: contrib });
    L.agregar('puente.suma', 'Suma de los pasos del puente', sumaBig(puente.pasos.map((x) => x.deltaCent)), 'cent', { ...base, clase: 'Calculado', fuente: 'puente', n: puente.pasos.length, via2: puente.finCent - puente.inicioCent });
    for (const [i, x] of puente.pasos.entries()) L.agregar(`puente.${x.id}`, `Puente: ${x.etiqueta}`, x.deltaCent, 'cent', { ...base, clase: 'Calculado', fuente: 'puente de utilidad', n: modelos.length, via2: invertido ? invertido.pasos[i]!.deltaCent : x.deltaCent });
  }

  if (puente && puente.inicioCent !== 0n) L.agregar('puente.pct', 'Variación de la utilidad contra el periodo anterior', bp(puente.finCent - puente.inicioCent, puente.inicioCent < 0n ? -puente.inicioCent : puente.inicioCent), 'bp', { ...base, clase: 'Calculado', fuente: 'puente', n: modelos.length, formato: 'pct0' });

  // ---------- Clientes ----------
  const clientes = ctx.clientes;
  const paretoItems: ItemPareto[] = [];
  let acumulado = 0n;
  for (const c of clientes) {
    acumulado += c.ventasCent;
    paretoItems.push({ id: c.clienteId, etiqueta: c.cliente, valorCent: c.ventasCent, pctAcumBp: ventas > 0n ? bp(acumulado, ventas) : 0n });
  }
  if (clientes.length >= 5 && ventas > 0n) {
    const top2 = clientes[0]!.ventasCent + clientes[1]!.ventasCent;
    const hhi = clientes.reduce((a, c) => a + (c.ventasCent * c.ventasCent * 10_000n) / (ventas * ventas), 0n);
    L.agregar('cli.top2Pct', 'Participación de los 2 mayores clientes', bp(top2, ventas), 'bp', { ...base, clase: 'Calculado', fuente: 'ventas por cliente', n: clientes.length, via2: bp(paretoItems[1]!.valorCent + paretoItems[0]!.valorCent, ventas), formato: 'pct0' });
    L.agregar('cli.hhi', 'HHI de ventas', hhi, 'n', { ...base, clase: 'Calculado', fuente: 'ventas por cliente', n: clientes.length, via2: [...clientes].reverse().reduce((a, c) => a + (c.ventasCent * c.ventasCent * 10_000n) / (ventas * ventas), 0n) });
  } else L.sinDatos('cli.top2Pct', 'Participación de los 2 mayores clientes', 'bp', { ...base, clase: 'Calculado', fuente: 'ventas por cliente', n: clientes.length, requeridos: 5 });
  L.agregar('cli.n', 'Clientes con pedido', BigInt(clientes.length), 'n', { ...base, clase: 'Observado', fuente: 'pedidos confirmados', n: clientes.length });

  // ---------- Inventario y productos ----------
  const cobertura: FilaCobertura[] = [];
  const reposicion: CeldaTabla[][] = [];
  let valorInv = 0n;
  let inmovilizado = 0n;
  for (const m of ins.inventario) {
    const valor = BigInt(m.existencia) * m.costoPromCent;
    valorInv += valor;
    const r = puntoReorden({ ventasSemanales: m.ventasSemanales, existencia: m.existencia, enTransito: m.enTransito, leadTime: m.leadTime, piezasPorCaja: m.piezasPorCaja });
    const s = slug(m.modelo);
    let dias: number | null = null;
    let lo: number | null = null;
    let hi: number | null = null;
    if (r.emite) {
      dias = r.datos.coberturaDias === null ? null : Math.round(r.datos.coberturaDias);
      lo = r.datos.coberturaLo === null ? null : Math.round(r.datos.coberturaLo);
      hi = r.datos.coberturaHi === null ? null : Math.round(r.datos.coberturaHi);
      if (dias !== null) L.agregar(`cob.${s}`, `Cobertura de ${m.modelo}`, BigInt(dias), 'dias', { ...base, clase: 'Estimado', fuente: r.metodo, n: r.ventana.n, ...(lo !== null && hi !== null ? { rango: { lo: BigInt(lo), hi: BigInt(hi) } } : {}), metodo: r.metodo });
      L.agregar(`rep.${s}.existencia`, `Existencia de ${m.modelo}`, BigInt(m.existencia), 'pz', { ...base, clase: 'Observado', fuente: 'kardex', n: m.existencia });
      L.agregar(`rep.${s}.rop`, `Punto de reorden de ${m.modelo}`, aBig(r.datos.puntoReorden), 'pz', { ...base, clase: 'Estimado', fuente: r.metodo, n: r.ventana.n });
      if (r.datos.debeReponer || r.datos.pedir > 0) {
        L.agregar(`rep.${s}.pedir`, `Pedir de ${m.modelo}`, BigInt(r.datos.pedir), 'pz', { ...base, clase: 'Estimado', fuente: r.metodo, n: r.ventana.n });
        L.agregar(`rep.${s}.costo`, `Costo del pedido de ${m.modelo}`, BigInt(r.datos.pedir) * m.costoReposicionCent, 'cent', { ...base, clase: 'Estimado', fuente: r.metodo, n: r.ventana.n });
        reposicion.push([textoCelda(m.modelo), { t: 'pz', v: m.existencia }, { t: 'pz', v: Math.round(r.datos.puntoReorden) }, { t: 'pz', v: r.datos.pedir }, { t: 'cent', v: BigInt(r.datos.pedir) * m.costoReposicionCent }, textoCelda(`${m.proveedor} ${pesosEnteros(m.costoReposicionCent)}/pz`)]);
      }
      if ((dias !== null && dias > PARAMETROS.cobertura.maximo) || (m.diasSinVenta >= 21 && m.existencia > m.piezasPorCaja)) inmovilizado += valor;
    } else L.sinDatos(`cob.${s}`, `Cobertura de ${m.modelo}`, 'dias', { ...base, clase: 'Estimado', fuente: 'punto de reorden', n: m.ventasSemanales.length, requeridos: PARAMETROS.reorden.minSemanasModelo });
    cobertura.push({ modelo: m.modelo, dias, lo, hi, existencia: m.existencia, sinVentaDias: m.diasSinVenta });
  }
  cobertura.sort((a, b) => (a.dias ?? 1_000_000) - (b.dias ?? 1_000_000) || cmpTexto(a.modelo, b.modelo));
  if (ins.inventario.length > 0) {
    L.agregar('inv.valor', 'Valor del inventario', valorInv, 'cent', { ...base, clase: 'Calculado', fuente: 'existencia x costo promedio', n: ins.inventario.length, via2: sumaBig([...ins.inventario].reverse().map((m) => m.costoPromCent * BigInt(m.existencia))) });
    L.agregar('inv.inmovilizado', 'Capital inmovilizado', inmovilizado, 'cent', { ...base, clase: 'Calculado', fuente: 'cobertura > 56 d o 21 d sin venta', n: ins.inventario.length });
    if (valorInv > 0n) L.agregar('inv.inmovPct', 'Capital inmovilizado sobre inventario', bp(inmovilizado, valorInv), 'bp', { ...base, clase: 'Calculado', fuente: 'capital inmovilizado / inventario', n: ins.inventario.length, formato: 'pct0' });
  }
  const conteo = ins.conteo;
  if (conteo) {
    L.agregar('conteo.cuadran', 'Líneas que cuadran', BigInt(conteo.lineasCuadran), 'n', { ...base, clase: 'Observado', fuente: 'conteo', n: conteo.lineasTotal });
    L.agregar('conteo.total', 'Líneas contadas', BigInt(conteo.lineasTotal), 'n', { ...base, clase: 'Observado', fuente: 'conteo', n: conteo.lineasTotal });
    L.agregar('conteo.puentePz', 'Piezas en cuenta puente', BigInt(conteo.piezasPuente), 'pz', { ...base, clase: 'Observado', fuente: 'conteo', n: conteo.lineasTotal });
    L.agregar('conteo.puenteValor', 'Valor en cuenta puente', conteo.valorPuenteCent, 'cent', { ...base, clase: 'Calculado', fuente: 'conteo', n: conteo.lineasTotal, formato: 'centavos' });
  }

  // ---------- Dinero: antiguedad, liquidacion, flujo ----------
  const totalCartera = sumaBig(ins.cartera.map((p) => p.saldoCent));
  const antiguedad: CubetaAntiguedad[] = PARAMETROS.carteraBuckets.map((b) => ({ id: b.id, etiqueta: b.etiqueta, montoCent: sumaBig(ins.cartera.filter((p) => p.dias >= b.desde && p.dias <= b.hasta).map((p) => p.saldoCent)) }));
  L.agregar('age.total', 'Por cobrar', totalCartera, 'cent', { ...base, clase: 'Observado', fuente: 'cuentas por cobrar', n: ins.cartera.length, via2: sumaBig(antiguedad.map((a) => a.montoCent)) });
  for (const a of antiguedad) L.agregar(`age.${a.id}`, `Cartera ${a.etiqueta}`, a.montoCent, 'cent', { ...base, clase: 'Observado', fuente: 'cuentas por cobrar', n: ins.cartera.length });
  const vencida = sumaBig(ins.cartera.filter((p) => p.dias > 30).map((p) => p.saldoCent));
  L.agregar('age.vencida', 'Cartera de más de 30 días', vencida, 'cent', { ...base, clase: 'Observado', fuente: 'cuentas por cobrar', n: ins.cartera.length, via2: antiguedad.filter((a) => a.id === 'b31_60' || a.id === 'b60_mas').reduce((s, a) => s + a.montoCent, 0n) });
  if (totalCartera > 0n) L.agregar('age.vencidaPct', 'Cartera de más de 30 días sobre el total', bp(vencida, totalCartera), 'bp', { ...base, clase: 'Calculado', fuente: 'cartera > 30 d / total', n: ins.cartera.length, formato: 'pct0' });
  const mayorDeuda = [...ins.cartera].sort((a, b) => (a.saldoCent === b.saldoCent ? cmpTexto(a.cliente, b.cliente) : a.saldoCent > b.saldoCent ? -1 : 1))[0];
  if (mayorDeuda) L.agregar('age.mayorSaldo', 'Mayor saldo de un cliente', mayorDeuda.saldoCent, 'cent', { ...base, clase: 'Observado', fuente: 'cuentas por cobrar', n: ins.cartera.length });

  const liq = ins.liquidacion;
  if (liq) {
    const porPagar = liq.mercanciaCent + liq.guiasCent - liq.pagadoCent;
    L.agregar('liq.mercancia', `Mercancía con ${liq.proveedor}`, liq.mercanciaCent, 'cent', { ...base, clase: 'Observado', fuente: 'hoja del proveedor', n: 1 });
    L.agregar('liq.guias', `Guías con ${liq.proveedor}`, liq.guiasCent, 'cent', { ...base, clase: 'Observado', fuente: 'hoja del proveedor', n: 1 });
    L.agregar('liq.pagado', `Pagado a ${liq.proveedor}`, liq.pagadoCent, 'cent', { ...base, clase: 'Observado', fuente: 'pagos', n: 1 });
    L.agregar('liq.porPagar', `Por pagar a ${liq.proveedor}`, porPagar, 'cent', { ...base, clase: 'Calculado', fuente: 'mercancía + guías - pagos', n: 1, ...(liq.segunProveedorCent !== undefined ? { via2: liq.segunProveedorCent } : {}) });
    const cob = coberturaViernes(liq.fondosDisponiblesCent, liq.cobrosEsperadosHastaViernesCent, porPagar);
    if (cob !== null) L.agregar('liq.cobertura', 'Cobertura del viernes', cob, 'milesimas', { ...base, clase: 'Calculado', fuente: '(fondos + cobros esperados) / saldo', n: 1 });
    L.agregar('liq.fondos', 'Fondos y cobros esperados hasta el viernes', liq.fondosDisponiblesCent + liq.cobrosEsperadosHastaViernesCent, 'cent', { ...base, clase: 'Estimado', fuente: 'fondos + cobros esperados', n: 1 });
    L.agregar('liq.holgura', 'Holgura de la liquidación', liq.fondosDisponiblesCent + liq.cobrosEsperadosHastaViernesCent - porPagar, 'cent', { ...base, clase: 'Estimado', fuente: 'fondos + cobros esperados - saldo', n: 1 });
  }

  const fp = ins.flujo ? flujoCaja(ins.flujo) : null;
  let flujo: DatosFlujo | null = null;
  const notasProy: string[] = [];
  if (fp) {
    if (fp.emite) {
      flujo = fp.datos;
      for (const s of fp.datos.semanas) L.agregar(`flujo.s${s.semana}`, `Saldo proyectado, semana ${s.semana}`, s.saldoCent, 'cent', { ...base, clase: fp.clase, fuente: fp.metodo, n: fp.ventana.n, rango: { lo: s.saldoLoCent, hi: s.saldoHiCent }, metodo: fp.metodo });
      L.agregar('flujo.minimo', 'Saldo mínimo proyectado (peor caso)', fp.datos.saldoMinimoCent, 'cent', { ...base, clase: fp.clase, fuente: fp.metodo, n: fp.ventana.n, metodo: fp.metodo });
    } else {
      notasProy.push(`Flujo de caja: ${fp.razon}`);
      L.sinDatos('flujo.minimo', 'Saldo mínimo proyectado', 'cent', { ...base, clase: 'Estimado', fuente: 'flujo de caja', n: PARAMETROS.flujo.minSemanasCobros - fp.faltan, requeridos: PARAMETROS.flujo.minSemanasCobros });
    }
  }

  // ---------- Gastos (mini reporte) ----------
  const gVar = sumaBig(ins.gastos.filter((g) => g.categoria === 'variable').map((g) => g.montoCent));
  const gFijo = sumaBig(ins.gastos.filter((g) => g.categoria === 'fijo').map((g) => g.montoCent));
  const gTotal = gVar + gFijo;
  const plat = sumaBig(ins.gastos.filter((g) => g.plataforma).map((g) => g.montoCent));
  L.agregar('gas.total', 'Gasto total', gTotal, 'cent', { ...base, clase: 'Observado', fuente: 'gastos registrados', n: ins.gastos.length, via2: sumaBig(['Angelo', 'Javier', 'Sociedad'].map((q) => sumaBig(ins.gastos.filter((g) => g.pagadoPor === q).map((g) => g.montoCent)))) });
  L.agregar('gas.variable', 'Gasto variable', gVar, 'cent', { ...base, clase: 'Observado', fuente: 'gastos registrados', n: ins.gastos.length });
  L.agregar('gas.fijo', 'Gasto fijo', gFijo, 'cent', { ...base, clase: 'Observado', fuente: 'gastos registrados', n: ins.gastos.length });
  L.agregar('gas.plataforma', 'Gasto de plataforma', plat, 'cent', { ...base, clase: 'Observado', fuente: 'gastos registrados', n: ins.gastos.length });
  if (gTotal > 0n) {
    L.agregar('gas.varPct', 'Gasto variable sobre el total', bp(gVar, gTotal), 'bp', { ...base, clase: 'Calculado', fuente: 'variable / total', n: ins.gastos.length, formato: 'pct0' });
    L.agregar('gas.platPct', 'Plataforma sobre el total', bp(plat, gTotal), 'bp', { ...base, clase: 'Calculado', fuente: 'plataforma / total', n: ins.gastos.length, formato: 'pct0' });
    if (ventas > 0n) L.agregar('gas.pctVentas', 'Gasto sobre ventas', bp(gTotal, ventas), 'bp', { ...base, clase: 'Calculado', fuente: 'gasto / ventas', n: ins.gastos.length });
    if (piezas > 0) L.agregar('gas.porPieza', 'Gasto por pieza', gTotal / BigInt(piezas), 'cent', { ...base, clase: 'Calculado', fuente: 'gasto / piezas', n: piezas, formato: 'centavos' });
  }
  if (ins.plataforma) L.agregar('gas.tope', 'Tope de plataforma', ins.plataforma.topeCent, 'cent', { ...base, clase: 'Declarado', fuente: 'configuración', n: 1 });

  // ---------- Socios y Omar ----------
  const socios = ins.socios;
  if (socios) {
    L.agregar('soc.diferencia', 'Diferencia entre socios', socios.diferenciaCent, 'cent', { ...base, clase: 'Calculado', fuente: '(posición Angelo - posición Javier) / 2', n: 1, formato: 'centavos' });
    L.agregar('soc.anterior', 'Diferencia anterior entre socios', socios.diferenciaAnteriorCent, 'cent', { ...base, clase: 'Calculado', fuente: 'periodo anterior', n: 1, formato: 'centavos' });
    L.agregar('soc.omarNeto', 'Neto de Omar', socios.omarNetoCent, 'cent', { ...base, clase: 'Calculado', fuente: 'renta - tomas - pagos', n: 1, via2: socios.omarRentaCent - socios.omarTomasCent - socios.omarPagosCent });
    L.agregar('soc.omarRenta', 'Renta de bodega de Omar', socios.omarRentaCent, 'cent', { ...base, clase: 'Calculado', fuente: 'piezas x renta', n: 1 });
    L.agregar('soc.omarTomas', 'Tomas de Omar', socios.omarTomasCent, 'cent', { ...base, clase: 'Calculado', fuente: 'piezas x precio de su lista', n: 1 });
  }

  // ---------- Insights y recomendaciones ----------
  const insights = evaluarInsights(ctx, L, per);

  // ---------- Extras mensuales ----------
  const mens = mensual ? armarMensual(ins, L, base, ventas, contrib, modelos, notasProy) : null;

  // ---------- Comprobaciones ----------
  const internas: ResultadoComprobacion[] = [
    { id: 'R.PEDIDOS', nombre: 'Suma de pedidos = suma por modelo', via1: contrib, via2: contribVia2, ok: contrib === contribVia2 },
  ];
  if (puente) internas.push({ id: 'R.PUENTE', nombre: 'Inicio más suma de pasos = fin (el puente suma exacto)', via1: puente.inicioCent + sumaBig(puente.pasos.map((x) => x.deltaCent)), via2: puente.finCent, ok: puenteCuadra(puente) });
  const cifrasFinal = L.todas();
  const comprobaciones: ResultadoComprobacion[] = [...ins.comprobaciones, ...internas, ...L.comprobaciones()];
  const estado = decidirEstado({ comprobaciones, periodoAprobado: ins.aprobadoEn !== undefined, enCurso: ins.enCurso, datosIncompletos: ins.datosIncompletos });

  // ---------- Tablas ----------
  const tablas: Record<string, Tabla> = {};
  const pedidosOrden = [...ins.pedidos].sort((a, b) => (contribPedido(a) === contribPedido(b) ? cmpTexto(a.folio, b.folio) : contribPedido(a) > contribPedido(b) ? -1 : 1));
  const filasPed: CeldaTabla[][] = pedidosOrden.slice(0, PARAMETROS.maxRenglonesTabla).map((p) => [
    textoCelda(p.folio),
    textoCelda(p.cliente),
    textoCelda(p.origen === 'bodega' ? 'Bodega' : 'Directo'),
    { t: 'pz', v: p.lineas.reduce((a, l) => a + l.piezas, 0) },
    { t: 'cent', v: p.cobradoCent },
    { t: 'cent', v: contribPedido(p) },
    textoCelda((p.avisos ?? []).join('; ') || '—'),
  ]);
  const resto = pedidosOrden.slice(PARAMETROS.maxRenglonesTabla);
  tablas.pedidos = { id: 'pedidos', titulo: 'Pedidos del periodo', columnas: ['Folio', 'Cliente', 'Origen', 'Piezas', 'Cobrado', 'Contribución', 'Aviso'], filas: filasPed, ...(resto.length ? { nota: `Resto: ${resto.length} pedidos, contribución ${pesosEnteros(sumaBig(resto.map(contribPedido)))}`, valoresNota: [resto.length, sumaBig(resto.map(contribPedido))] } : {}) };
  tablas.clientes = {
    id: 'clientes',
    titulo: 'Clientes del periodo',
    columnas: ['Cliente', 'Piezas', 'Ventas', 'Contribución', 'Pedidos'],
    filas: clientes.slice(0, PARAMETROS.maxRenglonesTabla).map((c) => [textoCelda(c.cliente), { t: 'pz', v: c.piezas }, { t: 'cent', v: c.ventasCent }, { t: 'cent', v: c.contribCent }, { t: 'n', v: c.pedidos }]),
  };
  tablas.reposicion = { id: 'reposicion', titulo: 'Reposición sugerida (Estimado)', columnas: ['Modelo', 'Existencia', 'Punto de reorden', 'Pedir', 'Costo', 'Proveedor'], filas: reposicion.slice(0, PARAMETROS.maxRenglonesTabla) };
  if (liq)
    tablas.liquidacion = {
      id: 'liquidacion',
      titulo: `Liquidación con ${liq.proveedor}`,
      columnas: ['Concepto', 'Monto'],
      filas: [
        [textoCelda('Mercancía'), { t: 'cent', v: liq.mercanciaCent }],
        [textoCelda('Guías'), { t: 'cent', v: liq.guiasCent }],
        [textoCelda('Pagado'), { t: 'cent', v: -liq.pagadoCent }],
        [textoCelda('Por pagar'), { t: 'cent', v: liq.mercanciaCent + liq.guiasCent - liq.pagadoCent }],
        ...(liq.segunProveedorCent !== undefined ? [[textoCelda('Según el proveedor'), { t: 'cent', v: liq.segunProveedorCent }] as CeldaTabla[]] : []),
      ],
    };
  tablas.gastos = {
    id: 'gastos',
    titulo: 'Gastos del periodo',
    columnas: ['Concepto', 'Tipo', 'Pagó', 'Monto'],
    filas: ins.gastos.slice(0, PARAMETROS.maxRenglonesTabla).map((g) => [textoCelda(g.concepto), textoCelda(g.categoria === 'variable' ? 'Variable' : 'Fijo'), textoCelda(g.pagadoPor), { t: 'cent', v: g.montoCent }]),
    ...(ins.gastos.length === 0 ? { nota: 'Sin gastos en el periodo' } : {}),
  };
  tablas.control = {
    id: 'control',
    titulo: 'Comprobaciones',
    columnas: ['Id', 'Comprobación', 'Vía 1', 'Vía 2', 'Estado'],
    filas: comprobaciones.map((c) => [textoCelda(c.id), textoCelda(c.nombre), { t: 'cent', v: c.via1, f: 'n' }, { t: 'cent', v: c.via2, f: 'n' }, textoCelda(c.ok ? 'Cuadra' : 'No cuadra')]),
  };
  if (mens) Object.assign(tablas, mens.tablas);

  const graficas: GraficasPaquete = {
    puente,
    pareto: clientes.length >= 5 ? { items: paretoItems, totalCent: ventas } : null,
    cobertura,
    antiguedad,
    flujo,
    gastos: {
      segmentos: [
        { id: 'variable', etiqueta: 'Variables', montoCent: gVar },
        { id: 'fijo', etiqueta: 'Fijos', montoCent: gFijo },
      ],
      plataforma: ins.plataforma ? { gastoCent: ins.plataforma.gastoCent, topeCent: ins.plataforma.topeCent } : null,
    },
    socios: socios
      ? {
          diferenciaCent: socios.diferenciaCent,
          pasos: [
            { etiqueta: 'Anterior', deltaCent: socios.diferenciaAnteriorCent },
            { etiqueta: 'Cambio del periodo', deltaCent: socios.diferenciaCent - socios.diferenciaAnteriorCent },
            { etiqueta: 'Ahora', deltaCent: socios.diferenciaCent },
          ],
        }
      : null,
    cascada: mens?.cascada ?? [],
    calor: mens?.calor ?? null,
    bump: mens?.bump ?? null,
    burbujas: mens?.burbujas ?? null,
    mancuernas: ins.comparacionProveedores.map((k) => ({ modelo: k.modelo, costoIsaacCent: k.costoIsaacCent, costoKarenCent: k.costoKarenCent })),
    tendencia: mens?.tendencia ?? null,
    tornado: mens?.tornado ?? [],
    tendenciaCartera: mensual ? ins.tendenciaCarteraBp : [],
  };

  const nombres = [...new Set([...clientes.map((c) => c.cliente), ...ins.clientes.map((c) => c.cliente), ...ins.inventario.flatMap((m) => [m.modelo, ...m.sabores.map((s) => s.sabor)]), ...modelos.map((m) => m.modelo), ...ins.cartera.map((c) => c.cliente), ...ins.pedidos.map((p) => p.folio), ...ins.gastos.map((g) => g.concepto)])].sort(cmpTexto);
  const sinHuella = { version: 1, tipo, periodo, corteIso: ins.corteIso, cifras: cifrasFinal, comprobaciones, estado, tablas, graficas, insights, nombres, notasProy: [...notasProy, ...(mens?.notas ?? [])] };
  const huella = sha256Hex(jsonCanonico(sinHuella)).slice(0, 6);
  return {
    version: 1,
    tipo,
    periodo,
    corteIso: ins.corteIso,
    corteEtiqueta: `${etiquetaFechaHora(ins.corteIso)} Mérida`,
    cifras: cifrasFinal,
    comprobaciones,
    estado,
    tablas,
    graficas,
    insights,
    nombres,
    proyeccionNota: sinHuella.notasProy,
    huella,
  };
}

// ---------- Extras del reporte mensual ----------

interface ExtrasMensual {
  readonly tablas: Record<string, Tabla>;
  readonly cascada: PasoCascada[];
  readonly calor: GraficasPaquete['calor'];
  readonly bump: GraficasPaquete['bump'];
  readonly burbujas: GraficasPaquete['burbujas'];
  readonly tendencia: GraficasPaquete['tendencia'];
  readonly tornado: BarraTornado[];
  readonly notas: string[];
}

function armarMensual(ins: InsumosMensual, L: LibroCifras, base: { periodo: string }, ventas: bigint, contrib: bigint, modelos: readonly AgregadoModelo[], notasBase: readonly string[]): ExtrasMensual {
  const tablas: Record<string, Tabla> = {};
  const notas: string[] = [...notasBase.filter(() => false)];
  // Estado de resultados: la utilidad neta por dos vias (renglones con signo contra el cierre contable).
  const viaRenglones = sumaBig(ins.resultados.filter((r) => !r.subtotal).map((r) => BigInt(r.signo) * r.montoCent));
  L.agregar('res.utilidadNeta', 'Utilidad neta', ins.utilidadNetaCent, 'cent', { ...base, clase: 'Calculado', fuente: 'estado de resultados', n: ins.resultados.length, via2: viaRenglones });
  if (ventas > 0n) L.agregar('res.margenNeto', 'Margen neto', bp(ins.utilidadNetaCent, ventas), 'bp', { ...base, clase: 'Calculado', fuente: 'utilidad neta / ventas', n: ins.resultados.length });
  for (const r of ins.resultados) L.agregar(`res.${r.id}`, r.etiqueta, r.montoCent, 'cent', { ...base, clase: 'Calculado', fuente: `cuenta ${r.cuenta}`, n: 1 });
  const cascada: PasoCascada[] = ins.resultados.map((r) => ({ id: r.id, etiqueta: r.etiqueta, montoCent: r.montoCent, subtotal: r.subtotal, signo: r.signo }));
  tablas.resultados = {
    id: 'resultados',
    titulo: 'Estado de resultados',
    columnas: ['Renglón', 'Mes', '% de ventas', 'Mes anterior', 'Mediana de 3 meses'],
    filas: ins.resultados.map((r) => [textoCelda(r.etiqueta), { t: 'cent', v: r.montoCent }, ventas > 0n ? { t: 'bp', v: bp(r.montoCent, ventas), f: 'pct1' } : textoCelda('—'), { t: 'cent', v: r.mesAnteriorCent }, { t: 'cent', v: r.medianaTresMesesCent }]),
  };
  const cs = ins.costosSistema;
  if (cs) {
    L.agregar('sis.cargo', 'Costos de mantenimiento del sistema: cargo a la sociedad', cs.cargoSociedadCent, 'cent', { ...base, clase: 'Calculado', fuente: 'costos del sistema', n: 1 });
    L.agregar('sis.comoSeria', 'Como sería', cs.comoSeriaCent, 'cent', { ...base, clase: 'Calculado', fuente: 'cuota del documento', n: 1 });
    L.agregar('sis.comoDeberiaSer', 'Como debería ser', cs.comoDeberiaSerCent, 'cent', { ...base, clase: 'Calculado', fuente: 'participación real por consumo', n: 1 });
    L.agregar('sis.bolsillo', 'Costo real de bolsillo de Javier', cs.bolsilloJavierCent, 'cent', { ...base, clase: 'Calculado', fuente: 'costos del sistema', n: 1 });
    L.agregar('sis.reembolsado', 'Reembolsado a Javier', cs.reembolsadoCent, 'cent', { ...base, clase: 'Calculado', fuente: 'costos del sistema', n: 1 });
    L.agregar('sis.pendiente', 'Pendiente de reembolso a Javier', cs.pendienteCent, 'cent', { ...base, clase: 'Calculado', fuente: 'cargado - reembolsado', n: 1, via2: cs.cargoSociedadCent - cs.reembolsadoCent });
    tablas.sistema = {
      id: 'sistema',
      titulo: 'Costos de mantenimiento del sistema',
      columnas: ['Línea', 'Monto'],
      filas: [
        [textoCelda('Cargo total a la sociedad'), { t: 'cent', v: cs.cargoSociedadCent }],
        [textoCelda('Como sería'), { t: 'cent', v: cs.comoSeriaCent }],
        [textoCelda('Como debería ser'), { t: 'cent', v: cs.comoDeberiaSerCent }],
        [textoCelda('Costo real de bolsillo de Javier'), { t: 'cent', v: cs.bolsilloJavierCent }],
        [textoCelda('Reembolsado'), { t: 'cent', v: cs.reembolsadoCent }],
        [textoCelda('Pendiente de reembolso'), { t: 'cent', v: cs.pendienteCent }],
      ],
    };
  }

  // Mapa de calor cliente x sabor: minimo 3 pedidos y 60 pz por cliente.
  const porCliente = new Map<string, number>();
  for (const c of ins.clienteSabor) porCliente.set(c.cliente, (porCliente.get(c.cliente) ?? 0) + c.piezas);
  const elegibles = [...porCliente.entries()].filter(([c, pz]) => pz >= 60 && (ins.clientes.find((h) => h.cliente === c)?.pedidos.length ?? 0) >= 3).map(([c]) => c).sort(cmpTexto);
  let calor: GraficasPaquete['calor'] = null;
  if (elegibles.length > 0) {
    const celdas = ins.clienteSabor.filter((c) => elegibles.includes(c.cliente)).map((c) => ({ fila: c.cliente, col: c.sabor, piezas: c.piezas, pctFilaBp: bp(BigInt(c.piezas), BigInt(porCliente.get(c.cliente)!)) }));
    calor = { filas: elegibles, cols: [...new Set(celdas.map((c) => c.col))].sort(cmpTexto), celdas };
  } else notas.push('Mapa de calor: se necesitan 3 pedidos y 60 pz por cliente.');

  // Bump chart: 8 periodos.
  const bump = ins.rankSemanalClientes.length > 0 && ins.rankSemanalClientes[0]!.rank.length >= 8 ? { periodos: ins.rankSemanalClientes[0]!.rank.length, series: ins.rankSemanalClientes.slice(0, 6) } : null;
  if (!bump) notas.push('Bump chart: se necesitan 8 semanas.');

  // Burbujas margen-rotacion: 8 modelos y 100 pz.
  const pzTot = modelos.reduce((a, m) => a + m.piezas, 0);
  let burbujas: GraficasPaquete['burbujas'] = null;
  if (ins.inventario.length >= 8 && pzTot >= 100) {
    const pts = ins.inventario.map((m) => {
      const ag = modelos.find((x) => x.modelo === m.modelo);
      const pz = ag?.piezas ?? 0;
      return { modelo: m.modelo, contribPzCent: m.contribPorPiezaCent, rotacionMilesimas: m.existencia > 0 ? BigInt(Math.round((pz / m.existencia) * 1000)) : 0n, contribTotalCent: ag ? contribucionModelo(ag) : 0n };
    });
    const medC = BigInt(Math.round(medianaNum(vNum(pts.map((p) => p.contribPzCent)))));
    const medR = BigInt(Math.round(medianaNum(vNum(pts.map((p) => p.rotacionMilesimas)))));
    burbujas = {
      medianaContribPzCent: medC,
      medianaRotacionMilesimas: medR,
      puntos: pts.map((p): BurbujaModelo => ({ ...p, cuadrante: p.rotacionMilesimas >= medR ? (p.contribPzCent >= medC ? 'Estrella' : 'Revisar') : p.contribPzCent >= medC ? 'Vaca' : 'Cola' })).sort((a, b) => cmpTexto(a.modelo, b.modelo)),
    };
  } else notas.push('Burbujas margen-rotación: se necesitan 8 modelos y 100 pz.');

  // Proyecciones y escenarios.
  const serie = ins.historia.map((h) => Number(h.contribCent));
  const inicios = ins.historia.map((h) => h.inicio);
  const ema = promedioMovilExponencial(serie, PARAMETROS.flujo.semanas, inicios);
  const tend = tendenciaLineal(serie, PARAMETROS.flujo.semanas, inicios);
  let tendencia: GraficasPaquete['tendencia'] = null;
  const tornado: BarraTornado[] = [];
  if (ema.emite) {
    const puntos = ema.datos.puntos.map((p) => ({ h: p.h, centralCent: aBig(p.central), loCent: aBig(p.lo), hiCent: aBig(p.hi) }));
    tendencia = { observados: ins.historia.map((h) => h.contribCent), proyectados: puntos, metodo: ema.metodo, ventanaN: ema.ventana.n };
    L.agregar('proy.central', 'Utilidad proyectada por semana', puntos[0]!.centralCent, 'cent', { ...base, clase: 'Estimado', fuente: ema.metodo, n: ema.ventana.n, rango: { lo: puntos[0]!.loCent, hi: puntos[0]!.hiCent }, metodo: ema.metodo });
    L.agregar('proy.cuatro', 'Utilidad proyectada, 4 semanas', puntos.reduce((a, p) => a + p.centralCent, 0n), 'cent', { ...base, clase: 'Estimado', fuente: ema.metodo, n: ema.ventana.n, rango: { lo: puntos[puntos.length - 1]!.loCent * 4n, hi: puntos[puntos.length - 1]!.hiCent * 4n }, metodo: ema.metodo });
    if (tend.emite) {
      L.agregar('proy.pendiente', 'Pendiente de la tendencia por semana', aBig(tend.datos.pendiente), 'cent', { ...base, clase: 'Estimado', fuente: tend.metodo, n: tend.ventana.n });
      L.agregar('proy.t', 'Estadístico t de la pendiente (décimas)', aBig(Math.abs(tend.datos.t) * 10), 'n', { ...base, clase: 'Estimado', fuente: tend.metodo, n: tend.ventana.n });
    } else notas.push(`Tendencia: ${tend.razon}`);
    // Escenarios de sensibilidad sobre la base proyectada.
    const piezasSem = ins.historia.length ? Math.round(ins.historia.slice(-4).reduce((a, h) => a + h.piezas, 0) / Math.min(4, ins.historia.length)) : 0;
    const base4 = { piezas: piezasSem * 4, utilidad: puntos.reduce((a, p) => a + p.centralCent, 0n), ventas: ins.historia.length ? (sumaBig(ins.historia.slice(-4).map((h) => h.ventasCent)) / BigInt(Math.min(4, ins.historia.length))) * 4n : 0n };
    for (const d of PARAMETROS.escenarios.deltasCostoCent) {
      const e = escenarioCosto({ piezasProyectadas: base4.piezas, utilidadProyectadaCent: base4.utilidad, ventasProyectadasCent: base4.ventas, deltaCostoCent: d, lineas: ins.inventario.map((m) => ({ modelo: m.modelo, contribPorPiezaCent: m.contribPorPiezaCent })) });
      const k = `esc.costo${d / 100n}`;
      if (e.emite) {
        L.agregar(`${k}.impacto`, `Escenario costo +${d / 100n}: impacto`, e.datos.impactoCent, 'cent', { ...base, clase: 'Escenario', fuente: e.metodo, n: e.ventana.n });
        L.agregar(`${k}.margen`, `Escenario costo +${d / 100n}: margen`, e.datos.margenNuevoBp, 'bp', { ...base, clase: 'Escenario', fuente: e.metodo, n: e.ventana.n });
        L.agregar(`${k}.lineas`, `Escenario costo +${d / 100n}: líneas bajo cero`, BigInt(e.datos.lineasBajoCero.length), 'n', { ...base, clase: 'Escenario', fuente: e.metodo, n: e.ventana.n });
        tornado.push({ id: k, etiqueta: `Costo +${d / 100n}`, deltaCent: e.datos.impactoCent });
      } else notas.push(`Escenario de costo: ${e.razon}`);
    }
    const prim = ins.clientes[0];
    const cl = [...ins.pedidos.reduce((m, p) => m.set(p.clienteId, (m.get(p.clienteId) ?? 0n) + p.lineas.reduce((s, l) => s + l.precioCent * BigInt(l.piezas), 0n)), new Map<string, bigint>()).entries()].sort((a, b) => (a[1] === b[1] ? cmpTexto(a[0], b[0]) : a[1] > b[1] ? -1 : 1));
    if (prim && cl[0]) {
      const semanal = serieSemanalContrib(ins, cl[0][0]);
      const esc = escenarioConcentracion(semanal);
      if (esc.emite) {
        L.agregar('esc.concentracion', 'Escenario: el cliente mayor se va 4 semanas', esc.datos.impactoCent, 'cent', { ...base, clase: 'Escenario', fuente: esc.metodo, n: esc.ventana.n });
        tornado.push({ id: 'esc.concentracion', etiqueta: 'Cliente mayor se va 4 semanas', deltaCent: esc.datos.impactoCent });
      } else notas.push(`Escenario de concentración: ${esc.razon}`);
    }
    const origen = ins.clientes.length ? ins.clientes[0]! : null;
    if (origen && piezasSem > 0) {
      const pzOrigen = origen.pedidos.reduce((a, p) => a + p.piezas, 0);
      const cOrigen = origen.pedidos.reduce((a, p) => a + p.contribCent, 0n);
      const uOrigen = pzOrigen > 0 ? cOrigen / BigInt(pzOrigen) : 0n;
      const uDestino = piezasSem > 0 ? contrib / BigInt(Math.max(1, modelos.reduce((a, m) => a + m.piezas, 0))) / 2n : 0n;
      const mz = escenarioMezcla({ piezasOrigenPeriodo: pzOrigen, puntosPct: PARAMETROS.escenarios.mezclaPuntosPct, uOrigenCent: uOrigen, uDestinoCent: uDestino });
      if (mz.emite) {
        L.agregar('esc.mezcla', 'Escenario: 10 puntos de volumen a clientes de menor margen', mz.datos.impactoCent, 'cent', { ...base, clase: 'Escenario', fuente: mz.metodo, n: mz.ventana.n });
        tornado.push({ id: 'esc.mezcla', etiqueta: 'Mezcla: 10 puntos de volumen', deltaCent: mz.datos.impactoCent });
      }
    }
    if (ins.flujo) {
      const fp = flujoCaja(ins.flujo);
      const deudores = [...ins.cartera].sort((a, b) => (a.saldoCent === b.saldoCent ? cmpTexto(a.cliente, b.cliente) : a.saldoCent > b.saldoCent ? -1 : 1)).slice(0, 2).map((d) => ({ semana: 1, montoCent: d.saldoCent }));
      if (fp.emite) {
        const r = escenarioRetrasoCobro(fp.datos, deudores);
        if (r.emite) {
          L.agregar('esc.retraso', 'Escenario: los 2 mayores deudores pagan 14 días tarde', r.datos.efectoCent, 'cent', { ...base, clase: 'Escenario', fuente: r.metodo, n: r.ventana.n });
          tornado.push({ id: 'esc.retraso', etiqueta: 'Retraso de cobro de 14 días', deltaCent: r.datos.efectoCent });
        }
      }
    }
  } else {
    notas.push(ema.razon);
    L.sinDatos('proy.central', 'Utilidad proyectada por semana', 'cent', { ...base, clase: 'Estimado', fuente: 'promedio móvil exponencial', n: PARAMETROS.minSemanasEma - ema.faltan, requeridos: PARAMETROS.minSemanasEma });
  }
  const est = estacionalidad(vNum(ins.ventasMensualesCent), (((Number(ins.mes.slice(5, 7)) - ins.ventasMensualesCent.length) % 12) + 12) % 12 + 1);
  if (!est.emite) notas.push(`Estacionalidad: ${est.razon}`);
  else L.agregar('est.meses', 'Meses de historia para estacionalidad', BigInt(est.ventana.n), 'n', { ...base, clase: est.clase, fuente: est.metodo, n: est.ventana.n });
  return { tablas, cascada, calor, bump, burbujas, tendencia, tornado, notas };
}

function serieSemanalContrib(ins: InsumosMensual, clienteId: string): bigint[] {
  const h = ins.clientes.find((c) => c.clienteId === clienteId);
  if (!h) return [];
  const porSemana = new Map<number, bigint>();
  for (const p of h.pedidos) {
    const k = Math.floor((Date.parse(`${ins.fin}T00:00:00Z`) - Date.parse(`${p.fecha}T00:00:00Z`)) / 86_400_000 / 7);
    porSemana.set(k, (porSemana.get(k) ?? 0n) + p.contribCent);
  }
  const claves = [...porSemana.keys()].sort((a, b) => b - a);
  return claves.map((k) => porSemana.get(k)!);
}
