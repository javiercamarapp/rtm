// Efecto economico por socio de un gasto de la sociedad (informativo).
// Decision 20, punto 7: el gasto NO se cobra 50/50 a cada socio; lo absorbe la sociedad y baja la utilidad antes
// del reparto. Estas mitades solo explican ese efecto ("a Angelo le toca ...") y nunca generan una deuda.

import { ceilDiv } from '../dinero/techo';

export interface MitadesCent {
  angelo: bigint;
  javier: bigint;
}

/** Parte de Angelo = techo de la mitad; Javier recibe el resto, de modo que angelo + javier = monto siempre. */
export function repartoMitades(montoCent: bigint): MitadesCent {
  const angelo = ceilDiv(montoCent, 2n);
  return { angelo, javier: montoCent - angelo };
}
