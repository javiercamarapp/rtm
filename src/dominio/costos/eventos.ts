// Asientos de los eventos de costos (funcion pura, como `contabilidad.lineas_de_evento`). Spec 17, 3.2, con la
// mecanica corregida por la decision 20 punto 7: el gasto es de la sociedad, pagado por un socio, y genera una
// cuenta por pagar de la sociedad a ese socio. No existe "Angelo debe a Javier por costos".

import { ErrorCostos } from './errores';
import type { CategoriaCosto, SocioId } from './tipos';

/** Codigos propuestos; se reconcilian con el plan de cuentas antes de M2. */
export const CUENTAS = {
  gasto: { nube: '6210', ia: '6220', software: '6230', dominio: '6240' } satisfies Record<CategoriaCosto, string>,
  anticipo: '1410',
  porPagar: { javier: '2320', angelo: '2310' } satisfies Record<SocioId, string>,
  fondos: { angelo: '1150', javier: '1160' } satisfies Record<SocioId, string>,
} as const;

export interface LineaAsiento {
  cuenta: string;
  debeCent: bigint;
  haberCent: bigint;
}

export type EventoCostos =
  | { tipo: 'costo_cargo_registrado'; categoria: CategoriaCosto; montoCent: bigint; pagadoPor: SocioId }
  | { tipo: 'costo_cargo_anual'; montoCent: bigint; pagadoPor: SocioId }
  | { tipo: 'costo_devengo_mensual'; montoCent: bigint; categoria: CategoriaCosto }
  | { tipo: 'costo_recarga_ia'; montoCent: bigint; pagadoPor: SocioId }
  | { tipo: 'costo_consumo_ia'; montoCent: bigint }
  | { tipo: 'reembolso_costos'; montoCent: bigint; aSocio: SocioId; fondosDe: SocioId }
  | { tipo: 'costo_conciliado' };

/** Dr cuenta / Cr contracuenta; un monto negativo (nota de credito, reversa) invierte los lados. */
function par(debe: string, haber: string, montoCent: bigint): LineaAsiento[] {
  if (montoCent === 0n) return [];
  return montoCent > 0n
    ? [{ cuenta: debe, debeCent: montoCent, haberCent: 0n }, { cuenta: haber, debeCent: 0n, haberCent: montoCent }]
    : [{ cuenta: haber, debeCent: -montoCent, haberCent: 0n }, { cuenta: debe, debeCent: 0n, haberCent: -montoCent }];
}

export function lineasDeEvento(e: EventoCostos): LineaAsiento[] {
  let lineas: LineaAsiento[];
  switch (e.tipo) {
    case 'costo_cargo_registrado':
      lineas = par(CUENTAS.gasto[e.categoria], CUENTAS.porPagar[e.pagadoPor], e.montoCent);
      break;
    case 'costo_cargo_anual':
      lineas = par(CUENTAS.anticipo, CUENTAS.porPagar[e.pagadoPor], e.montoCent);
      break;
    case 'costo_devengo_mensual':
      lineas = par(CUENTAS.gasto[e.categoria], CUENTAS.anticipo, e.montoCent);
      break;
    case 'costo_recarga_ia':
      lineas = par(CUENTAS.anticipo, CUENTAS.porPagar[e.pagadoPor], e.montoCent);
      break;
    case 'costo_consumo_ia':
      lineas = par(CUENTAS.gasto.ia, CUENTAS.anticipo, e.montoCent);
      break;
    case 'reembolso_costos':
      // Paga la sociedad desde sus fondos: cancela la cuenta por pagar; jamas toca el cargo.
      lineas = par(CUENTAS.porPagar[e.aSocio], CUENTAS.fondos[e.fondosDe], e.montoCent);
      break;
    case 'costo_conciliado':
      lineas = [];
      break;
  }
  verificarCuadre(lineas);
  return lineas;
}

/** Reversa: mismas lineas con los lados invertidos. */
export function reversaDeLineas(lineas: readonly LineaAsiento[]): LineaAsiento[] {
  return lineas.map((l) => ({ cuenta: l.cuenta, debeCent: l.haberCent, haberCent: l.debeCent }));
}

export function verificarCuadre(lineas: readonly LineaAsiento[]): void {
  let debe = 0n;
  let haber = 0n;
  for (const l of lineas) {
    if (l.debeCent < 0n || l.haberCent < 0n) throw new ErrorCostos('asiento_descuadrado', 'Una linea de asiento es negativa.');
    debe += l.debeCent;
    haber += l.haberCent;
  }
  if (debe !== haber) throw new ErrorCostos('asiento_descuadrado', 'El asiento no cuadra: debe distinto de haber.');
}
