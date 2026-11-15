// E2E del carril FRENOS (sin tarjeta) contra la base LOCAL (TypeScript real + SQL real, Telegram con fetch falso), sin bot real: updates falsos entran por procesarWebhook (la funcion que llama /api/telegram/webhook) con
// la cabecera del secreto de prueba; el cliente de Telegram es el REAL pero su fetch es un doble que registra y NUNCA sale a api.telegram.org;
// el extractor de IA es el simulado determinista. Todo dentro de UNA transaccion que se revierte al final.
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

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier'], [ID.omar, 'omar']] as const) await q('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
  await q("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
  await q("select catalogo.asegurar_cliente('Tg Cliente', 'Javier')");
  await q("select catalogo.asegurar_cliente('Tg Omar Persona', 'Javier')");
  await q("select catalogo.asegurar_persona_bodega('Tg Omar Persona', 'Tg Omar Persona')");
  await q("select catalogo.asegurar_modelo('Tg Marca', 'Tg Modelo', 10000, 'ambas')");
  await q("select catalogo.asegurar_sku('Tg Modelo', 'Uva')");
  await q("select catalogo.fijar_costo('e2e:k', 'Isaac', 'Tg Modelo', 11000, negocio.hoy() - 30, 'prueba')");
  await q("select catalogo.fijar_precio('e2e:p', 'Tg Cliente', 'Tg Modelo', 25000, negocio.hoy() - 30, 'chat')");
  await q("select operacion.registrar_movimiento('e2e:m', 'Tg Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1100000, negocio.hoy() - 5)");
  await q("update seguridad.interruptor set activo = true where clave = 'telegram_envio'").catch(() => undefined);
});
afterAll(async () => {
  await c.query('rollback');
  await c.end();
});

describe('carril frenos extremo a extremo (sin tarjeta)', () => {
  it('la escritura NACE apagada: nada se escribe hasta que un socio escribe /escritura; el aviso sale al grupo', async () => {
    expect((await q<{ activo: boolean }>("select activo from seguridad.interruptor where clave = 'agente_escritura'"))[0]!.activo).toBe(false);
    await sala.escribir('angelo', '/pago Tg Cliente | 1000 | efectivo');
    expect(sala.ultimo().texto).toContain('Estoy en solo lectura');
    expect(await cuenta('operacion.pago')).toBe(0);
    await sala.escribir('omar', '/escritura');
    expect((await q<{ activo: boolean }>("select activo from seguridad.interruptor where clave = 'agente_escritura'"))[0]!.activo).toBe(false);
    await sala.escribir('javier', '/escritura');
    expect(sala.ultimo().texto).toContain('Escritura ACTIVADA por Javier');
    expect(await cuenta('agente.escritura_cambio')).toBe(2);
  });

  it('pedido, envio y cobro sin tarjeta: eco rico con cliente, cuenta, pedido y saldos que calcula la base', async () => {
    await sala.escribir('angelo', '/pedido Tg Cliente | tg modelo/uva 24 | plazo contado');
    expect(sala.ultimo().texto).toContain('Registrado');
    expect(sala.ultimo().texto).not.toContain('Todavia no se registro nada');
    const folio = (await q<{ folio: string }>('select folio from operacion.pedido'))[0]!.folio;
    await sala.escribir('angelo', `/enviado ${folio}`);
    expect((await q<{ estado: string }>('select estado from operacion.pedido'))[0]!.estado).toBe('enviado');
    await sala.escribir('angelo', '/pago Tg Cliente | 2000 | efectivo');
    const eco = sala.ultimo();
    expect(eco.texto).toContain('Cliente: Tg Cliente');
    expect(eco.texto).toContain('Cuenta: Efectivo');
    expect(eco.texto).toContain(`Aplicado al pedido ${folio}`);
    expect(eco.texto).toContain('Saldo del cliente antes: $6,000.00');
    expect(eco.texto).toContain('Saldo del cliente despues: $4,000.00');
    expect(eco.botones.flat().map((b) => b.texto)).toContain('Deshacer');
    expect(await cuenta('operacion.pago')).toBe(1);
  });

  it('el mismo cobro del otro socio en 10 minutos se pregunta; si es otro, se registra; el cobro mayor a lo que debe tambien se pregunta', async () => {
    await sala.escribir('javier', '/pago Tg Cliente | 2000 | efectivo');
    const q1 = sala.ultimo();
    expect(q1.texto).toContain('Ya se registro un movimiento igual por Angelo');
    expect(await cuenta('operacion.pago')).toBe(1);
    await sala.pulsar('javier', 'Si, es otro');
    expect(await cuenta('operacion.pago')).toBe(2);
    await sala.escribir('angelo', '/pago Tg Cliente | 900000 | efectivo');
    expect(sala.ultimo().texto).toContain('mayor que lo que debe el cliente');
    expect(await cuenta('operacion.pago')).toBe(2);
    await sala.pulsar('angelo', 'Si, es anticipo');
    expect(await cuenta('operacion.pago')).toBe(3);
    expect(sala.ultimo().texto).toContain('Anticipo a favor del cliente');
  });

  it('deshacer: dentro de 10 minutos el autor lo deshace con eco del efecto; pasados, ni el autor', async () => {
    await sala.escribir('angelo', '/gasto uber 45 angelo');
    const eco = sala.ultimo();
    await sala.pulsar('angelo', 'Deshacer', eco);
    expect(sala.ultimo().texto).toContain('Deshecho');
    await sala.escribir('angelo', '/aporte angelo 3333');
    const folio = (await q<{ folio: string }>("select folio from agente.hecho where tipo = 'aportacion' order by creado_at desc limit 1"))[0]!.folio;
    await q("update agente.hecho set creado_at = now() - interval '11 minutes' where folio = $1", [folio]);
    await sala.escribir('angelo', `/deshacer ${folio}`);
    expect(sala.ultimo().texto).toContain('Pasaron mas de 10 minutos');
  });

  it('el update repetido por Telegram no se aplica dos veces y queda terminado; el apagado deja consultar', async () => {
    const antes = await cuenta('operacion.gasto');
    await sala.escribir('angelo', '/gasto uber 77 angelo', { updateId: 777, messageId: 777 });
    await sala.escribir('angelo', '/gasto uber 77 angelo', { updateId: 777, messageId: 777 });
    expect(await cuenta('operacion.gasto')).toBe(antes + 1);
    expect((await q<{ estado: string }>('select estado from agente.tg_update where update_id = 777'))[0]!.estado).toBe('terminado');
    await sala.escribir('javier', '/lectura');
    expect(sala.ultimo().texto).toContain('Solo lectura activado por Javier');
    await sala.escribir('angelo', '/gasto uber 78 angelo');
    expect(sala.ultimo().texto).toContain('Estoy en solo lectura');
    expect(await cuenta('operacion.gasto')).toBe(antes + 1);
    await sala.escribir('angelo', '/stock tg modelo');
    expect(sala.ultimo().texto).not.toContain('solo lectura');
  });

  it('el grupo pasa a supergrupo: se actualizan las dos tablas y el bot no sale', async () => {
    const nuevo = -1_000_000_100_900;
    const r = await sala.webhook({ update_id: ++sala['upd'] + 5000, message: { message_id: 1, chat: { id: ID.grupo, type: 'group' }, date: 1_794_000_000, migrate_to_chat_id: nuevo } });
    expect(r.status).toBe(200);
    expect((await q<{ chat_id: string }>("select chat_id::text from agente.chat_registrado where destino = 'grupo_socios'"))[0]!.chat_id).toBe(String(nuevo));
    expect(sala.llamadasRed.some((u) => u.endsWith('leaveChat'))).toBe(false);
  });
});
