// Cuenta por pagar de la sociedad a Javier por costos del sistema (decision 20, punto 7; adenda 21).
// Saldo = cargos cobrables pagados por el socio (con sus reversas, que restan) - reembolsos recibidos.

import { ceilDiv } from '../dinero/techo';
import { ErrorCostos } from './errores';
import type { CargoCosto, ReembolsoCosto, SocioId } from './tipos';

export interface SaldoPorPagar {
  socio: SocioId;
  cargadoCent: bigint;
  reembolsadoCent: bigint;
  pendienteCent: bigint;
}

export function saldoPorPagar(socio: SocioId, cargos: readonly CargoCosto[], reembolsos: readonly ReembolsoCosto[]): SaldoPorPagar {
  let cargado = 0n;
  for (const c of cargos) if (c.cobrable && c.pagadoPor === socio) cargado += c.montoCent;
  let reembolsado = 0n;
  for (const r of reembolsos) if (r.aSocio === socio) reembolsado += r.montoCent;
  return { socio, cargadoCent: cargado, reembolsadoCent: reembolsado, pendienteCent: cargado - reembolsado };
}

/** Un reembolso no puede ser cero, negativo ni mayor que lo pendiente (no existe un "saldo a favor" de la sociedad por esta via). */
export function validarReembolso(montoCent: bigint, pendienteCent: bigint): void {
  if (montoCent <= 0n) throw new ErrorCostos('reembolso_invalido', 'El reembolso debe ser mayor que cero.');
  if (montoCent > pendienteCent) throw new ErrorCostos('reembolso_invalido', 'El reembolso excede lo pendiente por pagar al socio.');
}

export interface Posiciones {
  angelo: bigint;
  javier: bigint;
}

/** Un gasto de la sociedad pagado por un socio sube la posicion de ese socio por el monto (formula de posicion de siempre). */
export function posicionTrasGastos(pos: Posiciones, cargos: readonly CargoCosto[]): Posiciones {
  let { angelo, javier } = pos;
  for (const c of cargos) {
    if (!c.cobrable) continue;
    if (c.pagadoPor === 'javier') javier += c.montoCent;
    else angelo += c.montoCent;
  }
  return { angelo, javier };
}

export interface DeudaEntreSocios {
  /** Quien debe al otro por la diferencia de posiciones; null si estan en paz. */
  deudor: SocioId | null;
  /** (|Pos(A) - Pos(J)|) / 2 redondeado hacia arriba a favor del acreedor. */
  montoCent: bigint;
}

export function deudaEntreSocios(pos: Posiciones): DeudaEntreSocios {
  const d = pos.angelo - pos.javier;
  if (d === 0n) return { deudor: null, montoCent: 0n };
  // Pos(A) > Pos(J): Javier debe a Angelo.
  return { deudor: d > 0n ? 'javier' : 'angelo', montoCent: ceilDiv(d > 0n ? d : -d, 2n) };
}
