// E2E de la INTEGRACION del bot (frenos + conversacion + interprete) contra una base temporal con todas las migraciones, sin bot real: el transporte de Telegram es un fetch falso que
// NUNCA sale a api.telegram.org y el extractor de IA es el simulado determinista. Recorrido de punta a punta: mensaje del socio, el interprete alimenta los slots, el bot pregunta lo que
// falta, el socio responde con botones, la maquina llama a ejecutarOperacionCompleta del carril de frenos, el registro sale por el eco con el mensaje rico y Deshacer, y se deshace.
// Todo dentro de UNA transaccion que se revierte al final.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { procesarWebhook, type DepsProduccion } from '@/composicion/produccion';
import { LlmHeuristico } from '@/infra/agente/llm_simulado';
import type { FetchLike } from '@/infra/agente/telegram_api';
import type { ClienteLlm } from '@/aplicacion/agente/puertos';
import type { Sql } from '@/infra/postgres/servidor';
import { estado } from '../e2e/ayudas';

const c = new pg.Client({ connectionString: estado().DB_URL });
let n = 0;
let cola: Promise<unknown> = Promise.resolve();
const sql: Sql = (t, p = []) => {
  const turno = cola.then(async () => {
    const sp = `s${n++}`;
    await c.query(`savepoint ${sp}`);
    try {
      const r = (await c.query(t, [...p])).rows as never;
      await c.query(`release savepoint ${sp}`);
      return r;
    } catch (e) {
      await c.query(`rollback to savepoint ${sp}`);
      throw e;
    }
  });
  cola = turno.catch(() => undefined);
  return turno as never;
};
const q = async <T = Record<string, unknown>>(t: string, p: unknown[] = []): Promise<T[]> => sql<T>(t, p);

const SECRETO = 'secreto-de-prueba-' + 'x'.repeat(16);
const TOKEN_FALSO = 'T'.repeat(30);
const ID = { angelo: 6_000_001, javier: 6_000_002, omar: 6_000_003, extrano: 6_999_999, grupo: -100_900 };

interface Enviado { id: number; chat: number; texto: string; botones: { texto: string; data: string }[][] }

class Sala {
  enviados: Enviado[] = [];
  editados: string[] = [];
  llamadasRed: string[] = [];
  private idMsg = 1000;
  private upd = 1;
  private msg = 1;
  ahora = new Date();
  llm: ClienteLlm = new LlmHeuristico();

  fetchFalso: FetchLike = async (url, init) => {
    // Jamas se llama a la red: se registra el metodo y se contesta como Telegram.
    this.llamadasRed.push(url.replace(TOKEN_FALSO, '<token>'));
    const metodo = url.split('/').pop()!;
    const cuerpo = JSON.parse(init.body) as { chat_id: number; text: string; reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } };
    if (metodo === 'sendMessage') {
      const id = ++this.idMsg;
      this.enviados.push({ id, chat: cuerpo.chat_id, texto: cuerpo.text, botones: (cuerpo.reply_markup?.inline_keyboard ?? []).map((f) => f.map((b) => ({ texto: b.text, data: b.callback_data }))) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: id } }) };
    }
    if (metodo === 'editMessageText') this.editados.push(cuerpo.text);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };

  configAgente: DepsProduccion['configAgente'] = { limiteMensajesPorMinuto: 0 };
  deps = (): DepsProduccion => ({ configAgente: this.configAgente, sql, ahora: () => this.ahora, llm: this.llm, fetchFn: this.fetchFalso, entorno: { TELEGRAM_BOT_TOKEN: TOKEN_FALSO, TELEGRAM_WEBHOOK_SECRET: SECRETO } });
  webhook = (u: unknown, secreto: string | null = SECRETO) => procesarWebhook(this.deps(), secreto, JSON.stringify(u));

  async escribir(quien: keyof typeof ID, texto: string, extra: { updateId?: number; messageId?: number } = {}) {
    const chat = quien === 'omar' ? ID.omar : ID.grupo;
    const messageId = extra.messageId ?? ++this.msg;
    return this.webhook({
      update_id: extra.updateId ?? ++this.upd,
      message: { message_id: messageId, from: { id: ID[quien] }, chat: { id: chat, type: quien === 'omar' ? 'private' : 'supergroup' }, date: 1_794_000_000, text: texto },
    });
  }

  ultimo(): Enviado {
    const u = this.enviados.at(-1);
    if (!u) throw new Error('sin mensajes');
    return u;
  }

  async pulsar(quien: keyof typeof ID, texto: string, de: Enviado = this.ultimo()) {
    const b = de.botones.flat().find((x) => x.texto === texto);
    if (!b) throw new Error(`no hay boton "${texto}" en el mensaje: ${de.texto.slice(0, 300)}`);
    return this.webhook({ update_id: ++this.upd, callback_query: { id: `cb${this.upd}`, from: { id: ID[quien] }, message: { message_id: de.id, chat: { id: quien === 'omar' ? ID.omar : ID.grupo, type: 'supergroup' } }, data: b.data } });
  }
}

const sala = new Sala();
const cuenta = async (t: string) => Number((await q<{ n: string }>(`select count(*)::text as n from ${t}`))[0]!.n);
const textosDe = (desde: number) => sala.enviados.slice(desde).map((e) => e.texto);

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier'], [ID.omar, 'omar']] as const) await q('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
  await q("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
  await q("select catalogo.asegurar_cliente('Ib Cliente', 'Javier')");
  await q("select catalogo.asegurar_cliente('Ib Omar Persona', 'Javier')");
  await q("select catalogo.asegurar_persona_bodega('Ib Omar Persona', 'Ib Omar Persona')");
  await q("select catalogo.asegurar_modelo('Ib Marca', 'Ib Modelo', 10000, 'ambas')");
  await q("select catalogo.asegurar_sku('Ib Modelo', 'Uva')");
  await q("select catalogo.fijar_costo('ib:k', 'Isaac', 'Ib Modelo', 11000, negocio.hoy() - 30, 'prueba')");
  await q("select catalogo.fijar_precio('ib:p', 'Ib Cliente', 'Ib Modelo', 25000, negocio.hoy() - 30, 'chat')");
  await q("select operacion.registrar_movimiento('ib:m', 'Ib Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1100000, negocio.hoy() - 5)");
});
afterAll(async () => {
  await c.query('rollback');
  await c.end();
});

describe('bot integrado: conversacion + frenos + interprete', () => {
  it('con la escritura apagada la conversacion no registra nada y lo dice', async () => {
    await sala.escribir('angelo', 'Ib Cliente: ib modelo/uva 24');
    const t = textosDe(0).join('\n');
    expect(t).toContain('solo lectura');
    expect(await cuenta('operacion.pedido')).toBe(0);
    await sala.escribir('javier', '/escritura');
    expect(sala.ultimo().texto).toContain('Escritura ACTIVADA por Javier');
  });

  it('mensaje -> pregunta -> respuesta -> registro -> eco rico con Deshacer -> deshacer', async () => {
    const inicio = sala.enviados.length;
    // 1) El interprete entiende cliente y renglon; faltan modalidad (contado o credito) y envio: el bot PREGUNTA, no registra.
    await sala.escribir('angelo', 'Ib Cliente: ib modelo/uva 24');
    const p1 = sala.ultimo();
    expect(p1.texto).toMatch(/contado o a crédito/i);
    expect(p1.botones.flat().map((b) => b.texto)).toEqual(expect.arrayContaining(['De contado', 'A crédito']));
    expect(await cuenta('operacion.pedido')).toBe(0);
    expect((await q<{ estado: string }>("select estado from agente.conversacion where operacion = 'pedido_bodega' and chat_id = -100900 order by id desc"))[0]!.estado).toBe('abierta');
    // 2) Responde con el boton; pregunta el envio.
    await sala.pulsar('angelo', 'De contado');
    const p2 = sala.ultimo();
    expect(p2.texto).toMatch(/envío/i);
    expect(await cuenta('operacion.pedido')).toBe(0);
    // 3) Otro socio no puede contestar por el (la conversacion es de quien la abrio).
    await sala.pulsar('angelo', 'Sin envío');
    // 4) Registro: sale por el eco, con el mensaje rico del pedido y el boton Deshacer de 10 minutos.
    const eco = sala.ultimo();
    expect(eco.texto).toContain('Pedido registrado en sistema con folio');
    expect(eco.texto).toContain('Ib Cliente');
    expect(eco.texto).toContain('De contado'.toLowerCase().replace('de c', 'de c'));
    expect(eco.texto).toContain('Deshacer disponible por 10 minutos');
    expect(eco.botones.flat().map((b) => b.texto)).toContain('Deshacer');
    expect(await cuenta('operacion.pedido')).toBe(1);
    const f = await q<{ estado: string; folio_registro: string }>("select estado, folio_registro from agente.conversacion where operacion = 'pedido_bodega' and chat_id = -100900 order by id desc");
    expect(f[0]!.estado).toBe('registrada');
    expect(eco.texto).toContain(f[0]!.folio_registro);
    // El registro paso por el carril de frenos: hay un hecho deshacible y ninguna tarjeta de confirmacion.
    expect(await cuenta("agente.hecho where tipo = 'pedido'")).toBe(1);
    expect(textosDe(inicio).join('\n')).not.toContain('Todavia no se registro nada');
    // 5) Deshacer desde el boton del eco: el pedido queda cancelado.
    await sala.pulsar('angelo', 'Deshacer', eco);
    expect(sala.ultimo().texto).toContain('Deshecho');
    expect((await q<{ estado: string }>('select estado from operacion.pedido'))[0]!.estado).toBe('cancelado');
    // Nada salio a otro chat ni a la red real.
    expect(sala.enviados.every((e) => e.chat === ID.grupo)).toBe(true);
    expect(sala.llamadasRed.every((u) => u.startsWith('https://api.telegram.org/bot<token>/'))).toBe(true);
  });

  it('un cobro sin cuenta: el interprete trae cliente y monto, el bot pregunta la cuenta y el antiduplicado del carril de frenos pregunta por el repetido', async () => {
    await sala.escribir('angelo', 'Ib Cliente pago 1000');
    const p = sala.ultimo();
    expect(p.texto).toMatch(/cuenta/i);
    expect(await cuenta('operacion.pago')).toBe(0);
    await sala.pulsar('angelo', 'Efectivo');
    // El cliente no debe nada (el pedido se deshizo): el carril de frenos lo pregunta como anticipo y la conversacion lo muestra con sus botones.
    expect(sala.ultimo().texto).toContain('mayor que lo que debe el cliente');
    expect(await cuenta('operacion.pago')).toBe(0);
    await sala.pulsar('angelo', 'Sí, es anticipo');
    expect(sala.ultimo().texto).toContain('Registrado');
    expect(await cuenta('operacion.pago')).toBe(1);
    // El mismo cobro, ahora del otro socio, dentro de 10 minutos: el carril de frenos lo detiene y la conversacion lo pregunta.
    await sala.escribir('javier', 'Ib Cliente pago 1000 en efectivo');
    expect(sala.ultimo().texto).toMatch(/Ya se registro un movimiento igual/);
    expect(await cuenta('operacion.pago')).toBe(1);
    await sala.pulsar('javier', 'Sí, es otro');
    // Dijo que es otro: el carril de frenos sigue preguntando el exceso (el cliente ya no debe nada) y ahora el "si" es al anticipo.
    expect(sala.ultimo().texto).toContain('mayor que lo que debe el cliente');
    await sala.pulsar('javier', 'Sí, es anticipo');
    expect(await cuenta('operacion.pago')).toBe(2);
    expect(sala.ultimo().texto).toContain('Registrado');
  });
});
