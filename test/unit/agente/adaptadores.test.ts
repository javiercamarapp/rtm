import { describe, it, expect } from 'vitest';
import { MAX_CUERPO_BYTES, leerUpdate, manejarWebhook, secretoValido } from '@/infra/agente/telegram_webhook';
import { ErrorTelegram, crearEnviadorTelegram, type FetchLike } from '@/infra/agente/telegram_api';
import { crearClienteOpenRouter, type FetchJson } from '@/infra/agente/openrouter';
import { ErrorLlm } from '@/aplicacion/agente/puertos';
import { esquemaJsonDeRespuesta } from '@/aplicacion/agente/esquemas';
import { AlmacenTokensMemoria, EnviadorTelegramMemoria } from '@/infra/agente/memoria';
import { escenario, pago, unaAccion, IDS } from './ayudas';

describe('webhook de Telegram', () => {
  it('el secreto se compara en tiempo constante; vacio o distinto no pasa', () => {
    expect(secretoValido('abc123', 'abc123')).toBe(true);
    expect(secretoValido('abc124', 'abc123')).toBe(false);
    expect(secretoValido('abc', 'abc123')).toBe(false);
    expect(secretoValido(null, 'abc123')).toBe(false);
    expect(secretoValido('', '')).toBe(false);
  });

  const cuerpoValido = JSON.stringify({
    update_id: 5,
    message: { message_id: 9, from: { id: 1 }, chat: { id: -1, type: 'supergroup' }, date: 1, text: 'hola 1', photo: [{}], voice: {}, forward_origin: { type: 'user' }, edit_date: 3, caption: 'c' },
  });

  it('lee un update valido y marca foto, audio y reenvio', () => {
    const r = leerUpdate(cuerpoValido);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.update.message).toMatchObject({ has_photo: true, has_audio: true, forward_origin: { type: 'user' }, edit_date: 3, caption: 'c', text: 'hola 1' });
  });
  it('un update de boton y uno editado', () => {
    const b = leerUpdate(JSON.stringify({ update_id: 6, callback_query: { id: 'x', from: { id: 1 }, data: 'b1', message: { message_id: 1, chat: { id: -1, type: 'supergroup' } } } }));
    expect(b.ok && b.update.callback_query?.data).toBe('b1');
    const ed = leerUpdate(JSON.stringify({ update_id: 7, edited_message: { message_id: 1, chat: { id: 5, type: 'private' }, date: 1 } }));
    expect(ed.ok && ed.update.edited_message?.message_id).toBe(1);
  });
  it('rechaza cuerpo demasiado grande, JSON roto y formas invalidas', () => {
    expect(leerUpdate('x'.repeat(MAX_CUERPO_BYTES + 1))).toEqual({ ok: false, motivo: 'demasiado_grande' });
    expect(leerUpdate('{no es json')).toEqual({ ok: false, motivo: 'json_invalido' });
    expect(leerUpdate(JSON.stringify({ update_id: 'no' }))).toEqual({ ok: false, motivo: 'forma_invalida' });
    expect(leerUpdate(JSON.stringify({ update_id: 1, callback_query: { id: 'x', from: { id: 1 }, data: 'x'.repeat(65) } }))).toEqual({ ok: false, motivo: 'forma_invalida' });
  });
  it('secreto invalido -> 401 y no procesa; todo lo demas responde 200', async () => {
    let llamadas = 0;
    const procesar = async () => {
      llamadas++;
      return { estado: 'procesado', acciones: 0 } as const;
    };
    expect(await manejarWebhook({ cabeceraSecreto: 'mal', secretoEsperado: 'bien', cuerpo: cuerpoValido, procesar })).toEqual({ status: 401, detalle: 'secreto_invalido' });
    expect(llamadas).toBe(0);
    expect(await manejarWebhook({ cabeceraSecreto: 'bien', secretoEsperado: 'bien', cuerpo: '{', procesar })).toEqual({ status: 200, detalle: 'ignorado' });
    expect(await manejarWebhook({ cabeceraSecreto: 'bien', secretoEsperado: 'bien', cuerpo: cuerpoValido, procesar })).toEqual({ status: 200, detalle: 'procesado' });
    const falla = async () => {
      throw new Error('boom');
    };
    expect(await manejarWebhook({ cabeceraSecreto: 'bien', secretoEsperado: 'bien', cuerpo: cuerpoValido, procesar: falla })).toEqual({ status: 200, detalle: 'error' });
  });
  it('de punta a punta con el agente: el mismo update dos veces por el webhook se aplica una vez', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 700_000))]);
    const cuerpo = JSON.stringify({ update_id: 55, message: { message_id: 55, from: { id: IDS.angelo }, chat: { id: IDS.grupoSocios, type: 'supergroup' }, date: 1, text: 'pago Cliente Norte 7,000' } });
    const args = { cabeceraSecreto: 's', secretoEsperado: 's', cuerpo, procesar: (u: Parameters<typeof e.agente.procesarUpdate>[0]) => e.agente.procesarUpdate(u) };
    await manejarWebhook(args);
    await manejarWebhook(args);
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
});

function fetchTelegram(respuestas: Array<{ ok?: boolean; status?: number; cuerpo?: unknown; lanza?: boolean }>) {
  const llamadas: Array<{ url: string; body: Record<string, unknown> }> = [];
  let i = 0;
  const f: FetchLike = async (url, init) => {
    llamadas.push({ url, body: JSON.parse(init.body) });
    const r = respuestas[Math.min(i++, respuestas.length - 1)]!;
    if (r.lanza) throw new Error('red');
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.cuerpo ?? { ok: true, result: { message_id: 77 } } };
  };
  return { f, llamadas };
}

describe('cliente de la Bot API', () => {
  it('envia con teclado en linea, protect_content y sin vista previa; el token solo va en la URL', async () => {
    const { f, llamadas } = fetchTelegram([{}]);
    const tg = crearEnviadorTelegram({ token: 'TOKEN_FALSO', fetch: f });
    const r = await tg.enviar({ chatId: -5, texto: 'hola', botones: [[{ texto: 'Si', callbackData: 'b1' }]], protegido: true, respondeA: 3 });
    expect(r.messageId).toBe(77);
    expect(llamadas[0]!.url).toBe('https://api.telegram.org/botTOKEN_FALSO/sendMessage');
    expect(llamadas[0]!.body).toMatchObject({ chat_id: -5, text: 'hola', protect_content: true, reply_to_message_id: 3, reply_markup: { inline_keyboard: [[{ text: 'Si', callback_data: 'b1' }]] }, link_preview_options: { is_disabled: true } });
    expect(JSON.stringify(llamadas[0]!.body)).not.toContain('TOKEN_FALSO');
  });
  it('editar sin botones retira el teclado; responder callback; salir del chat', async () => {
    const { f, llamadas } = fetchTelegram([{ cuerpo: { ok: true, result: true } }]);
    const tg = crearEnviadorTelegram({ token: 't', fetch: f });
    await tg.editar(1, 2, 'x');
    await tg.responderCallback('cb', 'listo', false);
    await tg.responderCallback('cb', null, true);
    await tg.salirDelChat(9);
    expect(llamadas.map((l) => l.url.split('/').pop())).toEqual(['editMessageText', 'answerCallbackQuery', 'answerCallbackQuery', 'leaveChat']);
    expect(llamadas[0]!.body.reply_markup).toEqual({ inline_keyboard: [] });
  });
  it('errores tipados sin filtrar el token: 429 con retry_after, 403, 400, 5xx, red caida', async () => {
    const casos: Array<[Parameters<typeof fetchTelegram>[0][number], string, number | null]> = [
      [{ ok: false, status: 429, cuerpo: { ok: false, parameters: { retry_after: 7 } } }, 'rate_limit', 7],
      [{ ok: false, status: 403, cuerpo: { ok: false } }, 'sin_destino', null],
      [{ ok: false, status: 400, cuerpo: { ok: false } }, 'rechazado', null],
      [{ ok: false, status: 502, cuerpo: { ok: false } }, 'servidor', null],
      [{ ok: false, status: 404, cuerpo: { ok: false } }, 'rechazado', null],
      [{ lanza: true }, 'red', null],
    ];
    for (const [resp, codigo, retry] of casos) {
      const { f } = fetchTelegram([resp]);
      const tg = crearEnviadorTelegram({ token: 'TOKEN_FALSO', fetch: f });
      const err = await tg.enviar({ chatId: 1, texto: 'x' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ErrorTelegram);
      expect((err as ErrorTelegram).codigo).toBe(codigo);
      expect((err as ErrorTelegram).reintentarEnSeg).toBe(retry);
      expect((err as Error).message).not.toContain('TOKEN_FALSO');
    }
    const sinJson: FetchLike = async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error('x')) });
    await expect(crearEnviadorTelegram({ token: 't', fetch: sinJson }).enviar({ chatId: 1, texto: 'x' })).rejects.toBeInstanceOf(ErrorTelegram);
  });
});

function fetchOpenRouter(respuestas: Array<{ ok?: boolean; status?: number; cuerpo?: unknown; lanza?: boolean }>) {
  const llamadas: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  let i = 0;
  const f: FetchJson = async (url, init) => {
    llamadas.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = respuestas[Math.min(i++, respuestas.length - 1)]!;
    if (r.lanza) throw new Error('red');
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.cuerpo };
  };
  return { f, llamadas };
}
const completado = (contenido: unknown, uso: Record<string, number> = { prompt_tokens: 1000, completion_tokens: 100, cost: 0.00015 }) => ({
  model: 'anthropic/claude-haiku-5.5',
  choices: [{ message: { content: JSON.stringify(contenido) } }],
  usage: uso,
});
const peticion = (modelos: string[]) => ({ rol: 'texto' as const, modelos, sistema: 's', usuario: 'u', maxTokensSalida: 700, esquemaJson: esquemaJsonDeRespuesta() });

describe('cliente de OpenRouter (politica 19 y privacidad)', () => {
  it('cada llamada lleva retencion cero, data_collection deny, JSON estricto y modelos de la politica; el costo real viene del proveedor', async () => {
    const { f, llamadas } = fetchOpenRouter([{ cuerpo: completado({ acciones: [] }) }]);
    const llm = crearClienteOpenRouter({ apiKey: 'LLAVE_FALSA', fetch: f });
    const r = await llm.extraer(peticion(['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna', 'deepseek/deepseek-v4.1-flash']));
    const c = llamadas[0]!;
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.headers.authorization).toBe('Bearer LLAVE_FALSA');
    expect(c.body.models).toEqual(['anthropic/claude-haiku-5.5', 'openai/gpt-6-luna']); // el chino no entra sin lista blanca de EE.UU.
    expect(c.body.provider).toMatchObject({ zdr: true, data_collection: 'deny' });
    expect(c.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(c.body).toMatchObject({ max_tokens: 700, temperature: 0, reasoning: { effort: 'minimal' } });
    expect(JSON.stringify(c.body)).not.toContain('LLAVE_FALSA');
    expect(r.costoMicroUsd).toBe(150n);
    expect(r.tokensEntrada).toBe(1000);
    expect(r.contenido).toEqual({ acciones: [] });
  });
  it('sin costo reportado, lo calcula con la tabla de precios (hacia arriba)', async () => {
    const { f } = fetchOpenRouter([{ cuerpo: completado({}, { prompt_tokens: 1000, completion_tokens: 100 }) }]);
    const r = await crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion(['anthropic/claude-haiku-5.5']));
    expect(r.costoMicroUsd).toBe(100n + 50n);
    const sinUso = fetchOpenRouter([{ cuerpo: { choices: [{ message: { content: '{}' } }] } }]);
    const r2 = await crearClienteOpenRouter({ apiKey: 'k', fetch: sinUso.f }).extraer(peticion(['anthropic/claude-haiku-5.5']));
    expect(r2.costoMicroUsd).toBe(0n);
    expect(r2.modeloUsado).toBe('anthropic/claude-haiku-5.5');
  });
  it('el modelo chino solo corre con endpoints de EE.UU. en lista blanca y sin respaldo a otros', async () => {
    const { f, llamadas } = fetchOpenRouter([{ ok: false, status: 500, cuerpo: {} }, { cuerpo: completado({ acciones: [] }) }]);
    const llm = crearClienteOpenRouter({ apiKey: 'k', fetch: f, endpointsEeuuPorModelo: { 'deepseek/deepseek-v4.1-flash': ['proveedor-eeuu-1'] } });
    const r = await llm.extraer(peticion(['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash']));
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]!.body.models).toEqual(['deepseek/deepseek-v4.1-flash']);
    expect(llamadas[1]!.body.provider).toMatchObject({ zdr: true, data_collection: 'deny', only: ['proveedor-eeuu-1'], allow_fallbacks: false });
    expect(r.contenido).toEqual({ acciones: [] });
  });
  it('la politica se aplica ANTES de la red: Sonnet, Gemini o un slug desconocido ni se intentan', async () => {
    const { f, llamadas } = fetchOpenRouter([{ cuerpo: completado({}) }]);
    const llm = crearClienteOpenRouter({ apiKey: 'k', fetch: f });
    for (const slug of ['anthropic/claude-sonnet-5.5', 'google/gemini-3.1-flash-lite', 'otro/modelo']) {
      await expect(llm.extraer(peticion([slug]))).rejects.toMatchObject({ motivo: 'politica' });
    }
    expect(llamadas).toHaveLength(0);
  });
  it('un modelo en la tabla que supera el techo tambien se rechaza', async () => {
    const { f } = fetchOpenRouter([{ cuerpo: completado({}) }]);
    const llm = crearClienteOpenRouter({ apiKey: 'k', fetch: f });
    await expect(llm.extraer(peticion(['anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5']))).rejects.toBeInstanceOf(ErrorLlm);
  });
  it('errores tipados: red, estado no 2xx, contenido ausente o no JSON; solo el chino sin lista -> politica', async () => {
    const casos: Array<[Parameters<typeof fetchOpenRouter>[0][number], string]> = [
      [{ lanza: true }, 'red'],
      [{ ok: false, status: 429, cuerpo: {} }, 'proveedor'],
      [{ cuerpo: { choices: [] } }, 'respuesta_invalida'],
      [{ cuerpo: { choices: [{ message: { content: 'no json' } }] } }, 'respuesta_invalida'],
    ];
    for (const [resp, motivo] of casos) {
      const { f } = fetchOpenRouter([resp]);
      await expect(crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion(['anthropic/claude-haiku-5.5']))).rejects.toMatchObject({ motivo });
    }
    const { f } = fetchOpenRouter([{ cuerpo: completado({}) }]);
    await expect(crearClienteOpenRouter({ apiKey: 'k', fetch: f }).extraer(peticion(['deepseek/deepseek-v4.1-flash']))).rejects.toMatchObject({ motivo: 'politica' });
    const sinJson: FetchJson = async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error('x')) });
    await expect(crearClienteOpenRouter({ apiKey: 'k', fetch: sinJson }).extraer(peticion(['anthropic/claude-haiku-5.5']))).rejects.toMatchObject({ motivo: 'respuesta_invalida' });
  });
});

describe('dobles en memoria', () => {
  it('un token no puede pasar de 64 bytes (limite de callback_data)', async () => {
    const t = new AlmacenTokensMemoria(() => 'x'.repeat(65));
    await expect(t.emitir({ accion: 'cancelar', rolesPermitidos: ['socio'], chatId: 1, caducaEn: new Date(), grupoExclusivo: null, payload: null })).rejects.toThrow(RangeError);
  });
  it('el token por omision cabe en 64 bytes y es unico', async () => {
    const t = new AlmacenTokensMemoria();
    const a = await t.emitir({ accion: 'cancelar', rolesPermitidos: ['socio'], chatId: 1, caducaEn: new Date(), grupoExclusivo: null, payload: null });
    const b = await t.emitir({ accion: 'cancelar', rolesPermitidos: ['socio'], chatId: 1, caducaEn: new Date(), grupoExclusivo: null, payload: null });
    expect(Buffer.byteLength(a)).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });
  it('Telegram caido: el agente no se cae, deja el fallo registrado y responde error', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 700_000))]);
    e.telegram.fallarProximos = 99;
    const r = await e.socio('angelo', 'pago Cliente Norte 7,000');
    expect(r).toEqual({ estado: 'error' });
    expect(e.almacen.eventos.some((x) => x.tipo === 'validacion_fallida')).toBe(true);
    const tg = new EnviadorTelegramMemoria();
    expect(tg.aChat(1)).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ejecutarGuion } from '@/composicion/simulador_agente';

describe('simulador local de conversaciones', () => {
  it('reproduce el guion de ejemplo de punta a punta', async () => {
    const guion = readFileSync(join(__dirname, '../../../scripts/agente/guion-ejemplo.txt'), 'utf8').split('\n');
    const t = (await ejecutarGuion(guion)).join('\n');
    expect(t).toContain('¿cual modelo es "waka 50"?');
    expect(t).toContain('Registrado P-0001 por Angelo');
    expect(t).toContain('Toma T-0001 pendiente de autorizacion');
    expect(t).toContain('(alerta de pantalla: Esta tarjeta es de los socios.)');
    expect(t).toContain('Toma T-0001 autorizada por Javier.');
    expect(t).toContain('Deshecho con el contramovimiento X-0001');
    expect(t).toContain('Modo sin IA activo');
    expect(t).toContain('Waka Jupiter 50K');
  });
  it('lineas raras: sin boton, sin entender, reloj y caducar', async () => {
    const t = (await ejecutarGuion(['# nota', '', 'boton angelo 1', 'dilo otra vez', 'reloj +5m', 'reloj +2h', 'caducar'])).join('\n');
    expect(t).toContain('(no hay ese boton)');
    expect(t).toContain('(linea no entendida)');
    expect(t).toContain('(tomas caducadas: 0)');
  });
});
