// OpenRouter EN VIVO: lo que la propia OpenRouter dice que consumio la llave de RTM (GET /api/v1/key) contra el libro propio de llamadas (ia.llamada), para ver el costo conforme se consume
// y conciliarlo despues contra el cargo del ciclo. Todo en millonesimas de dolar (bigint). Puro: sin red ni reloj.
import { conciliar, type ResultadoConciliacion } from './conciliacion';

export interface LecturaOpenRouter {
  usoMesUsdMicro: bigint;
  usoDiaUsdMicro: bigint;
  usoSemanaUsdMicro: bigint;
  usoTotalUsdMicro: bigint;
  limiteUsdMicro: bigint | null;
  /** Instante UTC ISO de la lectura. */
  leidaEn: string;
}

/** Dolares (numero de la API) a millonesimas, redondeado. Lo no numerico o negativo es 0. */
export function microDeUsd(v: unknown): bigint {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? BigInt(Math.round(v * 1_000_000)) : 0n;
}

/** Interpreta la respuesta de /api/v1/key. Devuelve null si no trae el bloque `data` con numeros de uso. */
export function parsearLlave(cuerpo: unknown, leidaEn: string): LecturaOpenRouter | null {
  const d = (cuerpo as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d !== 'object' || typeof d['usage'] !== 'number') return null;
  return {
    usoMesUsdMicro: microDeUsd(d['usage_monthly']), usoDiaUsdMicro: microDeUsd(d['usage_daily']), usoSemanaUsdMicro: microDeUsd(d['usage_weekly']), usoTotalUsdMicro: microDeUsd(d['usage']),
    limiteUsdMicro: typeof d['limit'] === 'number' ? microDeUsd(d['limit']) : null, leidaEn,
  };
}

/** Diferencias de hasta 5 centavos de dolar cuadran siempre (con montos chicos el porcentaje no dice nada); arriba de eso manda la tolerancia relativa de la conciliacion. */
export const PISO_ABSOLUTO_USD_MICRO = 50_000n;

export function conciliarEnVivo(libroUsdMicro: bigint, externoUsdMicro: bigint): ResultadoConciliacion {
  const r = conciliar(libroUsdMicro, externoUsdMicro);
  return r.diferenciaUsdMicro <= PISO_ABSOLUTO_USD_MICRO ? { ...r, estado: 'cuadra' } : r;
}

/** USD a pesos con el tipo de cambio (micro MXN por USD); redondeo medio arriba a centavos. */
export function centavosDeUsdMicro(usdMicro: bigint, tcMicro: bigint): bigint {
  return (usdMicro * tcMicro + 5n * 10n ** 9n) / (10n ** 10n);
}
