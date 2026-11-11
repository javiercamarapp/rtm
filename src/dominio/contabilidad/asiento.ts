// Validacion PURA de un asiento de partida doble (capa i de B1 en 02): se corre antes de intentar guardar y es la misma regla que el trigger
// diferido de la base. Dinero en centavos bigint; ninguna linea tiene debe y haber a la vez, ni montos negativos.

export interface LineaPropuesta {
  cuenta: string;
  debe_cent: bigint;
  haber_cent: bigint;
}

export type ErrorAsiento =
  | { tipo: 'pocas_lineas' }
  | { tipo: 'cuenta_invalida'; cuenta: string }
  | { tipo: 'monto_negativo'; cuenta: string }
  | { tipo: 'debe_y_haber'; cuenta: string }
  | { tipo: 'descuadre'; debe_cent: bigint; haber_cent: bigint };

const CUENTA = /^\d{4}$/;

export function sumas(lineas: readonly LineaPropuesta[]): { debe_cent: bigint; haber_cent: bigint } {
  let debe = 0n;
  let haber = 0n;
  for (const l of lineas) {
    debe += l.debe_cent;
    haber += l.haber_cent;
  }
  return { debe_cent: debe, haber_cent: haber };
}

export function validarAsiento(lineas: readonly LineaPropuesta[]): ErrorAsiento[] {
  const errores: ErrorAsiento[] = [];
  if (lineas.length < 2) errores.push({ tipo: 'pocas_lineas' });
  for (const l of lineas) {
    if (!CUENTA.test(l.cuenta)) errores.push({ tipo: 'cuenta_invalida', cuenta: l.cuenta });
    if (l.debe_cent < 0n || l.haber_cent < 0n) errores.push({ tipo: 'monto_negativo', cuenta: l.cuenta });
    else if ((l.debe_cent > 0n) === (l.haber_cent > 0n)) errores.push({ tipo: 'debe_y_haber', cuenta: l.cuenta });
  }
  const s = sumas(lineas);
  if (s.debe_cent !== s.haber_cent) errores.push({ tipo: 'descuadre', ...s });
  return errores;
}

export function asientoCuadra(lineas: readonly LineaPropuesta[]): boolean {
  return validarAsiento(lineas).length === 0;
}

/** Reversa: mismas lineas con los lados invertidos (el motivo y el enlace los pone la base). */
export function invertir(lineas: readonly LineaPropuesta[]): LineaPropuesta[] {
  return lineas.map((l) => ({ cuenta: l.cuenta, debe_cent: l.haber_cent, haber_cent: l.debe_cent }));
}

/** Saldo de una cuenta segun su naturaleza (deudora: debe - haber; acreedora: haber - debe). */
export function saldoNatural(naturaleza: 'D' | 'A', debe: bigint, haber: bigint): bigint {
  return naturaleza === 'D' ? debe - haber : haber - debe;
}
