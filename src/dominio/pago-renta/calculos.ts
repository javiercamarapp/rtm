// Calculos puros del Pago de renta: agrupar la serie diaria por dia, semana o mes, estadisticas (ritmo, mejor dia, comparacion con el mes anterior, tendencia),
// puntos de la banda de proyeccion y frases de insight con plantilla fija. Sin reloj ni azar: la fecha de hoy entra como parametro.
// El dinero de la proyeccion lo calcula la base (operacion.renta_proyeccion); aqui solo se reparte para dibujar.
import { diaSemanaLunes0, sumarDias } from '../calendario';
import { formatearEntero, formatearMoneda, formatearPiezas } from '../formato';
import type { DiaRenta, EstadoRenta, PagoRenta, Proyeccion } from './tipos';

export type Paso = 'dia' | 'semana' | 'mes';
export const PASOS: readonly Paso[] = ['dia', 'semana', 'mes'];
export const esPaso = (v: string | undefined): v is Paso => v === 'dia' || v === 'semana' || v === 'mes';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const diasEntre = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const primeroDeMes = (f: string): string => `${f.slice(0, 8)}01`;
const mesAnteriorIni = (f: string): string => primeroDeMes(sumarDias(primeroDeMes(f), -1));
const corta = (f: string): string => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]}`;
const etiquetaMes = (f: string): string => `${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(2, 4)}`;

/** "480 piezas x $2.00 = $960.00". Si la tarifa cambio durante el periodo, la regla no explica el devengado y se dice. */
export function reglaDeCalculo(e: Pick<EstadoRenta, 'piezas' | 'tarifa_cent' | 'devengado_cent' | 'regla_exacta'>): string {
  if (e.tarifa_cent === null) return 'Sin tarifa configurada';
  const base = `${formatearEntero(e.piezas)} piezas × ${formatearMoneda(e.tarifa_cent)}`;
  return e.regla_exacta ? `${base} = ${formatearMoneda(e.devengado_cent)}` : `${base} a la tarifa vigente; el devengado real es ${formatearMoneda(e.devengado_cent)} porque la tarifa cambio`;
}

// ---------------------------------------------------------------- agrupacion por periodo

export interface Cubeta { id: string; ini: string; fin: string; etiqueta: string; piezas: number; renta_cent: bigint; parcial: boolean }

function inicioDeCubeta(f: string, paso: Paso): string {
  if (paso === 'dia') return f;
  if (paso === 'semana') return sumarDias(f, -diaSemanaLunes0(f));
  return primeroDeMes(f);
}
function finDeCubeta(ini: string, paso: Paso): string {
  if (paso === 'dia') return ini;
  if (paso === 'semana') return sumarDias(ini, 6);
  return sumarDias(primeroDeMes(sumarDias(ini, 32)), -1);
}
/** Cubetas contiguas (con ceros) que terminan en la de hoy: 30 dias, 12 semanas o 12 meses. */
export function agruparPorPeriodo(serie: readonly DiaRenta[], hoy: string, paso: Paso, cuantas = paso === 'dia' ? 30 : 12): Cubeta[] {
  const ultima = inicioDeCubeta(hoy, paso);
  const inis: string[] = [ultima];
  while (inis.length < cuantas) {
    const prev = inis[0]!;
    inis.unshift(paso === 'mes' ? primeroDeMes(sumarDias(prev, -1)) : sumarDias(prev, paso === 'semana' ? -7 : -1));
  }
  return inis.map((ini) => {
    const fin = finDeCubeta(ini, paso);
    let piezas = 0;
    let renta = 0n;
    for (const d of serie) if (d.fecha >= ini && d.fecha <= fin) { piezas += d.piezas; renta += d.renta_cent; }
    return {
      id: ini, ini, fin, piezas, renta_cent: renta, parcial: fin > hoy,
      etiqueta: paso === 'mes' ? etiquetaMes(ini) : corta(ini),
    };
  });
}

/** Solo las cubetas desde la primera con movimiento (no se dibuja historia que no existe). */
export function desdePrimerMovimiento(c: readonly Cubeta[]): Cubeta[] {
  const i = c.findIndex((x) => x.piezas !== 0);
  return i < 0 ? [] : c.slice(i);
}

// ---------------------------------------------------------------- estadisticas

const piezasEn = (serie: readonly DiaRenta[], ini: string, fin: string): number => serie.reduce((s, d) => (d.fecha >= ini && d.fecha <= fin ? s + d.piezas : s), 0);

export interface Estadisticas {
  /** Piezas por dia de los ultimos 7 y 28 dias CERRADOS (sin hoy); null si aun no hay tantos dias de historia. */
  ritmo7: number | null;
  ritmo28: number | null;
  ritmoSemanal: number | null;
  mejorDia: { fecha: string; piezas: number } | null;
  mes: { piezas: number; renta_cent: bigint };
  /** Mismo tramo (dias 1 a d) del mes anterior. null si el mes anterior no tiene historia. */
  mesAnterior: { piezas: number; hasta: string; variacionPct: number | null } | null;
  /** Ultimos 7 dias cerrados contra los 7 anteriores. */
  tendencia: { sentido: 'sube' | 'baja' | 'estable'; cambioPct: number } | null;
  /** Dias que faltan para el fin de mes (sin contar hoy). */
  diasRestantes: number;
  ultimoPago: { fecha: string; hace: number } | null;
}

export function estadisticas(serie: readonly DiaRenta[], pagos: readonly PagoRenta[], estado: Pick<EstadoRenta, 'hoy' | 'primer_envio'>): Estadisticas {
  const hoy = estado.hoy;
  const ayer = sumarDias(hoy, -1);
  const historia = estado.primer_envio === null ? 0 : diasEntre(estado.primer_envio, hoy);
  const ritmo = (n: number): number | null => (historia >= n ? piezasEn(serie, sumarDias(hoy, -n), ayer) / n : null);
  const ritmo7 = ritmo(7);
  const mejor = serie.reduce<DiaRenta | null>((a, d) => (d.piezas > (a?.piezas ?? 0) ? d : a), null);
  const mesIni = primeroDeMes(hoy);
  const mesPz = piezasEn(serie, mesIni, hoy);
  const mesRenta = serie.reduce((s, d) => (d.fecha >= mesIni && d.fecha <= hoy ? s + d.renta_cent : s), 0n);
  const antIni = mesAnteriorIni(hoy);
  const antFin = sumarDias(mesIni, -1);
  const corte = sumarDias(antIni, Number(hoy.slice(8, 10)) - 1);
  const antHasta = corte < antFin ? corte : antFin;
  const antPz = piezasEn(serie, antIni, antHasta);
  const hayAnt = estado.primer_envio !== null && estado.primer_envio <= antFin && antPz > 0;
  const previos = historia >= 14 ? piezasEn(serie, sumarDias(hoy, -14), sumarDias(hoy, -8)) : 0;
  const ult7 = historia >= 14 ? piezasEn(serie, sumarDias(hoy, -7), ayer) : 0;
  let tendencia: Estadisticas['tendencia'] = null;
  if (previos > 0) {
    const cambio = ((ult7 - previos) / previos) * 100;
    tendencia = { sentido: cambio > 10 ? 'sube' : cambio < -10 ? 'baja' : 'estable', cambioPct: Math.round(cambio) };
  }
  const ult = pagos.reduce<PagoRenta | null>((a, p) => (a === null || p.fecha > a.fecha ? p : a), null);
  const finMes = sumarDias(primeroDeMes(sumarDias(mesIni, 32)), -1);
  return {
    ritmo7, ritmo28: ritmo(28), ritmoSemanal: ritmo7 === null ? null : ritmo7 * 7,
    mejorDia: mejor ? { fecha: mejor.fecha, piezas: mejor.piezas } : null,
    mes: { piezas: mesPz, renta_cent: mesRenta },
    mesAnterior: hayAnt ? { piezas: antPz, hasta: antHasta, variacionPct: Math.round(((mesPz - antPz) / antPz) * 100) } : null,
    tendencia, diasRestantes: diasEntre(hoy, finMes),
    ultimoPago: ult ? { fecha: ult.fecha, hace: diasEntre(ult.fecha, hoy) } : null,
  };
}

// ---------------------------------------------------------------- linea acumulada con banda de proyeccion

export interface PuntoAcumulado { id: string; etiqueta: string; valor: number; texto: string; tipo: 'observado' | 'estimado'; bajo?: number; alto?: number }

/** Renta acumulada del mes dia por dia (observado) y, si la base emitio proyeccion, 4 puntos estimados hasta el corte con banda que se abre con la raiz del tiempo. */
export function acumuladoDelMes(serie: readonly DiaRenta[], hoy: string, proy: Proyeccion): PuntoAcumulado[] {
  const mesIni = primeroDeMes(hoy);
  const n = diasEntre(mesIni, hoy) + 1;
  const puntos: PuntoAcumulado[] = [];
  let acum = 0n;
  for (let i = 0; i < n; i++) {
    const f = sumarDias(mesIni, i);
    for (const d of serie) if (d.fecha === f) acum += d.renta_cent;
    puntos.push({ id: f, etiqueta: corta(f), valor: Number(acum), texto: formatearMoneda(acum), tipo: 'observado' });
  }
  if (!proy.emitida || proy.dias_restantes <= 0) return puntos;
  const medioAncho = Number(proy.restante_renta_cent.alto - proy.restante_renta_cent.bajo) / 2;
  const pasos = Math.min(4, proy.dias_restantes);
  for (let k = 1; k <= pasos; k++) {
    const frac = k / pasos;
    const dia = Math.round(proy.dias_restantes * frac);
    const f = sumarDias(hoy, dia);
    const central = acum + BigInt(Math.round(Number(proy.restante_renta_cent.central) * (dia / proy.dias_restantes)));
    const ancho = medioAncho * Math.sqrt(dia / proy.dias_restantes);
    puntos.push({
      id: `est-${f}`, etiqueta: corta(f), valor: Number(central), texto: formatearMoneda(central), tipo: 'estimado',
      bajo: Math.max(Number(acum), Number(central) - ancho), alto: Number(central) + ancho,
    });
  }
  return puntos;
}

// ---------------------------------------------------------------- insights con plantilla

export type SeveridadInsight = 'Informa' | 'Atención' | 'Acción';
export interface CifraInsight { valor: number; tipo: 'moneda' | 'piezas' | 'entero' | 'porcentaje' }
export interface Insight { id: string; etiqueta: string; frase: string; severidad: SeveridadInsight; procedencia: 'observado' | 'estimado'; cifra: CifraInsight }

const fechaLarga = (f: string): string => `${Number(f.slice(8, 10))} de ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(f.slice(5, 7)) - 1]}`;
const m = (c: bigint): string => formatearMoneda(c);

/** Frases de plantilla fija (nunca texto libre de IA). Cada una dice de donde sale: observado o estimado. */
export function insights(e: EstadoRenta, proy: Proyeccion, est: Estadisticas): Insight[] {
  const r: Insight[] = [];
  if (e.a_favor_cent > 0n) {
    r.push({ id: 'a-favor', etiqueta: 'Anticipo a favor de Omar', frase: `Se pagaron ${m(e.a_favor_cent)} de más; se absorben solos con la renta de los próximos envíos.`, severidad: 'Informa', procedencia: 'observado', cifra: { valor: Number(e.a_favor_cent), tipo: 'moneda' } });
  } else if (e.por_pagar_cent > 0n) {
    const sinPago = est.ultimoPago === null ? 'Todavía no se ha registrado ningún pago de renta.' : `El último pago fue hace ${est.ultimoPago.hace} ${est.ultimoPago.hace === 1 ? 'día' : 'días'}.`;
    r.push({ id: 'por-pagar', etiqueta: 'Por pagar ahora', frase: `Hay ${m(e.por_pagar_cent)} devengados sin pagar. ${sinPago}`, severidad: est.ultimoPago === null || est.ultimoPago.hace > 30 ? 'Acción' : 'Atención', procedencia: 'observado', cifra: { valor: Number(e.por_pagar_cent), tipo: 'moneda' } });
  } else {
    r.push({ id: 'al-corriente', etiqueta: 'Cuenta al corriente', frase: 'Todo lo devengado está pagado.', severidad: 'Informa', procedencia: 'observado', cifra: { valor: 0, tipo: 'moneda' } });
  }
  if (proy.emitida) {
    r.push({
      id: 'pago-corte', etiqueta: 'Pronóstico al corte',
      frase: `Si sigue este ritmo (${proy.ritmo_diario_pz.toFixed(1)} piezas por día), pagarás ${m(proy.pago_al_corte_cent.central)} el ${fechaLarga(proy.fecha_corte)} (rango ${m(proy.pago_al_corte_cent.bajo)} a ${m(proy.pago_al_corte_cent.alto)}).`,
      severidad: 'Informa', procedencia: 'estimado', cifra: { valor: Number(proy.pago_al_corte_cent.central), tipo: 'moneda' },
    });
  } else {
    const mu = proy.muestra;
    const falta = proy.motivo === 'sin_tarifa' ? 'No hay tarifa configurada.' : `Hay ${mu.dias_con_envio} de ${mu.dias_requeridos} días con envío y ${formatearPiezas(mu.piezas)} de ${formatearPiezas(mu.piezas_requeridas)} piezas necesarios.`;
    r.push({ id: 'sin-proyeccion', etiqueta: 'Sin proyección', frase: `Todavía no hay muestra para estimar el pago al corte. ${falta}`, severidad: 'Informa', procedencia: 'observado', cifra: { valor: mu.dias_con_envio, tipo: 'entero' } });
  }
  if (est.tendencia) {
    const t = est.tendencia;
    r.push({ id: 'tendencia', etiqueta: 'Tendencia', frase: t.sentido === 'estable' ? 'El ritmo de los últimos 7 días es parecido al de los 7 anteriores.' : `Los envíos de los últimos 7 días ${t.sentido === 'sube' ? 'subieron' : 'bajaron'} ${Math.abs(t.cambioPct)} % contra los 7 anteriores.`, severidad: 'Informa', procedencia: 'observado', cifra: { valor: Math.abs(t.cambioPct), tipo: 'porcentaje' } });
  }
  if (est.mesAnterior && est.mesAnterior.variacionPct !== null) {
    const v = est.mesAnterior.variacionPct;
    r.push({ id: 'mes-anterior', etiqueta: 'Contra el mes anterior', frase: `Este mes lleva ${formatearPiezas(est.mes.piezas)} piezas; el mes anterior al mismo día llevaba ${formatearPiezas(est.mesAnterior.piezas)} (${v >= 0 ? '+' : '−'}${Math.abs(v)} %).`, severidad: 'Informa', procedencia: 'observado', cifra: { valor: est.mes.piezas, tipo: 'piezas' } });
  }
  return r;
}
