// Ratios y estadisticas del historial personal. Funciones PURAS y deterministas sobre las cifras que ya entrego la base (centavos bigint):
// nada de azar, nada de reloj, nada de IA. Los porcentajes salen en puntos base (bp, 100 bp = 1 %) y las razones en centesimas.
// null = "Sin dato": nunca se inventa un cero.
import type { Cabecera, Flujo, FilaSerie, HistorialSocio } from './tipos';

/** Division entera redondeada medio hacia arriba (lejos de cero con signo). den debe ser positivo. */
export function divRedondeada(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('denominador no positivo');
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = (2n * a + den) / (2n * den);
  return neg ? -q : q;
}

/** Raiz cuadrada entera (piso) de un bigint no negativo. */
export function raizEntera(n: bigint): bigint {
  if (n < 0n) throw new RangeError('raiz de negativo');
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

const bp = (parte: bigint, total: bigint): bigint | null => (total > 0n ? divRedondeada(parte * 10000n, total) : null);

export interface Ratios {
  /** (retirado + valor actual - invertido) / invertido. */
  roi_bp: bigint | null;
  /** Solo con 6 meses o mas de historia: antes, anualizar engana. */
  roi_anualizado_bp: bigint | null;
  /** (retirado + valor actual) / invertido, en centesimas (150 = 1.50 veces). */
  multiplo_x100: bigint | null;
  /** Tasa interna de retorno anualizada de sus flujos fechados (XIRR); null si no hay cambio de signo o menos de 6 meses. */
  tir_bp: bigint | null;
  recuperado_bp: bigint | null;
  /** 0 = ya recupero lo invertido. */
  payback_meses: number | null;
  tasa_reinversion_bp: bigint | null;
  payout_bp: bigint | null;
  retiro_mensual_cent: bigint | null;
  margen_neto_bp: bigint | null;
  utilidad_por_pieza_cent: bigint | null;
  /** Efectivo disponible / (utilidad por distribuir + reembolsos pendientes), en centesimas. */
  cobertura_caja_x100: bigint | null;
  participacion_capital_bp: bigint | null;
  /** Participacion en la utilidad: fija 50/50, no depende de lo aportado. */
  participacion_utilidad_bp: bigint;
  /** Positivo: la sociedad le debe; negativo: el debe a la sociedad. */
  cuenta_neta_cent: bigint;
}

/** Dias entre dos fechas 'AAAA-MM-DD' (calendario, sin zona horaria). */
export function diasEntre(a: string, b: string): number {
  const f = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((f(b) - f(a)) / 86_400_000);
}

/** TIR anualizada (XIRR, base 365) por biseccion con un numero fijo de iteraciones. Devuelve la tasa como numero (0.12 = 12 %) o null. */
export function xirr(flujos: readonly { fecha: string; monto: number }[]): number | null {
  if (flujos.length < 2) return null;
  if (!flujos.some((f) => f.monto < 0) || !flujos.some((f) => f.monto > 0)) return null;
  const t0 = flujos.reduce((m, f) => (f.fecha < m ? f.fecha : m), flujos[0]!.fecha);
  const vp = (r: number) => flujos.reduce((a, f) => a + f.monto / Math.pow(1 + r, diasEntre(t0, f.fecha) / 365), 0);
  let lo = -0.99;
  let hi = 10;
  const flo = vp(lo);
  const fhi = vp(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = vp(mid);
    if (flo * fm <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function calcularRatios(h: HistorialSocio): Ratios {
  const c: Cabecera = h.cabecera;
  const t = h.totales;
  const meses = c.meses_activo;
  const base = c.valor_cent === null ? null : c.retirado_cent + c.valor_cent;
  const roi = base !== null && c.invertido_cent > 0n ? divRedondeada((base - c.invertido_cent) * 10000n, c.invertido_cent) : null;
  const multiplo = base !== null && c.invertido_cent > 0n ? divRedondeada(base * 100n, c.invertido_cent) : null;

  let roiAnual: bigint | null = null;
  if (roi !== null && meses >= 6 && c.invertido_cent > 0n) {
    const factor = Number(base!) / Number(c.invertido_cent);
    if (factor > 0) roiAnual = BigInt(Math.round((Math.pow(factor, 12 / meses) - 1) * 10000));
  }

  let tir: bigint | null = null;
  const fl: { fecha: string; monto: number }[] = h.flujos.map((f: Flujo) => ({ fecha: f.fecha, monto: Number(f.monto_cent) / 100 }));
  if (c.valor_cent !== null && c.valor_cent > 0n) fl.push({ fecha: h.hasta, monto: Number(c.valor_cent) / 100 });
  if (fl.length >= 2) {
    const primera = fl.reduce((m, f) => (f.fecha < m ? f.fecha : m), fl[0]!.fecha);
    if (diasEntre(primera, h.hasta) >= 180) {
      const r = xirr(fl);
      if (r !== null) tir = BigInt(Math.round(r * 10000));
    }
  }

  const retiroMensual = meses > 0 && c.retirado_utilidad_cent > 0n ? divRedondeada(c.retirado_utilidad_cent, BigInt(meses)) : null;
  let payback: number | null = null;
  if (c.invertido_cent > 0n) {
    if (c.retirado_cent >= c.invertido_cent) payback = 0;
    else if (retiroMensual !== null && retiroMensual > 0n) payback = Number((c.invertido_cent - c.retirado_cent + retiroMensual - 1n) / retiroMensual);
  }
  const pendiente = c.utilidad_por_distribuir_cent + c.reembolso_pendiente_cent;
  return {
    roi_bp: roi,
    roi_anualizado_bp: roiAnual,
    multiplo_x100: multiplo,
    tir_bp: tir,
    recuperado_bp: c.invertido_cent > 0n ? bp(c.retirado_cent, c.invertido_cent) : null,
    payback_meses: payback,
    tasa_reinversion_bp: c.utilidad_asignada_cent > 0n ? bp(c.reinversion_cent, c.utilidad_asignada_cent) : null,
    payout_bp: c.utilidad_asignada_cent > 0n ? bp(c.retirado_utilidad_cent, c.utilidad_asignada_cent) : null,
    retiro_mensual_cent: retiroMensual,
    margen_neto_bp: t && t.ventas_cent > 0n ? divRedondeada(t.utilidad_cent * 10000n, t.ventas_cent) : null,
    utilidad_por_pieza_cent: t && t.piezas > 0 ? divRedondeada(t.utilidad_cent, BigInt(t.piezas)) : null,
    cobertura_caja_x100: pendiente > 0n ? divRedondeada(c.efectivo_disponible_cent * 100n, pendiente) : null,
    participacion_capital_bp: bp(c.invertido_cent, c.invertido_ambos_cent),
    participacion_utilidad_bp: 5000n,
    cuenta_neta_cent: c.cuenta_cent,
  };
}

// ---------------------------------------------------------------------------
// Estadisticas de las series
// ---------------------------------------------------------------------------
export interface Extremo { ini: string; parte_cent: bigint }
export interface EstadisticasSerie {
  /** Meses completos (sin el parcial). */
  completos: FilaSerie[];
  mejor: Extremo | null;
  peor: Extremo | null;
  /** Promedio movil de 3 meses completos de su parte; el mes sin 3 anteriores queda en null. */
  promedio_movil: (bigint | null)[];
  racha_actual: number;
  mejor_racha: number;
  /** Meses completos consecutivos, hasta el mas reciente, con parte positiva. */
}

export function estadisticasMeses(meses: readonly FilaSerie[]): EstadisticasSerie {
  const completos = meses.filter((m) => !m.parcial && (m.pedidos > 0 || m.utilidad_cent !== 0n));
  let mejor: Extremo | null = null;
  let peor: Extremo | null = null;
  for (const m of completos) {
    if (mejor === null || m.parte_cent > mejor.parte_cent) mejor = { ini: m.ini, parte_cent: m.parte_cent };
    if (peor === null || m.parte_cent < peor.parte_cent) peor = { ini: m.ini, parte_cent: m.parte_cent };
  }
  const promedio = completos.map((_, i) => (i < 2 ? null : divRedondeada(completos[i]!.parte_cent + completos[i - 1]!.parte_cent + completos[i - 2]!.parte_cent, 3n)));
  let actual = 0;
  for (let i = completos.length - 1; i >= 0 && completos[i]!.parte_cent > 0n; i--) actual++;
  let mejorRacha = 0;
  let corrida = 0;
  for (const m of completos) {
    corrida = m.parte_cent > 0n ? corrida + 1 : 0;
    if (corrida > mejorRacha) mejorRacha = corrida;
  }
  return { completos, mejor, peor, promedio_movil: promedio, racha_actual: actual, mejor_racha: mejorRacha };
}

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

/** Estacionalidad semanal: promedio de la utilidad (50 % del socio) por dia de la semana sobre los dias de la serie diaria. Sin dias: todo null. */
export function estacionalidadSemanal(dias: readonly FilaSerie[]): { dia: string; dias: number; promedio_cent: bigint | null }[] {
  const acum = DIAS_SEMANA.map(() => ({ n: 0, suma: 0n }));
  for (const d of dias) {
    const dow = (new Date(`${d.ini}T00:00:00Z`).getUTCDay() + 6) % 7;
    acum[dow]!.n += 1;
    acum[dow]!.suma += d.parte_cent;
  }
  return DIAS_SEMANA.map((dia, i) => ({ dia, dias: acum[i]!.n, promedio_cent: acum[i]!.n > 0 ? divRedondeada(acum[i]!.suma, BigInt(acum[i]!.n)) : null }));
}

// ---------------------------------------------------------------------------
// Proyeccion personal a 3 meses: media de los meses completos con banda de +/- una desviacion predictiva (s * raiz(1 + 1/n)), que se estrecha con mas meses.
// ---------------------------------------------------------------------------
export const MESES_MINIMOS_PROYECCION = 3;
export interface ProyeccionPersonal {
  suficiente: boolean;
  n: number;
  /** Con payout observado: retiro esperado = su parte esperada x payout. Sin payout: se proyecta solo su parte de la utilidad. */
  base: 'retiro' | 'parte';
  meses: { esperado_cent: bigint; bajo_cent: bigint; alto_cent: bigint }[];
  banda_cent: bigint;
}

export function proyeccionPersonal(meses: readonly FilaSerie[], payoutBp: bigint | null): ProyeccionPersonal {
  const completos = meses.filter((m) => !m.parcial && (m.pedidos > 0 || m.utilidad_cent !== 0n));
  const n = completos.length;
  if (n < MESES_MINIMOS_PROYECCION) return { suficiente: false, n, base: 'parte', meses: [], banda_cent: 0n };
  const N = BigInt(n);
  const suma = completos.reduce((a, m) => a + m.parte_cent, 0n);
  const media = divRedondeada(suma, N);
  const ss = completos.reduce((a, m) => a + (m.parte_cent - media) * (m.parte_cent - media), 0n);
  const varianza = ss / (N - 1n);
  const banda = raizEntera((varianza * (N + 1n)) / N);
  // Un payout de 0 % (nadie ha retirado en efectivo) no es una tasa observable: multiplicar por cero emitiria un retiro esperado de $0 inventado. Se proyecta su parte.
  const conPayout = payoutBp !== null && payoutBp > 0n;
  const base: 'retiro' | 'parte' = conPayout ? 'retiro' : 'parte';
  const f = (x: bigint) => (conPayout ? divRedondeada(x * payoutBp, 10000n) : x);
  const esperado = f(media);
  const b = f(banda);
  const piso = (x: bigint) => (x < 0n ? 0n : x);
  const fila = { esperado_cent: piso(esperado), bajo_cent: piso(esperado - b), alto_cent: piso(esperado + b) };
  return { suficiente: true, n, base, meses: [fila, fila, fila], banda_cent: b };
}
