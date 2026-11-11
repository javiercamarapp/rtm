// Router de modelos por rol (politica 19, 10-nov-2026). Ningun modelo por encima del techo; sin escalamiento a Sonnet ni superiores.
// Precios en micro-USD por millon de tokens (1 USD = 1,000,000 micro-USD). Referencia: OpenRouter, 10-nov-2026.
// Los slugs son los de referencia de la politica; antes de produccion se fijan por slug FECHADO (nunca alias "latest").

export type RolIa = 'texto' | 'vision' | 'vision_segunda' | 'audio' | 'redaccion';

export interface ModeloIa {
  slug: string;
  entradaMicroPorMtok: bigint;
  salidaMicroPorMtok: bigint;
  /** Solo audio: micro-USD por segundo de nota de voz (supuesto conservador hasta medir). */
  microPorSegundo?: bigint;
  vision: boolean;
  /** Modelo de origen chino: solo con endpoints de EE.UU. con retencion cero (lista blanca inyectada, falla cerrado). */
  chino: boolean;
}

/** Techo operativo: entrada 0.15 y salida 0.60 USD por millon de tokens. */
export const TECHO_ENTRADA_MICRO_POR_MTOK = 150_000n;
export const TECHO_SALIDA_MICRO_POR_MTOK = 600_000n;

export const MODELOS: Readonly<Record<string, ModeloIa>> = {
  haiku: { slug: 'anthropic/claude-haiku-5.5', entradaMicroPorMtok: 100_000n, salidaMicroPorMtok: 500_000n, vision: true, chino: false },
  luna: { slug: 'openai/gpt-6-luna', entradaMicroPorMtok: 100_000n, salidaMicroPorMtok: 500_000n, vision: true, chino: false },
  deepseek: { slug: 'deepseek/deepseek-v4.1-flash', entradaMicroPorMtok: 51_000n, salidaMicroPorMtok: 567_000n, vision: false, chino: true },
  whisper: {
    slug: 'openai/whisper-large-v3-turbo',
    entradaMicroPorMtok: 0n,
    salidaMicroPorMtok: 0n,
    microPorSegundo: 30n,
    vision: false,
    chino: false,
  },
};

/** Tabla de roles: principal primero, luego respaldos (en ese orden fijo). */
export const CADENAS: Readonly<Record<RolIa, readonly string[]>> = {
  texto: ['haiku', 'luna', 'deepseek'],
  vision: ['haiku'],
  vision_segunda: ['luna'],
  audio: ['whisper'],
  redaccion: ['luna', 'haiku'],
};

/** Modelos eliminados por la politica: escalamiento a Sonnet, modelos de 2/10 o mas, Gemini (retiene prompts) y Qwen (sin endpoint EE.UU. con retencion cero). */
const PROHIBIDOS: readonly RegExp[] = [/sonnet/i, /opus/i, /gemini/i, /qwen/i, /gpt-6(?!-luna)/i];

export function esProhibido(slug: string): boolean {
  return PROHIBIDOS.some((re) => re.test(slug));
}

export function dentroDelTecho(m: ModeloIa): boolean {
  return m.entradaMicroPorMtok <= TECHO_ENTRADA_MICRO_POR_MTOK && m.salidaMicroPorMtok <= TECHO_SALIDA_MICRO_POR_MTOK;
}

export class ErrorPoliticaModelos extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorPoliticaModelos';
  }
}

/** Valida un modelo contra la politica; un modelo sobre el techo requiere autorizacion expresa del duenio (no se concede aqui). */
export function exigirPermitido(m: ModeloIa): ModeloIa {
  if (esProhibido(m.slug)) throw new ErrorPoliticaModelos(`Modelo prohibido por la politica 19: ${m.slug}`);
  if (!dentroDelTecho(m)) throw new ErrorPoliticaModelos(`Modelo sobre el techo de precio: ${m.slug}`);
  return m;
}

/** Cadena de modelos de un rol, ya validada contra la politica. */
export function cadenaParaRol(rol: RolIa, tabla: Readonly<Record<RolIa, readonly string[]>> = CADENAS, modelos: Readonly<Record<string, ModeloIa>> = MODELOS): ModeloIa[] {
  return tabla[rol].map((clave) => {
    const m = modelos[clave];
    if (!m) throw new ErrorPoliticaModelos(`Modelo desconocido en la tabla: ${clave}`);
    if (rol.startsWith('vision') && !m.vision) throw new ErrorPoliticaModelos(`El rol ${rol} exige vision: ${m.slug}`);
    return exigirPermitido(m);
  });
}

function techoDiv(num: bigint, den: bigint): bigint {
  return (num + den - 1n) / den;
}

/**
 * Peor caso de una llamada con respaldos: se reserva el del modelo MAS caro del arreglo
 * (tokens de entrada x precio de entrada + max_tokens x precio de salida), redondeado hacia arriba.
 */
export function peorCasoTokens(cadena: readonly ModeloIa[], tokensEntrada: number, maxTokensSalida: number): bigint {
  let peor = 0n;
  for (const m of cadena) {
    const costo = techoDiv(BigInt(tokensEntrada) * m.entradaMicroPorMtok, 1_000_000n) + techoDiv(BigInt(maxTokensSalida) * m.salidaMicroPorMtok, 1_000_000n);
    if (costo > peor) peor = costo;
  }
  return peor;
}

export function peorCasoAudio(m: ModeloIa, segundos: number): bigint {
  return BigInt(segundos) * (m.microPorSegundo ?? 0n);
}

export interface LecturaComprobante {
  montoCentavos: bigint | null;
}

export type ComparacionLecturas = { estado: 'coincide'; montoCentavos: bigint } | { estado: 'discrepa' };

/** Dos lecturas independientes de una foto (Haiku y Luna): si los montos no coinciden, se pregunta a un socio. */
export function compararLecturas(a: LecturaComprobante, b: LecturaComprobante): ComparacionLecturas {
  if (a.montoCentavos !== null && b.montoCentavos !== null && a.montoCentavos === b.montoCentavos) {
    return { estado: 'coincide', montoCentavos: a.montoCentavos };
  }
  return { estado: 'discrepa' };
}
