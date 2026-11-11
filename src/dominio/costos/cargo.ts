// Calculo de un cargo: base x porcentaje x tipo de cambio, con UN solo redondeo hacia arriba (spec 17, 3.4).
//
// Unidades:
//  - base: millonesimas (micro) de la moneda original (USD o MXN). El libro de IA ya viene en usd_micro y
//    no se redondea a centavos antes del cargo: el unico redondeo es el del monto en MXN.
//  - porcentaje: partes por millon (ppm), 1_000_000 = 100 %.
//  - tipo de cambio: MXN por unidad de moneda original, en millonesimas (18.50 -> 18_500_000).
//  - exacto_mxn_e6: centavos MXN x 1e6, truncado (solo para mostrar); el monto se calcula con el numerador completo.

import { ceilDiv, techoCent } from '../dinero/techo';
import { ErrorCostos } from './errores';

export type Moneda = 'USD' | 'MXN';
export type FuenteTipoCambio = 'banxico_fix' | 'manual';

export const TC_UNO = 1_000_000n;
export const PPM_CIEN = 1_000_000n;
/** base_micro x pct_ppm x tc_micro / DEN_CENT = centavos MXN (1e6 micro x 1e6 ppm x 1e6 tc / 100). */
const DEN_CENT = 10n ** 16n;
/** base_micro x pct_ppm x tc_micro / DEN_E6 = centavos x 1e6. */
const DEN_E6 = 10n ** 10n;

export interface TipoCambioFechado {
  tcMicro: bigint;
  /** Fecha efectiva de la publicacion usada (puede ser anterior a la del cargo si fue inhabil). */
  fecha: string;
  fuente: FuenteTipoCambio;
}

export interface EntradaCalculo {
  baseOrigMicro: bigint;
  moneda: Moneda;
  /** Porcentaje que se atribuye a RTM, ya aplicado (techo al punto si es participacion). */
  pctAplicadoPpm: bigint;
  tcMicro: bigint;
}

export interface MontoCalculado {
  /** Centavos MXN x 1e6, truncado hacia -infinito. Nunca mayor que el monto exacto. */
  exactoMxnE6: bigint;
  /** Centavos MXN redondeados hacia arriba al peso entero: es el gasto. */
  montoCent: bigint;
  /** Numerador exacto (para comparar sin perder precision). */
  numerador: bigint;
}

function floorDiv(a: bigint, b: bigint): bigint {
  return -ceilDiv(-a, b);
}

export function validarTipoCambio(tcMicro: bigint): void {
  if (tcMicro <= 0n) throw new ErrorCostos('tipo_cambio_invalido', 'El tipo de cambio debe ser positivo.');
}

export function validarPorcentaje(ppm: bigint): void {
  if (ppm < 0n || ppm > PPM_CIEN) throw new ErrorCostos('porcentaje_invalido', 'El porcentaje debe estar entre 0 y 100 %.');
}

/** Numerador exacto: base x porcentaje x tipo de cambio (sin dividir). */
export function numeradorMxn(baseOrigMicro: bigint, pctPpm: bigint, tcMicro: bigint): bigint {
  return baseOrigMicro * pctPpm * tcMicro;
}

export function montoDesdeNumerador(numerador: bigint): MontoCalculado {
  return {
    numerador,
    exactoMxnE6: floorDiv(numerador, DEN_E6),
    montoCent: techoCent(numerador, DEN_CENT, 100n),
  };
}

export function calcularMonto(e: EntradaCalculo): MontoCalculado {
  validarTipoCambio(e.tcMicro);
  validarPorcentaje(e.pctAplicadoPpm);
  return montoDesdeNumerador(numeradorMxn(e.baseOrigMicro, e.pctAplicadoPpm, e.tcMicro));
}

/** Dolares (o pesos) atribuidos en millonesimas, truncado: solo informativo. */
export function atribuidoOrigMicro(baseOrigMicro: bigint, pctPpm: bigint): bigint {
  return floorDiv(baseOrigMicro * pctPpm, PPM_CIEN);
}

/** Comprobacion de la invariante de base de datos: monto >= techo del exacto. */
export function montoRespetaExacto(montoCent: bigint, exactoMxnE6: bigint): boolean {
  return montoCent >= ceilDiv(exactoMxnE6, 1_000_000n);
}
