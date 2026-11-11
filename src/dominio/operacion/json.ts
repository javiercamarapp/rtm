// Las funciones de la base devuelven jsonb; todo lo que se llama `*_cent` son centavos enteros. Aqui se convierten a bigint (nunca number con decimales).
// Es la unica conversion: la interfaz solo formatea lo que la base ya calculo.

/** Convierte recursivamente toda clave `*_cent` (y `*_cent_*` no existen) de number a bigint. null se conserva (sin dato). */
export function centavosABigint<T>(valor: unknown): T {
  return convertir(valor) as T;
}

function convertir(v: unknown, clave?: string, mapaCent = false): unknown {
  if (Array.isArray(v)) return v.map((x) => convertir(x));
  if (v !== null && typeof v === 'object') {
    // Un objeto cuya clave termina en `_cent` es un mapa de montos (por ejemplo antiguedad_cent): todos sus valores son centavos.
    const hereda = clave !== undefined && clave.endsWith('_cent');
    const salida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) salida[k] = convertir(x, k, hereda);
    return salida;
  }
  if (typeof v === 'number' && ((clave !== undefined && clave.endsWith('_cent')) || mapaCent)) {
    if (!Number.isSafeInteger(v)) throw new RangeError(`centavos no enteros o fuera de rango en ${clave}`);
    return BigInt(v);
  }
  return v;
}

/** Inversa para viajar a la base (bigint no es serializable en JSON): centavos como number entero. */
export function bigintACentavos(c: bigint): number {
  if (c > BigInt(Number.MAX_SAFE_INTEGER) || c < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('monto fuera de rango');
  return Number(c);
}
