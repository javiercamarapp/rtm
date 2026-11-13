// Proyecciones honestas (spec 16, sec. 4). Reglas: toda proyeccion lleva la palabra Estimado, metodo, ventana, rango y "no es garantia";
// con muestra menor al minimo NO SE EMITE ("No se estima: faltan N semanas (minimo M)"). El modelo de lenguaje nunca interviene.
// La estadistica usa numeros de punto flotante sobre centavos; las salidas de dinero se redondean a bigint al construir cifras.
import { sumarDias } from '../calendario';
import type { FlujoInsumo } from './insumos';
import { PARAMETROS } from './parametros';
import { desvEstandar, mediaNum, medianaNum, percentil } from './util';

export interface NoEmite {
  readonly emite: false;
  readonly razon: string;
  readonly faltan: number;
  readonly minimo: number;
}
export interface Emite<T> {
  readonly emite: true;
  readonly clase: 'Observado' | 'Estimado' | 'Escenario' | 'Declarado';
  readonly metodo: string;
  readonly ventana: { readonly n: number; readonly desde?: string; readonly hasta?: string };
  readonly leyenda: string;
  readonly datos: T;
}
export type Proyeccion<T> = Emite<T> | NoEmite;

export const LEYENDA_ESTIMADO = 'Estimado; no es garantía';
export const LEYENDA_ESCENARIO = 'Escenario; supuesto explícito, sin probabilidad';

export function noSeEstima(faltan: number, minimo: number, unidad = 'semanas'): NoEmite {
  return { emite: false, faltan, minimo, razon: `No se estima: faltan ${faltan} ${unidad} (mínimo ${minimo})` };
}

function ventanaDe(n: number, inicios?: readonly string[]): Emite<never>['ventana'] {
  if (!inicios || inicios.length === 0) return { n };
  return { n, desde: inicios[Math.max(0, inicios.length - n)]!, hasta: sumarDias(inicios[inicios.length - 1]!, 6) };
}

// ---------- Promedio movil exponencial con rango ----------

export interface PuntoProyectado {
  readonly h: number;
  readonly central: number;
  readonly lo: number;
  readonly hi: number;
}
export interface DatosEma {
  readonly central: number;
  readonly sigma: number;
  readonly errores: number;
  readonly puntos: readonly PuntoProyectado[];
}

/** s_t = a*x_t + (1-a)*s_{t-1}; semana recortada al percentil 90; rango s +- 1.28*sigma*sqrt(h) con sigma de los ultimos 5 a 8 errores. */
export function promedioMovilExponencial(serie: readonly (number | null)[], horizonte: number, inicios?: readonly string[]): Proyeccion<DatosEma> {
  const { alfaEma, ventanaEma, minSemanasEma, minErroresRango, maxErroresRango, z80 } = PARAMETROS;
  const ventana = serie.slice(-ventanaEma);
  const datos = ventana.filter((x): x is number => x !== null && Number.isFinite(x));
  if (datos.length < minSemanasEma) return noSeEstima(minSemanasEma - datos.length, minSemanasEma);
  const tope = percentil(datos, 0.9);
  const x = datos.map((v) => Math.min(v, tope));
  let s = x[0]!;
  const errores: number[] = [];
  for (let t = 1; t < x.length; t++) {
    errores.push(x[t]! - s);
    s = alfaEma * x[t]! + (1 - alfaEma) * s;
  }
  if (errores.length < minErroresRango) return noSeEstima(minErroresRango - errores.length, minErroresRango, 'errores');
  const sigma = desvEstandar(errores.slice(-maxErroresRango));
  const puntos: PuntoProyectado[] = [];
  for (let h = 1; h <= horizonte; h++) puntos.push({ h, central: s, lo: s - z80 * sigma * Math.sqrt(h), hi: s + z80 * sigma * Math.sqrt(h) });
  return { emite: true, clase: 'Estimado', metodo: `promedio móvil exponencial, α = ${alfaEma}`, ventana: ventanaDe(datos.length, inicios), leyenda: LEYENDA_ESTIMADO, datos: { central: s, sigma, errores: errores.length, puntos } };
}

// ---------- Tendencia lineal con intervalo ----------

/** Cuantil 0.90 de la t de Student (intervalo de 80 % a dos colas) por grados de libertad. */
const T90 = [0, 3.078, 1.886, 1.638, 1.533, 1.476, 1.44, 1.415, 1.397, 1.383, 1.372, 1.363, 1.356, 1.35, 1.345, 1.341, 1.337, 1.333, 1.33, 1.328, 1.325, 1.323, 1.321, 1.319, 1.318, 1.316, 1.315, 1.314, 1.313, 1.311, 1.31];
export const t90 = (gl: number): number => (gl < 1 ? Number.POSITIVE_INFINITY : gl <= 30 ? T90[gl]! : 1.282);

export interface DatosTendencia {
  readonly pendiente: number;
  readonly t: number;
  readonly usaTendencia: boolean;
  readonly motivo: string;
  readonly puntos: readonly PuntoProyectado[];
}

export function tendenciaLineal(serie: readonly number[], horizonte: number, inicios?: readonly string[]): Proyeccion<DatosTendencia> {
  const { minSemanas, maxSemanas, tMinimo, horizonteMax } = PARAMETROS.tendencia;
  if (serie.length < minSemanas) return noSeEstima(minSemanas - serie.length, minSemanas);
  if (horizonte > horizonteMax) return { emite: false, faltan: 0, minimo: horizonteMax, razon: `No se estima: el horizonte máximo es ${horizonteMax} semanas` };
  const y = serie.slice(-maxSemanas);
  const n = y.length;
  const xs = y.map((_, i) => i);
  const xm = mediaNum(xs);
  const ym = mediaNum(y);
  const sxx = xs.reduce((a, v) => a + (v - xm) ** 2, 0);
  const b = xs.reduce((a, v, i) => a + (v - xm) * (y[i]! - ym), 0) / sxx;
  const a0 = ym - b * xm;
  const sse = y.reduce((a, v, i) => a + (v - (a0 + b * xs[i]!)) ** 2, 0);
  const s = Math.sqrt(sse / (n - 2));
  const t = s === 0 ? (b === 0 ? 0 : Number.POSITIVE_INFINITY) : b / (s / Math.sqrt(sxx));
  const usa = Math.abs(t) >= tMinimo;
  const puntos: PuntoProyectado[] = [];
  if (usa) {
    for (let h = 1; h <= horizonte; h++) {
      const xh = n - 1 + h;
      const centro = a0 + b * xh;
      const m = t90(n - 2) * s * Math.sqrt(1 + 1 / n + (xh - xm) ** 2 / sxx);
      puntos.push({ h, central: centro, lo: centro - m, hi: centro + m });
    }
  }
  return {
    emite: true,
    clase: 'Estimado',
    metodo: 'tendencia lineal (mínimos cuadrados) con intervalo al 80 %',
    ventana: ventanaDe(n, inicios),
    leyenda: LEYENDA_ESTIMADO,
    datos: { pendiente: b, t, usaTendencia: usa, motivo: usa ? 'tendencia significativa' : 'sin tendencia clara: se usa el promedio', puntos },
  };
}

// ---------- Estacionalidad ----------

export interface DatosEstacionalidad {
  /** Indice por mes calendario (1..12) en puntos base: 10000 = igual al promedio anual. */
  readonly indiceBp: Readonly<Record<number, number>>;
  readonly aplicable: boolean;
}

/** 12 meses: solo descriptiva (Observado, no se aplica); 24 meses: se aplica. `mesInicial` es el mes calendario (1..12) del primer dato. */
export function estacionalidad(ventasMensuales: readonly number[], mesInicial: number): Proyeccion<DatosEstacionalidad> {
  const { minMesesDescriptiva, minMesesAplicada } = PARAMETROS.estacionalidad;
  if (ventasMensuales.length < minMesesDescriptiva) return noSeEstima(minMesesDescriptiva - ventasMensuales.length, minMesesDescriptiva, 'meses');
  const aplicable = ventasMensuales.length >= minMesesAplicada;
  const usadas = ventasMensuales.slice(-(aplicable ? 24 : 12));
  const anios = usadas.length / 12;
  const prom = (xs: readonly number[]) => mediaNum(xs);
  const indice: Record<number, number> = {};
  for (let k = 0; k < 12; k++) {
    const mes = ((mesInicial - 1 + (ventasMensuales.length - usadas.length) + k) % 12) + 1;
    const vals: number[] = [];
    for (let a = 0; a < anios; a++) {
      const bloque = usadas.slice(a * 12, a * 12 + 12);
      vals.push(bloque[k]! / prom(bloque));
    }
    indice[mes] = Math.round(prom(vals) * 10_000);
  }
  return { emite: true, clase: aplicable ? 'Estimado' : 'Observado', metodo: aplicable ? 'índice mensual, 24 meses (se aplica)' : 'índice mensual, 12 meses (solo descriptivo)', ventana: { n: usadas.length }, leyenda: aplicable ? LEYENDA_ESTIMADO : 'Descriptivo; no se aplica a la proyección', datos: { indiceBp: indice, aplicable } };
}

// ---------- Punto de reorden y cobertura ----------

export interface EntradaReorden {
  readonly ventasSemanales: readonly number[];
  readonly existencia: number;
  readonly enTransito: number;
  readonly leadTime: { readonly dias: number; readonly reposiciones: number; readonly declarado: boolean };
  readonly piezasPorCaja: number;
}
export interface DatosReorden {
  readonly demandaDiaria: number;
  readonly demandaLo: number;
  readonly demandaHi: number;
  readonly sigmaDiaria: number;
  readonly puntoReorden: number;
  readonly stockSeguridad: number;
  readonly coberturaDias: number | null;
  readonly coberturaLo: number | null;
  readonly coberturaHi: number | null;
  readonly pedir: number;
  readonly debeReponer: boolean;
}

export function puntoReorden(e: EntradaReorden): Proyeccion<DatosReorden> {
  const r = PARAMETROS.reorden;
  if (e.ventasSemanales.length < r.minSemanasModelo) return noSeEstima(r.minSemanasModelo - e.ventasSemanales.length, r.minSemanasModelo);
  const conVenta = e.ventasSemanales.filter((v) => v > 0).length;
  if (conVenta < r.minSemanasConVenta) return noSeEstima(r.minSemanasConVenta - conVenta, r.minSemanasConVenta, 'semanas con venta');
  const piezas = e.ventasSemanales.reduce((a, b) => a + b, 0);
  if (piezas < r.minPiezas) return noSeEstima(r.minPiezas - piezas, r.minPiezas, 'piezas');
  if (!e.leadTime.declarado && e.leadTime.reposiciones < r.minReposicionesLT) return noSeEstima(r.minReposicionesLT - e.leadTime.reposiciones, r.minReposicionesLT, 'reposiciones');
  const ventana = e.ventasSemanales.slice(-PARAMETROS.ventanaEma);
  const tope = percentil(ventana, 0.9);
  const recortada = ventana.map((v) => Math.min(v, tope));
  let s = recortada[0]!;
  for (let i = 1; i < recortada.length; i++) s = PARAMETROS.alfaEma * recortada[i]! + (1 - PARAMETROS.alfaEma) * s;
  const d = s / 7;
  const sigmaSem = desvEstandar(ventana);
  const sigmaD = sigmaSem / Math.sqrt(7);
  const lt = e.leadTime.dias;
  const ss = r.z * sigmaD * Math.sqrt(lt);
  const rop = d * lt + ss;
  const ee = (r.z * sigmaSem) / 7 / Math.sqrt(ventana.length);
  const dLo = Math.max(0, d - ee);
  const dHi = d + ee;
  const cob = (dd: number) => (dd > 0 ? e.existencia / dd : null);
  const bruto = d * (lt + r.revisionDias) + ss - e.existencia - e.enTransito;
  const cajas = bruto > 0 ? Math.ceil(bruto / e.piezasPorCaja) : 0;
  return {
    emite: true,
    clase: 'Estimado',
    metodo: `promedio móvil exponencial de ${ventana.length} semanas, z = ${r.z}`,
    ventana: { n: ventana.length },
    leyenda: LEYENDA_ESTIMADO,
    datos: {
      demandaDiaria: d,
      demandaLo: dLo,
      demandaHi: dHi,
      sigmaDiaria: sigmaD,
      puntoReorden: rop,
      stockSeguridad: ss,
      coberturaDias: cob(d),
      coberturaLo: cob(dHi),
      coberturaHi: cob(dLo),
      pedir: cajas * e.piezasPorCaja,
      debeReponer: e.existencia + e.enTransito <= rop,
    },
  };
}

// ---------- Proximo pedido de un cliente ----------

export function diasEntre(a: string, b: string): number {
  const f = (t: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) throw new RangeError(`fecha invalida: ${t}`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((f(b) - f(a)) / 86_400_000);
}

export interface DatosProximoPedido {
  readonly fecha: string;
  readonly desde: string;
  readonly hasta: string;
  readonly medianaIntervalo: number;
}
export function proximoPedido(fechas: readonly string[]): Proyeccion<DatosProximoPedido> {
  const min = PARAMETROS.proximoPedido.minPedidos;
  if (fechas.length < min) return noSeEstima(min - fechas.length, min, 'pedidos');
  const orden = [...fechas].sort();
  const intervalos = orden.slice(1).map((f, i) => diasEntre(orden[i]!, f));
  const ultimo = orden[orden.length - 1]!;
  const med = Math.round(medianaNum(intervalos));
  return {
    emite: true,
    clase: 'Estimado',
    metodo: 'último pedido más la mediana de intervalos; rango en cuartiles',
    ventana: { n: fechas.length },
    leyenda: LEYENDA_ESTIMADO,
    datos: { fecha: sumarDias(ultimo, med), desde: sumarDias(ultimo, Math.round(percentil(intervalos, 0.25))), hasta: sumarDias(ultimo, Math.round(percentil(intervalos, 0.75))), medianaIntervalo: med },
  };
}

// ---------- Flujo de caja a 4 semanas ----------

export interface SemanaFlujo {
  readonly semana: number;
  readonly clase: 'Observado' | 'Estimado' | 'Declarado';
  readonly cobrosCent: bigint;
  readonly cobrosLoCent: bigint;
  readonly cobrosHiCent: bigint;
  readonly pagosProvCent: bigint;
  readonly omarCent: bigint;
  readonly gastosCent: bigint;
  readonly saldoCent: bigint;
  readonly saldoLoCent: bigint;
  readonly saldoHiCent: bigint;
}
export interface DatosFlujo {
  readonly semanas: readonly SemanaFlujo[];
  readonly saldoMinimoCent: bigint;
  readonly origenCobros: 'historia' | 'declarado';
}

const num = (b: bigint) => Number(b);
const aBig = (x: number) => BigInt(Math.round(x));
const mayor = (a: bigint, b: bigint) => (a > b ? a : b);

/** Saldo_t = Saldo_{t-1} + Cobros_t - Proveedores_t - Omar_t - Gastos_t. Cobros: lo prometido es exacto; el resto es estimado con rango. */
export function flujoCaja(f: FlujoInsumo): Proyeccion<DatosFlujo> {
  const { minSemanasCobros, semanas } = PARAMETROS.flujo;
  const hist = f.cobrosSemanalesCent.map(num);
  let base: number;
  let lo: number;
  let hi: number;
  let origen: 'historia' | 'declarado';
  if (hist.length >= minSemanasCobros) {
    const w = hist.slice(-minSemanasCobros);
    const p10 = percentil(w, 0.1);
    const p90 = percentil(w, 0.9);
    const rec = w.map((v) => Math.min(Math.max(v, p10), p90));
    let s = rec[0]!;
    for (let i = 1; i < rec.length; i++) s = PARAMETROS.alfaEma * rec[i]! + (1 - PARAMETROS.alfaEma) * s;
    base = s;
    lo = Math.min(...rec);
    hi = Math.max(...rec);
    origen = 'historia';
  } else if (f.cadenciaDeclaradaCent) {
    base = num(f.cadenciaDeclaradaCent.semanaCent);
    lo = base * (1 - f.cadenciaDeclaradaCent.rangoPct / 100);
    hi = base * (1 + f.cadenciaDeclaradaCent.rangoPct / 100);
    origen = 'declarado';
  } else {
    return noSeEstima(minSemanasCobros - hist.length, minSemanasCobros);
  }
  const salida: SemanaFlujo[] = [];
  let saldo = f.saldoInicialCent;
  let saldoLo = f.saldoInicialCent;
  let saldoHi = f.saldoInicialCent;
  for (let i = 0; i < semanas; i++) {
    const prometido = f.cobrosPrometidosCent[i] ?? 0n;
    const c = mayor(prometido, aBig(base));
    const cLo = mayor(prometido, aBig(lo));
    const cHi = mayor(prometido, aBig(hi));
    const salidas = (f.pagosProveedorCent[i] ?? 0n) + (f.omarCent[i] ?? 0n) + (f.gastosCent[i] ?? 0n);
    saldo += c - salidas;
    saldoLo += cLo - salidas;
    saldoHi += cHi - salidas;
    salida.push({
      semana: i + 1,
      clase: i === 0 && prometido >= c ? 'Observado' : origen === 'declarado' ? 'Declarado' : 'Estimado',
      cobrosCent: c,
      cobrosLoCent: cLo,
      cobrosHiCent: cHi,
      pagosProvCent: f.pagosProveedorCent[i] ?? 0n,
      omarCent: f.omarCent[i] ?? 0n,
      gastosCent: f.gastosCent[i] ?? 0n,
      saldoCent: saldo,
      saldoLoCent: saldoLo,
      saldoHiCent: saldoHi,
    });
  }
  const minimo = salida.reduce((m, s) => (s.saldoLoCent < m ? s.saldoLoCent : m), salida[0]!.saldoLoCent);
  return {
    emite: true,
    clase: origen === 'declarado' ? 'Declarado' : 'Estimado',
    metodo: origen === 'declarado' ? 'cadencia declarada por un socio con rango; se reemplaza con datos propios' : 'promedio móvil exponencial de cobros de 8 semanas; rango = mínimo y máximo recortados',
    ventana: { n: origen === 'historia' ? minSemanasCobros : 0 },
    leyenda: origen === 'declarado' ? 'Declarado, no observado; no es garantía' : LEYENDA_ESTIMADO,
    datos: { semanas: salida, saldoMinimoCent: minimo, origenCobros: origen },
  };
}

/** Cobertura del viernes L1 = (fondos + cobros esperados hasta el viernes) / saldo por pagar al proveedor, en milesimas. Null si no hay saldo por pagar. */
export function coberturaViernes(fondosCent: bigint, cobrosEsperadosCent: bigint, saldoPorPagarCent: bigint): bigint | null {
  if (saldoPorPagarCent <= 0n) return null;
  return ((fondosCent + cobrosEsperadosCent) * 1000n) / saldoPorPagarCent;
}

/**
 * Etiqueta de la cobertura del viernes (milesimas), con los umbrales documentados en la plantilla I21 y en PARAMETROS:
 * desde 1.2 veces cubierto; de 1.0 a menos de 1.2 justo; menos de 1.0 insuficiente (no alcanza para liquidar).
 */
export function etiquetaCobertura(coberturaMilesimas: bigint): { etiqueta: 'Cubierto' | 'Justo' | 'Insuficiente'; tono: 'ok' | 'atencion' | 'malo' } {
  if (coberturaMilesimas >= PARAMETROS.coberturaViernesVerde) return { etiqueta: 'Cubierto', tono: 'ok' };
  if (coberturaMilesimas >= PARAMETROS.coberturaViernesAlerta) return { etiqueta: 'Justo', tono: 'atencion' };
  return { etiqueta: 'Insuficiente', tono: 'malo' };
}

// ---------- Fin de mes de Omar ----------

export interface DatosFinMes {
  readonly centralCent: bigint;
  readonly loCent: bigint;
  readonly hiCent: bigint;
}
/** d = piezas de bodega en 28 dias / 28; saldo + transito*$2 + (d*dias restantes - transito)*$2. Minimo 14 dias de historia. */
export function finDeMesOmar(e: { saldoCent: bigint; piezas28: number; diasHistoria: number; diasRestantes: number; enTransito: number; sigmaDiaria: number }): Proyeccion<DatosFinMes> {
  const min = PARAMETROS.finMesOmar.minDias;
  if (e.diasHistoria < min) return noSeEstima(min - e.diasHistoria, min, 'días');
  const renta = PARAMETROS.finMesOmar.renta;
  const d = e.piezas28 / 28;
  const futuras = d * e.diasRestantes - e.enTransito;
  const central = e.saldoCent + BigInt(e.enTransito) * renta + aBig(futuras * Number(renta));
  const m = aBig(PARAMETROS.z80 * e.sigmaDiaria * Math.sqrt(e.diasRestantes) * Number(renta));
  return { emite: true, clase: 'Estimado', metodo: 'promedio de 28 días de piezas de bodega', ventana: { n: e.diasHistoria }, leyenda: LEYENDA_ESTIMADO, datos: { centralCent: central, loCent: central - m, hiCent: central + m } };
}

// ---------- Escenarios de sensibilidad (sin probabilidad) ----------

const escenario = <T>(metodo: string, n: number, datos: T): Emite<T> => ({ emite: true, clase: 'Escenario', metodo, ventana: { n }, leyenda: LEYENDA_ESCENARIO, datos });

export interface DatosEscenarioCosto {
  readonly deltaCostoCent: bigint;
  readonly impactoCent: bigint;
  readonly utilidadNuevaCent: bigint;
  readonly margenNuevoBp: bigint;
  readonly lineasBajoCero: readonly string[];
}
/** Delta = -dc * piezas proyectadas. Lista las lineas (modelos) que pasan a margen < 0. */
export function escenarioCosto(e: { piezasProyectadas: number; utilidadProyectadaCent: bigint; ventasProyectadasCent: bigint; deltaCostoCent: bigint; lineas: readonly { modelo: string; contribPorPiezaCent: bigint }[] }): Proyeccion<DatosEscenarioCosto> {
  if (e.piezasProyectadas <= 0 || e.ventasProyectadasCent <= 0n) return noSeEstima(1, 1, 'base válida');
  const impacto = -e.deltaCostoCent * BigInt(e.piezasProyectadas);
  const nueva = e.utilidadProyectadaCent + impacto;
  const margen = (nueva * 10_000n) / e.ventasProyectadasCent;
  return escenario(`costo +${e.deltaCostoCent / 100n} por pieza`, e.piezasProyectadas, {
    deltaCostoCent: e.deltaCostoCent,
    impactoCent: impacto,
    utilidadNuevaCent: nueva,
    margenNuevoBp: margen,
    lineasBajoCero: e.lineas.filter((l) => l.contribPorPiezaCent - e.deltaCostoCent < 0n).map((l) => l.modelo),
  });
}

/** Mueve `puntosPct` del volumen de un cliente a otros: delta = piezas movidas * (u_destino - u_origen). */
export function escenarioMezcla(e: { piezasOrigenPeriodo: number; puntosPct: number; uOrigenCent: bigint; uDestinoCent: bigint }): Proyeccion<{ piezasMovidas: number; impactoCent: bigint }> {
  if (e.piezasOrigenPeriodo <= 0) return noSeEstima(1, 1, 'base válida');
  const movidas = Math.round((e.piezasOrigenPeriodo * e.puntosPct) / 100);
  return escenario(`${e.puntosPct} puntos de volumen a clientes de menor margen`, e.piezasOrigenPeriodo, { piezasMovidas: movidas, impactoCent: BigInt(movidas) * (e.uDestinoCent - e.uOrigenCent) });
}

/** El cliente mayor desaparece 4 semanas: delta = -mediana de su contribucion semanal (13 sem) * 4. Con menos de 13 semanas se usa la ultima observada, rotulado. */
export function escenarioConcentracion(contribSemanalCent: readonly bigint[]): Proyeccion<{ impactoCent: bigint; baseRotulada: boolean }> {
  const { semanasConcentracion, minSemanasConcentracion } = PARAMETROS.escenarios;
  if (contribSemanalCent.length === 0) return noSeEstima(1, minSemanasConcentracion);
  const completa = contribSemanalCent.length >= minSemanasConcentracion;
  const base = completa ? aBig(medianaNum(contribSemanalCent.slice(-minSemanasConcentracion).map(num))) : contribSemanalCent[contribSemanalCent.length - 1]!;
  return escenario(completa ? 'mediana semanal de 13 semanas por 4 semanas' : 'última semana observada por 4 semanas (historia corta, rotulado)', contribSemanalCent.length, { impactoCent: -base * BigInt(semanasConcentracion), baseRotulada: !completa });
}

/** Retraso de cobro: los mayores deudores pagan 14 dias (2 semanas) tarde; efecto en el saldo minimo del flujo. */
export function escenarioRetrasoCobro(flujo: DatosFlujo, deudores: readonly { semana: number; montoCent: bigint }[]): Proyeccion<{ saldoMinimoCent: bigint; efectoCent: bigint }> {
  if (flujo.semanas.length === 0) return noSeEstima(1, 1, 'base válida');
  const dias = PARAMETROS.escenarios.retrasoCobroDias;
  const corrimiento = Math.round(dias / 7);
  const saldos = flujo.semanas.map((s) => s.saldoCent);
  for (const d of deudores) {
    for (let i = 0; i < saldos.length; i++) {
      const semana = i + 1;
      if (semana >= d.semana && semana < d.semana + corrimiento) saldos[i] = saldos[i]! - d.montoCent;
    }
  }
  const min = saldos.reduce((m, s) => (s < m ? s : m), saldos[0]!);
  const base = flujo.semanas.reduce((m, s) => (s.saldoCent < m ? s.saldoCent : m), flujo.semanas[0]!.saldoCent);
  return escenario(`los mayores deudores pagan ${dias} días tarde`, deudores.length, { saldoMinimoCent: min, efectoCent: min - base });
}
