// Fase 0a: lo que la prueba con modelos reales dejo fijado (slugs fechados, esquema aceptable para los proveedores, reserva del peor caso,
// conteos largos, cadena de respaldo y degradacion a comandos). Nada de red: fetch falso.
import { describe, it, expect } from 'vitest';
import { crearClienteOpenRouter, extraerObjetoJson, type FetchJson } from '@/infra/agente/openrouter';
import { crearAgenteEnMemoria } from '@/composicion/agente';
import { ErrorLlm } from '@/aplicacion/agente/puertos';
import { EsquemaRespuesta, adaptarEsquemaParaProveedor, esquemaJsonDeRespuesta, validarRespuesta } from '@/aplicacion/agente/esquemas';
import { MAX_TOKENS_SALIDA_R1, SISTEMA_R1, estimarTokens, estimarTokensSolicitud } from '@/aplicacion/agente/prompt';
import { MODELOS, cadenaParaRol, peorCasoTokens } from '@/dominio/agente/modelos';
import { MAX_LINEAS_CONTEO } from '@/dominio/agente/intenciones';
import { updateTexto, IDS_SIMULADOS } from '@/infra/agente/updates';

const HAIKU = MODELOS.haiku!.slug;
const LUNA = MODELOS.luna!.slug;
const DEEPSEEK = MODELOS.deepseek!.slug;

describe('slugs fechados (politica 19, Fase 0a)', () => {
  it('ningun modelo de texto usa alias sin fecha: todos terminan en AAAAMMDD (o -latest esta prohibido)', () => {
    for (const m of cadenaParaRol('texto')) {
      expect(m.slug).toMatch(/-\d{8}$/);
      expect(m.slug).not.toMatch(/latest|^~/);
    }
  });
  it('Haiku y DeepSeek van con json_object (su esquema va en el prompt); Luna con json_schema estricto', () => {
    expect(MODELOS.haiku!.salida).toBe('json_object');
    expect(MODELOS.deepseek!.salida).toBe('json_object');
    expect(MODELOS.luna!.salida ?? 'json_schema').toBe('json_schema');
  });
});

describe('esquema para el proveedor', () => {
  const contiene = (o: unknown, clave: string): boolean => {
    if (Array.isArray(o)) return o.some((x) => contiene(x, clave));
    if (o && typeof o === 'object') return Object.entries(o).some(([k, v]) => k === clave || contiene(v, clave));
    return false;
  };
  it('no lleva oneOf ni $schema (Anthropic via Vertex rechaza oneOf) y conserva las 31 variantes por tipo', () => {
    const e = esquemaJsonDeRespuesta();
    expect(contiene(e, 'oneOf')).toBe(false);
    expect(contiene(e, '$schema')).toBe(false);
    const variantes = (e as { properties: { acciones: { items: { anyOf: unknown[] } } } }).properties.acciones.items.anyOf;
    expect(variantes).toHaveLength(31);
  });
  it('sinRangos quita minLength/maxLength/minimum/maximum/minItems/maxItems/pattern y zod los sigue exigiendo', () => {
    const e = adaptarEsquemaParaProveedor(esquemaJsonDeRespuesta(), { sinRangos: true });
    for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern']) expect(contiene(e, k)).toBe(false);
    const fuera = validarRespuesta({ acciones: [{ tipo: 'pago', cliente_texto: 'Ariel', monto_centavos: 0, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: 'x' }], sospecha_inyeccion: false, baja_certeza: false });
    expect(fuera.ok).toBe(false);
  });
});

describe('listas largas (conteo de 40 sabores)', () => {
  const renglon = (i: number) => ({ modelo_texto: 'Zafiro 5K', sabor_texto: `sabor ${i}`, piezas: i % 25 });
  const conteo = (n: number) => ({ acciones: [{ tipo: 'conteo', lineas: Array.from({ length: n }, (_, i) => renglon(i)), fuente_cita: 'conteo' }], sospecha_inyeccion: false, baja_certeza: false });
  it('un conteo de 40 sabores valida; el tope es MAX_LINEAS_CONTEO', () => {
    expect(validarRespuesta(conteo(40)).ok).toBe(true);
    expect(validarRespuesta(conteo(MAX_LINEAS_CONTEO)).ok).toBe(true);
    expect(validarRespuesta(conteo(MAX_LINEAS_CONTEO + 1)).ok).toBe(false);
  });
  it('el tope de tokens de salida alcanza para 60 renglones (~28 tokens cada uno, medidos) con holgura', () => {
    expect(MAX_TOKENS_SALIDA_R1).toBeGreaterThanOrEqual(60 * 28 + 400);
  });
  it('un esquema de conteo con 31 variantes sigue siendo el de zod (la respuesta completa)', () => {
    expect(EsquemaRespuesta.safeParse(conteo(40)).success).toBe(true);
  });
});

describe('reserva del peor caso cuenta el esquema', () => {
  it('estimarTokensSolicitud suma el esquema: la reserva ya no queda en ~500 micro-USD', () => {
    const esquema = esquemaJsonDeRespuesta();
    const usuario = '<mensaje autor="javier" fuente="texto">Ariel pago 85,550</mensaje>';
    const sinEsquema = estimarTokens(SISTEMA_R1, usuario);
    const conEsquema = estimarTokensSolicitud(SISTEMA_R1, usuario, esquema);
    expect(conEsquema).toBeGreaterThan(sinEsquema + 5000);
    // Medido el 14-nov-2026: Haiku 10,964 tokens reales de entrada, Luna 4,316, DeepSeek 7,369. La estimacion debe cubrir al peor.
    expect(conEsquema).toBeGreaterThanOrEqual(10_964);
    const reserva = peorCasoTokens(cadenaParaRol('texto'), conEsquema, MAX_TOKENS_SALIDA_R1);
    expect(reserva).toBeGreaterThan(1_137n); // el real medido por mensaje era ~1,137 micro-USD con Haiku
    expect(reserva).toBeLessThan(5_000n);
  });
});

// ------------------------------------------------------------------ cadena de respaldo
function fetchGuionado(pasos: Array<{ ok?: boolean; status?: number; cuerpo?: unknown; lanza?: boolean }>) {
  const llamadas: Array<{ body: Record<string, unknown> }> = [];
  let i = 0;
  const f: FetchJson = async (_url, init) => {
    llamadas.push({ body: JSON.parse(init.body) });
    const p = pasos[Math.min(i++, pasos.length - 1)]!;
    if (p.lanza) throw new Error('red');
    return { ok: p.ok ?? true, status: p.status ?? 200, json: async () => p.cuerpo };
  };
  return { f, llamadas };
}
const bien = (modelo: string, contenido: unknown = { acciones: [], sospecha_inyeccion: false, baja_certeza: false }) => ({
  model: modelo,
  choices: [{ message: { content: JSON.stringify(contenido) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 4300, completion_tokens: 90, cost: 0.00035 },
});
const peticion = (modelos: string[]) => ({ rol: 'texto' as const, modelos, sistema: 'SISTEMA', usuario: 'USUARIO', maxTokensSalida: MAX_TOKENS_SALIDA_R1, esquemaJson: esquemaJsonDeRespuesta() });

describe('cadena de respaldo (Haiku -> Luna -> DeepSeek), un modelo a la vez', () => {
  it('Haiku va solo, con json_object y el esquema dentro del prompt; no manda response_format estricto', async () => {
    const { f, llamadas } = fetchGuionado([{ cuerpo: bien(HAIKU) }]);
    await crearClienteOpenRouter({ apiKey: 'LLAVE_FALSA', fetch: f }).extraer(peticion([HAIKU, LUNA]));
    expect(llamadas).toHaveLength(1);
    const b = llamadas[0]!.body as { models: string[]; response_format: { type: string }; messages: Array<{ content: string }>; reasoning: unknown; provider: unknown };
    expect(b.models).toEqual([HAIKU]);
    expect(b.response_format).toEqual({ type: 'json_object' });
    expect(b.messages[0]!.content).toContain('JSON Schema');
    expect(b.messages[0]!.content).toContain('"pedido_menudeo"');
    expect(b.reasoning).toEqual({ enabled: false });
    expect(b.provider).toMatchObject({ zdr: true, data_collection: 'deny' });
    expect(JSON.stringify(llamadas)).not.toContain('LLAVE_FALSA');
  });
  it('si el primer proveedor falla (500), responde el segundo con json_schema estricto', async () => {
    const { f, llamadas } = fetchGuionado([{ ok: false, status: 500, cuerpo: {} }, { cuerpo: bien(LUNA) }]);
    const r = await crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion([HAIKU, LUNA, DEEPSEEK]));
    expect(llamadas.map((l) => (l.body.models as string[])[0])).toEqual([HAIKU, LUNA]);
    expect(llamadas[1]!.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(r.modeloUsado).toBe(LUNA);
    expect(r.costoMicroUsd).toBe(350n);
  });
  it('si el primero devuelve texto que no es JSON o lanza, tambien pasa al siguiente', async () => {
    for (const primero of [{ cuerpo: { choices: [{ message: { content: 'no json' } }] } }, { lanza: true }, { cuerpo: { choices: [] } }]) {
      const { f, llamadas } = fetchGuionado([primero, { cuerpo: bien(LUNA) }]);
      const r = await crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion([HAIKU, LUNA]));
      expect(llamadas).toHaveLength(2);
      expect(r.modeloUsado).toBe(LUNA);
    }
  });
  it('DeepSeek solo es el ultimo recurso, con lista blanca de EE.UU., sin respaldo a otros y con json_object', async () => {
    const { f, llamadas } = fetchGuionado([{ ok: false, status: 502, cuerpo: {} }, { ok: false, status: 429, cuerpo: {} }, { cuerpo: bien(DEEPSEEK) }]);
    const llm = crearClienteOpenRouter({ apiKey: 'k', fetch: f, endpointsEeuuPorModelo: { [DEEPSEEK]: ['wafer/us'] } });
    const r = await llm.extraer(peticion([HAIKU, LUNA, DEEPSEEK]));
    expect(llamadas).toHaveLength(3);
    expect(llamadas[2]!.body.provider).toMatchObject({ zdr: true, data_collection: 'deny', only: ['wafer/us'], allow_fallbacks: false });
    expect(llamadas[2]!.body.response_format).toEqual({ type: 'json_object' });
    expect(r.modeloUsado).toBe(DEEPSEEK);
  });
  it('sin lista blanca de EE.UU. DeepSeek no se intenta nunca (falla cerrado) y el error es el del ultimo proveedor real', async () => {
    const { f, llamadas } = fetchGuionado([{ ok: false, status: 500, cuerpo: {} }]);
    await expect(crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion([HAIKU, LUNA, DEEPSEEK]))).rejects.toMatchObject({ motivo: 'proveedor' });
    expect(llamadas.map((l) => (l.body.models as string[])[0])).toEqual([HAIKU, LUNA]);
  });
});

describe('tolerancia a la envoltura del JSON (json_object)', () => {
  it('quita la cerca de codigo y el texto alrededor; sin llaves deja el texto tal cual', () => {
    expect(extraerObjetoJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extraerObjetoJson('Aqui va: {"a":{"b":2}} listo')).toBe('{"a":{"b":2}}');
    expect(extraerObjetoJson('{"a":1}')).toBe('{"a":1}');
    expect(extraerObjetoJson('no hay json')).toBe('no hay json');
  });
  it('una respuesta envuelta en cerca se acepta, pero sigue sujeta a zod estricto', async () => {
    const envuelto = { model: HAIKU, choices: [{ message: { content: '```json\n{"acciones":[],"sospecha_inyeccion":false,"baja_certeza":false}\n```' } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.0001 } };
    const { f } = fetchGuionado([{ cuerpo: envuelto }]);
    const r = await crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion([HAIKU]));
    expect(validarRespuesta(r.contenido).ok).toBe(true);
    expect(validarRespuesta({ ...(r.contenido as object), extra: 1 }).ok).toBe(false);
  });
});

describe('degradacion a comandos con todos los proveedores caidos', () => {
  it('el texto libre responde "sin IA" y libera la reserva; el comando sigue funcionando', async () => {
    const { f } = fetchGuionado([{ ok: false, status: 500, cuerpo: {} }]);
    const h = crearAgenteEnMemoria({ llm: crearClienteOpenRouter({ apiKey: 'k', fetch: f }), config: { confirmarMovimientos: false } });
    const ids = IDS_SIMULADOS;
    const r1 = await h.agente.procesarUpdate(updateTexto(h.contador, { de: ids.angelo, chat: ids.grupoSocios, texto: 'Cliente Norte 28 jupiter' }));
    expect(r1).toEqual({ estado: 'sin_ia' });
    expect(h.presupuesto.snapshot()!.diaMicro).toBe(0n);
    const r2 = await h.agente.procesarUpdate(updateTexto(h.contador, { de: ids.angelo, chat: ids.grupoSocios, texto: '/pedido Cliente Norte | jupiter 28' }));
    expect(r2).not.toEqual({ estado: 'sin_ia' });
    expect(h.telegram.aChat(ids.grupoSocios).map((m) => m.texto).join('\n')).toContain('Registrado P-0001');
  });
  it('ErrorLlm es el unico tipo que degrada; un error del proveedor queda tipado', async () => {
    const { f } = fetchGuionado([{ ok: false, status: 500, cuerpo: {} }]);
    await expect(crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion([HAIKU]))).rejects.toBeInstanceOf(ErrorLlm);
  });
});
