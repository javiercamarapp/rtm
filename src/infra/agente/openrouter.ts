// Cliente de OpenRouter detras del puerto ClienteLlm. `fetch` entra por parametro: en esta ola nada llama a la red.
// Parametros de privacidad en CADA llamada: retencion cero (zdr) y data_collection "deny". Modelos solo de la politica 19 (tabla fija).
// Un modelo chino solo corre con una lista blanca de endpoints de EE.UU. con retencion cero; sin ella se omite (falla cerrado).
import { MODELOS, exigirPermitido, type ModeloIa } from '@/dominio/agente/modelos';
import { ErrorLlm, type ClienteLlm, type PeticionLlm, type RespuestaLlm } from '@/aplicacion/agente/puertos';

export type FetchJson = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface ConfigOpenRouter {
  apiKey: string;
  fetch: FetchJson;
  base?: string;
  tiempoMaxMs?: number;
  /** slug del modelo chino -> proveedores de EE.UU. con retencion cero permitidos. */
  endpointsEeuuPorModelo?: Readonly<Record<string, readonly string[]>>;
}

interface Uso {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

interface Completado {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Uso;
}

function modeloPorSlug(slug: string): ModeloIa | undefined {
  return Object.values(MODELOS).find((m) => m.slug === slug);
}

/** Costo en micro-USD: el que reporta el proveedor, o el calculado con la tabla de precios si no lo reporta. */
function costoMicro(uso: Uso | undefined, modelo: ModeloIa | undefined): bigint {
  if (typeof uso?.cost === 'number' && uso.cost >= 0) return BigInt(Math.round(uso.cost * 1_000_000));
  const ent = BigInt(uso?.prompt_tokens ?? 0);
  const sal = BigInt(uso?.completion_tokens ?? 0);
  if (!modelo) return 0n;
  return (ent * modelo.entradaMicroPorMtok + 999_999n) / 1_000_000n + (sal * modelo.salidaMicroPorMtok + 999_999n) / 1_000_000n;
}

export function crearClienteOpenRouter(config: ConfigOpenRouter): ClienteLlm {
  const base = config.base ?? 'https://openrouter.ai/api/v1';

  async function intentar(p: PeticionLlm, slugs: string[], soloProveedores: readonly string[] | null): Promise<RespuestaLlm> {
    const cuerpo = {
      models: slugs,
      messages: [
        { role: 'system', content: p.sistema },
        { role: 'user', content: p.usuario },
      ],
      max_tokens: p.maxTokensSalida,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'respuesta_del_agente', strict: true, schema: p.esquemaJson } },
      provider: { zdr: true, data_collection: 'deny', allow_fallbacks: true, ...(soloProveedores ? { only: soloProveedores, allow_fallbacks: false } : {}) },
      reasoning: { effort: 'minimal' },
      usage: { include: true },
    };
    let r: Awaited<ReturnType<FetchJson>>;
    try {
      r = await config.fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(config.tiempoMaxMs ?? 25_000),
      });
    } catch {
      throw new ErrorLlm('red', 'sin respuesta del proveedor');
    }
    if (!r.ok) throw new ErrorLlm('proveedor', `estado ${r.status}`);
    const datos = (await r.json().catch(() => null)) as Completado | null;
    const texto = datos?.choices?.[0]?.message?.content;
    if (typeof texto !== 'string') throw new ErrorLlm('respuesta_invalida', 'sin contenido');
    let contenido: unknown;
    try {
      contenido = JSON.parse(texto);
    } catch {
      throw new ErrorLlm('respuesta_invalida', 'contenido no es JSON');
    }
    const usado = datos?.model ?? slugs[0] ?? 'desconocido';
    return {
      contenido,
      modeloUsado: usado,
      tokensEntrada: datos?.usage?.prompt_tokens ?? 0,
      tokensSalida: datos?.usage?.completion_tokens ?? 0,
      costoMicroUsd: costoMicro(datos?.usage, modeloPorSlug(usado)),
    };
  }

  return {
    async extraer(p: PeticionLlm): Promise<RespuestaLlm> {
      // La politica manda: cualquier slug fuera de la tabla o prohibido se rechaza ANTES de la red.
      const modelos = p.modelos.map((slug) => {
        const m = modeloPorSlug(slug);
        if (!m) throw new ErrorLlm('politica', 'modelo fuera de la tabla de la politica');
        try {
          return exigirPermitido(m);
        } catch {
          throw new ErrorLlm('politica', 'modelo no permitido por la politica');
        }
      });
      const propios = modelos.filter((m) => !m.chino).map((m) => m.slug);
      const chinos = modelos.filter((m) => m.chino && (config.endpointsEeuuPorModelo?.[m.slug]?.length ?? 0) > 0);
      let ultimo: unknown = new ErrorLlm('politica', 'ningun modelo utilizable');
      if (propios.length > 0) {
        try {
          return await intentar(p, propios, null);
        } catch (e) {
          ultimo = e;
        }
      }
      for (const m of chinos) {
        try {
          return await intentar(p, [m.slug], config.endpointsEeuuPorModelo![m.slug]!);
        } catch (e) {
          ultimo = e;
        }
      }
      throw ultimo;
    },
  };
}
