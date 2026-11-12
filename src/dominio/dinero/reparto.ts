// Cascada de reparto entre socios: gemela TypeScript de operacion.cascada_calcular y operacion.repartir_proporcional (supabase/migrations/20261111000300).
// Enteros bigint en centavos, sin flotantes. La paridad con SQL se prueba con los mismos casos dorados (test/unit/dinero/reparto.test.ts y 015_dinero_socios_cascada.test.sql).
// Reglas del dueno (11-nov): reembolsos primero; utilidad 50/50 fija aunque las aportaciones sean desiguales; perdidas y utilidad no repartida se arrastran;
// el centavo suelto va a favor de quien paga o aporta y, a igual prioridad, rota segun el periodo; la devolucion de capital NO es automatica.

export type Mapa = Readonly<Record<string, bigint>>;

/** Reparte `total` en proporcion a `pesos`. Todo el total queda repartido. Prioridad = quien paga o aporta mas recibe primero el centavo suelto; empate = rotacion por `rotor`. */
export function repartirProporcional(total: bigint, pesos: Mapa, prioridad: Mapa = {}, rotor = 0): Record<string, bigint> {
  const claves = Object.keys(pesos).sort();
  const salida: Record<string, bigint> = Object.fromEntries(claves.map((k) => [k, 0n]));
  if (total <= 0n) return salida;
  const suma = claves.reduce((a, k) => a + (pesos[k] ?? 0n), 0n);
  if (suma === 0n) return salida;
  let asignado = 0n;
  for (const k of claves) {
    const v = (total * (pesos[k] ?? 0n)) / suma; // piso: total y pesos no negativos
    salida[k] = v;
    asignado += v;
  }
  let resto = total - asignado;
  const activos = claves.filter((k) => (pesos[k] ?? 0n) > 0n);
  const n = activos.length;
  const desp = ((rotor % n) + n) % n;
  const orden = activos
    .map((k, rk) => ({ k, pri: prioridad[k] ?? 0n, rot: (((rk - desp) % n) + n) % n }))
    .sort((a, b) => (a.pri === b.pri ? a.rot - b.rot : a.pri > b.pri ? -1 : 1))
    .map((x) => x.k);
  while (resto > 0n) {
    for (const k of orden) {
      if (resto === 0n) break;
      salida[k] = (salida[k] ?? 0n) + 1n;
      resto -= 1n;
    }
  }
  return salida;
}

export interface EntradaCascada {
  utilidad: bigint;
  arrastre: bigint;
  caja: bigint;
  comprometido: bigint;
  reembolsos: Mapa;
  aportaciones: Mapa;
  poder: Mapa;
  deuda: Mapa;
  anticipos: Mapa;
  ppm: Mapa;
  rotor?: number;
}

export interface SocioCascada {
  reembolsoPendiente: bigint;
  pagaReembolso: bigint;
  utilidad: bigint;
  anticipo: bigint;
  asignado: bigint;
  tieneEnPoder: bigint;
  debe: bigint;
  resultado: bigint;
}

export interface ResultadoCascada {
  utilidad: bigint;
  arrastreIni: bigint;
  arrastreFin: bigint;
  efectivoTotal: bigint;
  disponible: bigint;
  pagadoReembolsos: bigint;
  repartible: bigint;
  remanente: bigint;
  limitadoPorEfectivo: boolean;
  porSocio: Record<string, SocioCascada>;
  sumaAsignada: bigint;
  sumaResultados: bigint;
  identidad: { via1: bigint; via2: bigint; efectivoRepartido: bigint; deudaNoEfectivo: bigint; cuadra: boolean };
  liquidar: { de: string; a: string; monto: bigint } | null;
}

const pos = (m: Mapa, k: string): bigint => {
  const v = m[k] ?? 0n;
  return v > 0n ? v : 0n;
};
const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

export function cascadaCalcular(e: EntradaCascada): ResultadoCascada {
  if (e.caja < 0n) throw new RangeError('el efectivo de la caja no puede ser negativo');
  const socios = Object.keys(e.ppm).sort();
  const suma = (m: Mapa): bigint => socios.reduce((a, k) => a + pos(m, k), 0n);
  const totR = suma(e.reembolsos);
  const totPoder = suma(e.poder);
  const totAntic = suma(e.anticipos);
  const noEfectivo = socios.reduce((a, k) => a + pos(e.deuda, k) - pos(e.poder, k), 0n);
  const pesosR = Object.fromEntries(socios.map((k) => [k, pos(e.reembolsos, k)]));
  const pri = Object.fromEntries(socios.map((k) => [k, pos(e.reembolsos, k) + pos(e.aportaciones, k)]));
  const rotor = e.rotor ?? 0;

  const efectivo = totPoder + e.caja;
  const disponible = max(efectivo - e.comprometido, 0n);
  const pagadoR = min(disponible, totR);
  const payR = repartirProporcional(pagadoR, pesosR, pri, rotor);
  const acumulada = e.utilidad + e.arrastre;
  const repartible = max(0n, min(acumulada, disponible - pagadoR + totAntic));
  const share = repartirProporcional(repartible, e.ppm, pri, rotor);
  const remanente = efectivo - pagadoR - (repartible - totAntic);

  let asignadoTotal = 0n;
  let resultadosTotal = 0n;
  let negMax = 0n;
  let posMax = 0n;
  let neg: string | null = null;
  let posK: string | null = null;
  const porSocio: Record<string, SocioCascada> = {};
  for (const k of socios) {
    const asignado = (payR[k] ?? 0n) + (share[k] ?? 0n) - pos(e.anticipos, k);
    const resultado = asignado - pos(e.deuda, k);
    asignadoTotal += asignado;
    resultadosTotal += resultado;
    porSocio[k] = {
      reembolsoPendiente: pos(e.reembolsos, k),
      pagaReembolso: payR[k] ?? 0n,
      utilidad: share[k] ?? 0n,
      anticipo: pos(e.anticipos, k),
      asignado,
      tieneEnPoder: pos(e.poder, k),
      debe: pos(e.deuda, k),
      resultado,
    };
    if (resultado < negMax) {
      neg = k;
      negMax = resultado;
    }
    if (resultado > posMax) {
      posK = k;
      posMax = resultado;
    }
  }
  const esperado = efectivo - remanente;
  const via2 = resultadosTotal + totPoder + noEfectivo;
  const cuadra = asignadoTotal === esperado && via2 === esperado && remanente >= 0n;
  return {
    utilidad: e.utilidad,
    arrastreIni: e.arrastre,
    arrastreFin: acumulada - repartible,
    efectivoTotal: efectivo,
    disponible,
    pagadoReembolsos: pagadoR,
    repartible,
    remanente,
    limitadoPorEfectivo: pagadoR < totR || repartible < max(acumulada, 0n),
    porSocio,
    sumaAsignada: asignadoTotal,
    sumaResultados: resultadosTotal,
    identidad: { via1: asignadoTotal, via2, efectivoRepartido: esperado, deudaNoEfectivo: noEfectivo, cuadra },
    liquidar: neg && posK ? { de: neg, a: posK, monto: min(-negMax, posMax) } : null,
  };
}
