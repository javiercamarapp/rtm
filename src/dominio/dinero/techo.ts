// Unica funcion de redondeo hacia arriba de RTM para costos del sistema (spec 17, seccion 3.4).
// Enteros bigint, sin flotantes. Redondeo siempre hacia +infinito, a favor de quien paga.
// Gemela SQL: costos.techo (misma regla; la paridad se prueba por propiedad).

/** Techo matematico de a / b con b > 0 (hacia +infinito, tambien para negativos). */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError('denominador invalido');
  return a >= 0n ? (a + b - 1n) / b : -(-a / b);
}

/**
 * Centavos redondeados hacia arriba al multiplo de `paso` (por omision 100 = peso entero).
 * `num / den` esta en centavos; un techo de negativos tambien va hacia +infinito.
 */
export function techoCent(num: bigint, den: bigint, paso: bigint = 100n): bigint {
  if (paso <= 0n) throw new RangeError('paso invalido');
  return ceilDiv(ceilDiv(num, den), paso) * paso;
}

export const PPM_POR_PUNTO = 10_000n;
export const PPM_TOTAL = 1_000_000n;

/** Partes por millon redondeadas hacia arriba al punto porcentual entero (176000 -> 180000). */
export function techoPct(ppm: bigint): bigint {
  return ceilDiv(ppm, PPM_POR_PUNTO) * PPM_POR_PUNTO;
}

/**
 * Participacion num/den redondeada hacia arriba al punto porcentual, calculada con la fraccion
 * exacta (no con un ppm truncado), de modo que 18.0000001 % nunca baje a 18 %. Devuelve ppm.
 */
export function techoPctDeFraccion(num: bigint, den: bigint): bigint {
  if (num < 0n) throw new RangeError('participacion negativa');
  return ceilDiv(num * 100n, den) * PPM_POR_PUNTO;
}

/** Participacion exacta en ppm (truncada hacia cero) solo para mostrarla; nunca para cobrar. */
export function ppmExactoTruncado(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('denominador invalido');
  return (num * PPM_TOTAL) / den;
}
