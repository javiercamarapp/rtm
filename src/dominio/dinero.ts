// Dinero en centavos MXN como bigint (sufijo _cent en base de datos). Prohibido number con decimales para dinero.
// Una sola funcion de redondeo: medio arriba. Misma regla que negocio.redondear_medio_arriba en SQL.

export type Centavos = bigint;

/** floor((2*num + den) / (2*den)) con den > 0: redondeo medio arriba, tambien para negativos. */
export function redondearMedioArriba(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('denominador invalido');
  const a = 2n * num + den;
  const b = 2n * den;
  let q = a / b; // bigint trunca hacia cero
  if (a < 0n && a % b !== 0n) q -= 1n;
  return q;
}

/**
 * Costo promedio ponderado movil: salida de `n` piezas con `existencia` piezas y valor `valor`.
 * valor_salida = round(V * n / E); si n = E, valor_salida = V (residuo exacto).
 */
export function valorSalida(valor: Centavos, existencia: number, n: number): Centavos {
  if (!Number.isInteger(existencia) || !Number.isInteger(n) || n <= 0 || n > existencia) {
    throw new RangeError('salida invalida: piezas fuera de existencia');
  }
  if (n === existencia) return valor;
  return redondearMedioArriba(valor * BigInt(n), BigInt(existencia));
}

/** "1234.50" o "1,234.5" -> 123450n. Rechaza mas de dos decimales y cualquier otra cosa. */
export function centavosDesdeTexto(texto: string): Centavos {
  const limpio = texto.trim().replace(/[$,\s]/g, '');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(limpio);
  if (!m) throw new RangeError(`monto invalido: ${texto}`);
  const [, signo, enteros, dec = ''] = m;
  const valor = BigInt(enteros!) * 100n + BigInt(dec.padEnd(2, '0'));
  return signo === '-' ? -valor : valor;
}
