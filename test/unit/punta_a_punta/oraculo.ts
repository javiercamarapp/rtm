// Modelo de referencia (oraculo) de las reglas de dinero de RTM, escrito SOLO desde la especificacion:
// CLAUDE.md, adendas 21, 31, 32 y 33, y las cifras a mano de qa/01-inventario-y-matriz.md (flujos F04, F10).
// NO es codigo de produccion y no lo importa nadie fuera de las pruebas. Las mismas cifras estan en pgTAP
// (supabase/tests/database/9xx_*.test.sql) para que SQL y especificacion se comparen por dos vias.
// Todo es bigint en centavos: sin flotantes.

export type Socio = 'Angelo' | 'Javier';
export const SOCIOS: readonly Socio[] = ['Angelo', 'Javier'];
export type PorSocio = Record<Socio, bigint>;

export const por = (a: bigint | number, j: bigint | number): PorSocio => ({ Angelo: BigInt(a), Javier: BigInt(j) });
export const suma = (m: PorSocio): bigint => m.Angelo + m.Javier;

/** Reparte `total` en proporcion a `pesos`; el residuo (centavos sueltos) va por mayor resto y, a igualdad, a quien mas pendiente tiene, y luego por orden alfabetico. */
export function repartirProporcional(total: bigint, pesos: PorSocio, desempate: PorSocio = por(0, 0)): PorSocio {
  const sp = suma(pesos);
  if (total <= 0n || sp <= 0n) return por(0, 0);
  const base = por((total * pesos.Angelo) / sp, (total * pesos.Javier) / sp);
  let resto = total - suma(base);
  const orden = [...SOCIOS].sort((x, y) => {
    const rx = (total * pesos[x]) % sp;
    const ry = (total * pesos[y]) % sp;
    if (rx !== ry) return rx > ry ? -1 : 1;
    if (desempate[x] !== desempate[y]) return desempate[x] > desempate[y] ? -1 : 1;
    return x < y ? -1 : 1;
  });
  for (const s of orden) {
    if (resto <= 0n) break;
    base[s] += 1n;
    resto -= 1n;
  }
  return base;
}

export interface EntradaCascada {
  utilidad: bigint;
  caja: bigint;
  reembolsos: PorSocio;
  aportaciones: PorSocio;
  /** Dinero de la sociedad en poder de cada socio (fondos). */
  poder: PorSocio;
  /** Lo que cada socio debe a la sociedad (en la especificacion actual = fondos en poder). */
  deuda: PorSocio;
  ppm?: PorSocio;
  /** true = se devuelve el capital antes de repartir utilidad (por omision, adenda 21). */
  aportacionesAntes?: boolean;
}

export interface SalidaCascada {
  efectivo: bigint;
  pagadoReembolso: PorSocio;
  pagadoAportacion: PorSocio;
  repartible: bigint;
  parte: PorSocio;
  asignado: PorSocio;
  resultado: PorSocio;
  remanente: bigint;
  limitadoPorEfectivo: boolean;
  liquidar: { de: Socio; a: Socio; monto: bigint } | null;
}

const minB = (a: bigint, b: bigint): bigint => (a < b ? a : b);
const maxB = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Cascada de reparto: reembolsos primero, devolucion de aportaciones (si la regla lo manda antes), utilidad neta 50/50 topada por el efectivo real. */
export function cascada(e: EntradaCascada): SalidaCascada {
  const ppm = e.ppm ?? por(500_000, 500_000);
  const antes = e.aportacionesAntes ?? true;
  const efectivo = maxB(e.caja, 0n) + suma(e.poder);
  let rest = efectivo;
  const pagadoReembolso = repartirProporcional(minB(rest, suma(e.reembolsos)), e.reembolsos);
  rest -= suma(pagadoReembolso);
  let pagadoAportacion: PorSocio;
  let repartible: bigint;
  if (antes) {
    pagadoAportacion = repartirProporcional(minB(rest, suma(e.aportaciones)), e.aportaciones);
    rest -= suma(pagadoAportacion);
    repartible = minB(maxB(e.utilidad, 0n), rest);
    rest -= repartible;
  } else {
    repartible = minB(maxB(e.utilidad, 0n), rest);
    rest -= repartible;
    pagadoAportacion = repartirProporcional(minB(rest, suma(e.aportaciones)), e.aportaciones);
    rest -= suma(pagadoAportacion);
  }
  const parte = repartirProporcional(repartible, ppm, por(e.reembolsos.Angelo + e.aportaciones.Angelo, e.reembolsos.Javier + e.aportaciones.Javier));
  const asignado = por(
    pagadoReembolso.Angelo + pagadoAportacion.Angelo + parte.Angelo,
    pagadoReembolso.Javier + pagadoAportacion.Javier + parte.Javier,
  );
  const resultado = por(asignado.Angelo - e.deuda.Angelo, asignado.Javier - e.deuda.Javier);
  let liquidar: SalidaCascada['liquidar'] = null;
  if (resultado.Angelo < 0n && resultado.Javier > 0n) liquidar = { de: 'Angelo', a: 'Javier', monto: minB(-resultado.Angelo, resultado.Javier) };
  if (resultado.Javier < 0n && resultado.Angelo > 0n) liquidar = { de: 'Javier', a: 'Angelo', monto: minB(-resultado.Javier, resultado.Angelo) };
  const pidioMas = suma(e.reembolsos) + suma(e.aportaciones) + maxB(e.utilidad, 0n);
  return { efectivo, pagadoReembolso, pagadoAportacion, repartible, parte, asignado, resultado, remanente: rest, limitadoPorEfectivo: efectivo < pidioMas, liquidar };
}

/** Gasto pagado por un socio: es gasto de la EMPRESA una sola vez (baja la utilidad) mas un reembolso al socio; nunca se descuenta dos veces. */
export function aplicarGastosDeSocio(utilidadAntesDeGastos: bigint, gastos: PorSocio): { utilidadNeta: bigint; reembolsos: PorSocio } {
  return { utilidadNeta: utilidadAntesDeGastos - suma(gastos), reembolsos: por(gastos.Angelo, gastos.Javier) };
}

export interface EntradaPedido {
  surtidas: number;
  precioCent: bigint;
  envioCent: bigint;
  recargoCent?: bigint;
  descuentoCent?: bigint;
  costoUnitCent: bigint;
  rentaPorPiezaCent: bigint;
  /** null = guia sin costear: la utilidad es provisional. */
  guiaCent: bigint | null;
}

export function economiaPedido(p: EntradaPedido): { total: bigint; costo: bigint; renta: bigint; utilidad: bigint; provisional: boolean } {
  const n = BigInt(p.surtidas);
  const total = n * p.precioCent + p.envioCent + (p.recargoCent ?? 0n) - (p.descuentoCent ?? 0n);
  const costo = n * p.costoUnitCent;
  const renta = n * p.rentaPorPiezaCent;
  return { total, costo, renta, utilidad: total - costo - renta - (p.guiaCent ?? 0n), provisional: p.guiaCent === null };
}

/** Costo puesto por pieza (promedio de una recepcion): (mercancia + guia + seguro) / piezas; centavos, medio arriba. */
export function costoPuesto(mercanciaCent: bigint, guiaCent: bigint, seguroCent: bigint, piezas: number): bigint {
  const num = mercanciaCent + guiaCent + seguroCent;
  const den = BigInt(piezas);
  return (2n * num + den) / (2n * den);
}
