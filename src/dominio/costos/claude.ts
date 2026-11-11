// Lectura del JSON mensual que produce scripts/costos/prorratear-claude.mjs y participacion de RTM en la suscripcion.
// Metrica principal (decision 20): entrada + salida + escritura de cache; la lectura de cache no cuenta (parametro P7).

import { type Participacion, participacionPorConsumo } from './atribucion';
import { ErrorCostos } from './errores';

export interface MetricaClaude {
  tokensRtm: bigint;
  tokensCuenta: bigint;
}

export interface UsoClaudeMes {
  mes: string;
  scriptVersion: string;
  /** entrada + salida + escritura de cache: la que se cobra. */
  principal: MetricaClaude;
  soloSalida: MetricaClaude;
  conLecturaCache: MetricaClaude;
}

function entero(v: unknown, campo: string): bigint {
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  throw new ErrorCostos('monto_invalido', `El JSON de Claude trae un valor invalido en ${campo}.`);
}

function metrica(o: unknown, campo: string): MetricaClaude {
  const m = o as { tokens_rtm?: unknown; tokens_cuenta?: unknown } | null;
  if (!m || typeof m !== 'object') throw new ErrorCostos('monto_invalido', `Falta la metrica ${campo} en el JSON de Claude.`);
  const tokensRtm = entero(m.tokens_rtm, `${campo}.tokens_rtm`);
  const tokensCuenta = entero(m.tokens_cuenta, `${campo}.tokens_cuenta`);
  if (tokensRtm > tokensCuenta) throw new ErrorCostos('monto_invalido', `En ${campo} los tokens de RTM exceden los de la cuenta.`);
  return { tokensRtm, tokensCuenta };
}

export function leerUsoClaude(json: unknown): UsoClaudeMes {
  const o = json as { mes?: unknown; script_version?: unknown; metricas?: Record<string, unknown> } | null;
  if (!o || typeof o.mes !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(o.mes)) throw new ErrorCostos('sin_dato', 'JSON de Claude sin mes valido.');
  if (!o.metricas || typeof o.metricas !== 'object') throw new ErrorCostos('sin_dato', 'JSON de Claude sin metricas.');
  return {
    mes: o.mes,
    scriptVersion: typeof o.script_version === 'string' ? o.script_version : 'desconocida',
    principal: metrica(o.metricas.entrada_salida_escritura_cache, 'entrada_salida_escritura_cache'),
    soloSalida: metrica(o.metricas.solo_salida, 'solo_salida'),
    conLecturaCache: metrica(o.metricas.todo_con_lectura_cache, 'todo_con_lectura_cache'),
  };
}

/** Participacion cobrable de Claude: techo al punto porcentual. Sin tokens de la cuenta no hay dato (nunca 0 ni la mensualidad completa). */
export function participacionClaude(m: MetricaClaude): Participacion {
  return participacionPorConsumo(m.tokensRtm, m.tokensCuenta);
}
