// Calculos puros de la cuenta de Omar sobre lo que su propia vista le entrega (omar.v_mi_cuenta, liquidaciones y paquetes).
// Cada cifra tiene una segunda via de comprobacion para "Explicar este numero". Sin reloj: la fecha de hoy entra como parametro.
import { semanaReporte, sumarDias } from '../calendario';
import type { Explicacion } from '../catalogo/tipos';
import type { ConfiguracionOmar, LiquidacionOmar, MovimientoCuenta, PaqueteOmar } from './tipos';

const enSemana = (f: string, ini: string) => f >= ini && f <= sumarDias(ini, 6);

export interface ResumenSemana {
  semana_ini: string;
  semana_fin: string;
  renta_piezas: number;
  renta_cent: bigint;
  tomas_cent: bigint;
  /** Lo que los socios le pagaron en la semana. */
  recibido_cent: bigint;
  /** Lo que Omar pago a los socios en la semana. */
  pagado_cent: bigint;
}

export function resumenSemana(movs: readonly MovimientoCuenta[], semanaIni: string): ResumenSemana {
  const r: ResumenSemana = { semana_ini: semanaIni, semana_fin: sumarDias(semanaIni, 6), renta_piezas: 0, renta_cent: 0n, tomas_cent: 0n, recibido_cent: 0n, pagado_cent: 0n };
  for (const m of movs) {
    if (!enSemana(m.fecha, semanaIni)) continue;
    if (m.concepto === 'renta') {
      r.renta_cent += m.importe;
      r.renta_piezas += m.piezas ?? 0;
    } else if (m.concepto === 'toma') r.tomas_cent += -m.importe;
    else if (m.importe > 0n) r.recibido_cent += m.importe;
    else r.pagado_cent += -m.importe;
  }
  return r;
}

export function rentaAcumulada(movs: readonly MovimientoCuenta[]): { piezas: number; cent: bigint } {
  let piezas = 0;
  let cent = 0n;
  for (const m of movs) if (m.concepto === 'renta') { cent += m.importe; piezas += m.piezas ?? 0; }
  return { piezas, cent };
}

/** Renta agrupada por dia: nunca por pedido (el folio y el numero de pedidos son del negocio, no de Omar). */
export interface RentaDia { fecha: string; piezas: number; importe: bigint; ajuste: boolean }
export function rentaPorDia(movs: readonly MovimientoCuenta[], semanaIni: string): RentaDia[] {
  const mapa = new Map<string, RentaDia>();
  for (const m of movs) {
    if (m.concepto !== 'renta' || !enSemana(m.fecha, semanaIni)) continue;
    const dia = mapa.get(m.fecha) ?? { fecha: m.fecha, piezas: 0, importe: 0n, ajuste: false };
    dia.piezas += m.piezas ?? 0;
    dia.importe += m.importe;
    if ((m.piezas ?? 0) < 0) dia.ajuste = true;
    mapa.set(m.fecha, dia);
  }
  return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function pagosRecibidos(movs: readonly MovimientoCuenta[]): MovimientoCuenta[] {
  return movs.filter((m) => m.concepto === 'pago').sort((a, b) => b.fecha.localeCompare(a.fecha) || b.referencia.localeCompare(a.referencia));
}

export function tomasDeCuenta(movs: readonly MovimientoCuenta[]): MovimientoCuenta[] {
  return movs.filter((m) => m.concepto === 'toma').sort((a, b) => b.fecha.localeCompare(a.fecha) || b.referencia.localeCompare(a.referencia));
}

// ---------------------------------------------------------------- liquidacion

export type EstadoPagoLiquidacion = 'sin_saldo' | 'pendiente' | 'parcial' | 'pagada' | 'a_favor_de_socios';

/** Estado de una liquidacion cerrada: neto > 0 los socios deben pagarle; neto < 0 Omar debe pagar. Lo pagado se compara en valor absoluto del sentido que toca. */
export function estadoPago(l: Pick<LiquidacionOmar, 'neto_cent' | 'pagado_cent'>): { estado: EstadoPagoLiquidacion; falta_cent: bigint } {
  if (l.neto_cent === 0n) return { estado: 'sin_saldo', falta_cent: 0n };
  // Con signo del neto: un pago en el sentido correcto reduce el saldo.
  const falta = l.neto_cent > 0n ? l.neto_cent - l.pagado_cent : -l.neto_cent + l.pagado_cent;
  if (falta <= 0n) return { estado: 'pagada', falta_cent: 0n };
  const pagadoEnSentido = l.neto_cent > 0n ? l.pagado_cent : -l.pagado_cent;
  return { estado: pagadoEnSentido > 0n ? 'parcial' : 'pendiente', falta_cent: falta };
}

/** Comprobacion de una liquidacion: renta menos tomas igual al neto (segunda via: lo que la base guardo como neto). */
export function comprobarLiquidacion(l: LiquidacionOmar): { via1: bigint; via2: bigint; cuadra: boolean } {
  const via1 = l.renta_cent - l.tomas_cent + l.compensado_cent;
  return { via1, via2: l.neto_cent, cuadra: via1 === l.neto_cent };
}

/** Saldo con los socios: lo liquidado menos lo pagado, con signo (> 0 le deben a Omar). */
export function saldoAcumulado(liqs: readonly LiquidacionOmar[]): { saldo_cent: bigint; neto_total_cent: bigint; pagado_total_cent: bigint } {
  let neto = 0n;
  let pagado = 0n;
  for (const l of liqs) { neto += l.neto_cent; pagado += l.pagado_cent; }
  return { saldo_cent: neto - pagado, neto_total_cent: neto, pagado_total_cent: pagado };
}

// ---------------------------------------------------------------- proyeccion

export interface Proyeccion {
  /** Siempre 'Estimado'. */
  etiqueta: 'Estimado';
  semana_ini: string;
  devengado_cent: bigint;
  por_enviar_piezas: number;
  tarifa_cent: bigint;
  /** Rango: piso = lo ya devengado; techo = devengado + todo lo pendiente de enviar a la tarifa. */
  minimo_cent: bigint;
  maximo_cent: bigint;
  /** Lo que se le deberia pagar al corte: renta estimada (techo) menos sus tomas ya autorizadas de la semana. */
  tomas_cent: bigint;
  neto_estimado_cent: bigint;
  neto_minimo_cent: bigint;
}

export type ResultadoProyeccion = { tipo: 'proyeccion'; datos: Proyeccion } | { tipo: 'sin_dato'; motivo: 'sin_tarifa' | 'sin_historia' | 'sin_paquetes' };

/** Tarifa por pieza: la de la configuracion o, si no esta, la ultima tarifa de renta observada en la cuenta. */
export function tarifaPorPieza(movs: readonly MovimientoCuenta[], cfg: Pick<ConfiguracionOmar, 'renta_por_pieza_cent'>): bigint | null {
  if (cfg.renta_por_pieza_cent !== null && cfg.renta_por_pieza_cent > 0n) return cfg.renta_por_pieza_cent;
  const filas = movs.filter((m) => m.concepto === 'renta' && m.tarifa !== null && m.tarifa > 0n).sort((a, b) => b.fecha.localeCompare(a.fecha));
  return filas[0]?.tarifa ?? null;
}

/** Proyeccion de la semana en curso. Sin tarifa o sin NINGUNA historia (renta previa o paquetes) no se emite: se dice "Sin dato". */
export function proyectarSemana(entrada: { movs: readonly MovimientoCuenta[]; paquetes: readonly PaqueteOmar[] | null; cfg: Pick<ConfiguracionOmar, 'renta_por_pieza_cent'>; hoy: string }): ResultadoProyeccion {
  const ini = semanaReporte(entrada.hoy).inicio;
  const tarifa = tarifaPorPieza(entrada.movs, entrada.cfg);
  if (tarifa === null) return { tipo: 'sin_dato', motivo: 'sin_tarifa' };
  if (entrada.paquetes === null) return { tipo: 'sin_dato', motivo: 'sin_paquetes' };
  const rentas = entrada.movs.filter((m) => m.concepto === 'renta');
  const porEnviar = entrada.paquetes.filter((p) => p.tipo === 'salida').reduce((s, p) => s + p.renglones.reduce((a, r) => a + r.piezas, 0), 0);
  if (rentas.length === 0 && porEnviar === 0) return { tipo: 'sin_dato', motivo: 'sin_historia' };
  const sem = resumenSemana(entrada.movs, ini);
  const maximo = sem.renta_cent + BigInt(porEnviar) * tarifa;
  return {
    tipo: 'proyeccion',
    datos: {
      etiqueta: 'Estimado', semana_ini: ini, devengado_cent: sem.renta_cent, por_enviar_piezas: porEnviar, tarifa_cent: tarifa,
      minimo_cent: sem.renta_cent, maximo_cent: maximo, tomas_cent: sem.tomas_cent,
      neto_estimado_cent: maximo - sem.tomas_cent, neto_minimo_cent: sem.renta_cent - sem.tomas_cent,
    },
  };
}

// ---------------------------------------------------------------- explicar este numero

const CIFRA = /^omar:(renta|tomas|recibido):(\d{4}-\d{2}-\d{2})$|^omar:(renta-acumulada|saldo)$/;

export function cifraExplicable(c: string): boolean {
  return CIFRA.test(c);
}

type Renglon = Explicacion['renglones'][number];
const renglon = (m: MovimientoCuenta, concepto: string, monto: bigint): Renglon => ({ concepto, montoCent: monto, saldoCent: null, hora: null, fechaNeg: m.fecha, evento: m.referencia, canal: null, autor: null, mensajeOrigen: null });

/** Explicacion de una cifra de Omar construida SOLO con lo que su vista le entrega. Segunda via: suma por dia contra suma por renglon. */
export function explicarCifraOmar(cifra: string, movs: readonly MovimientoCuenta[], liqs: readonly LiquidacionOmar[]): Explicacion | null {
  const base = { cifra, unidad: 'mxn' as const, movimientos: [], precioCent: null, costos: [] };
  const m = CIFRA.exec(cifra);
  if (!m) return null;
  if (m[1]) {
    const ini = m[2]!;
    const filas = movs.filter((x) => enSemana(x.fecha, ini) && (m[1] === 'renta' ? x.concepto === 'renta' : m[1] === 'tomas' ? x.concepto === 'toma' : x.concepto === 'pago' && x.importe > 0n));
    const signo = m[1] === 'tomas' ? -1n : 1n;
    const via1 = filas.reduce((s, x) => s + signo * x.importe, 0n);
    const r = resumenSemana(movs, ini);
    const via2 = m[1] === 'renta' ? r.renta_cent : m[1] === 'tomas' ? r.tomas_cent : r.recibido_cent;
    const titulo = m[1] === 'renta' ? 'Renta devengada de la semana' : m[1] === 'tomas' ? 'Tus tomas de la semana' : 'Pagos recibidos en la semana';
    return { ...base, titulo, valor: Number(via1), comprobacion: { via1: 'Suma de los renglones de la semana', via1Valor: Number(via1), via2: 'Total de la semana en tu cuenta', via2Valor: Number(via2), cuadra: via1 === via2 }, renglones: filas.map((x) => renglon(x, x.concepto === 'renta' ? `Renta ${x.piezas ?? 0} pz` : x.concepto === 'toma' ? `Toma ${x.modelo ?? ''} ${x.piezas ?? 0} pz` : 'Pago recibido', signo * x.importe)) };
  }
  if (m[3] === 'renta-acumulada') {
    const a = rentaAcumulada(movs);
    const viaDias = movs.filter((x) => x.concepto === 'renta').reduce((s, x) => s + x.importe, 0n);
    return { ...base, titulo: 'Renta devengada acumulada', valor: Number(a.cent), comprobacion: { via1: 'Suma de la renta de tu cuenta', via1Valor: Number(a.cent), via2: 'Suma renglón por renglón', via2Valor: Number(viaDias), cuadra: a.cent === viaDias }, renglones: movs.filter((x) => x.concepto === 'renta').map((x) => renglon(x, `Renta ${x.piezas ?? 0} pz`, x.importe)) };
  }
  const s = saldoAcumulado(liqs);
  return { ...base, titulo: 'Saldo de tu cuenta', valor: Number(s.saldo_cent), comprobacion: { via1: 'Liquidado menos pagado', via1Valor: Number(s.saldo_cent), via2: 'Neto de liquidaciones menos pagos aplicados', via2Valor: Number(s.neto_total_cent - s.pagado_total_cent), cuadra: s.saldo_cent === s.neto_total_cent - s.pagado_total_cent }, renglones: liqs.map((l) => ({ concepto: `Liquidación ${l.folio} (neto)`, montoCent: l.neto_cent, saldoCent: null, hora: null, fechaNeg: l.fecha_cierre, evento: l.folio, canal: null, autor: null, mensajeOrigen: null })) };
}
