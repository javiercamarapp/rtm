// E2E del carril APRENDIZAJE Y ALTA ASISTIDA contra una base temporal con todas las migraciones (transporte de Telegram falso: NADA sale a la red). Mismo marco que bot_integrado_e2e.
// (Referencia del marco original) E2E de la INTEGRACION del bot (frenos + conversacion + interprete) contra una base temporal con todas las migraciones, sin bot real: el transporte de Telegram es un fetch falso que
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
import { respuesta, LlmGuionado } from '@/infra/agente/llm_simulado';
import type { Intencion } from '@/dominio/agente/intenciones';
import { estado } from '../e2e/ayudas';

// RTM_DB_URL_APRENDIZAJE apunta a la base temporal propia del carril; sin ella, la base local de Supabase.
const c = new pg.Client({ connectionString: process.env.RTM_DB_URL_APRENDIZAJE ?? estado().DB_URL });
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

const SECRETO = 'secreto-de-prueba-' + 'x'.repeat(16);
const TOKEN_FALSO = 'T'.repeat(30);
const ID = { angelo: 6_100_001, javier: 6_100_002, omar: 6_100_003, extrano: 6_199_999, grupo: -100_950 };

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
  guion(...salidas: Intencion[][]): LlmGuionado {
    const l = new LlmGuionado(salidas.map((a) => respuesta(a)));
    this.llm = l;
    return l;
  }

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
const q1 = async <T = Record<string, unknown>>(t: string, p: unknown[] = []): Promise<T[]> => sql<T>(t, p);
const ultimos = (n: number) => sala.enviados.slice(-n).map((e) => e.texto);
const aliasDe = async (a: string) => Number((await q1<{ n: string }>('select count(*)::text as n from catalogo.cliente_alias where alias_norm = $1', [a]))[0]!.n);

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  await c.query("update seguridad.interruptor set activo = false where clave = 'agente_escritura'");
  for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier'], [ID.omar, 'omar']] as const) await q1('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
  await q1("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
  await q1("select catalogo.asegurar_cliente('Zeta Guillermo Torres', 'Javier')");
  await q1("select catalogo.asegurar_cliente('Zeta Ariel Gomez', 'Angelo')");
  await q1("select catalogo.asegurar_modelo('Zeta Marca', 'Zeta Nexa 50K', 50000, 'ambas')");
  await q1("select catalogo.asegurar_sku('Zeta Nexa 50K', 'Mango')");
  await q1("select catalogo.asegurar_sku('Zeta Nexa 50K', 'Passion Fruit')");
  await q1("select catalogo.fijar_costo('zt:k', 'Isaac', 'Zeta Nexa 50K', 10000, '2020-01-01', 'prueba')");
  await q1("select catalogo.fijar_precio('zt:p', 'Zeta Ariel Gomez', 'Zeta Nexa 50K', 20000, '2020-01-01', 'chat')");
  await q1("select operacion.registrar_movimiento('zt:m', 'Zeta Nexa 50K', 'Mango', 'bodega_omar', 'entrada_compra', 1500, 15000000, '2028-03-01')");
});
afterAll(async () => {
  await c.query('rollback');
  await c.end();
});

describe('aprendizaje y alta asistida contra la base (transporte falso)', () => {
  it('con la escritura apagada no se aprende nada y el bot lo dice', async () => {
    sala.guion([{ tipo: 'alias_ensenar', clase: 'cliente', alias_texto: 'Memo', oficial_texto: 'Zeta Guillermo Torres', fuente_cita: 'Memo es Zeta Guillermo Torres' }]);
    await sala.escribir('angelo', 'Memo es Zeta Guillermo Torres, ¿si?');
    expect(sala.ultimo().texto).toContain('solo lectura');
    expect(await aliasDe('memo')).toBe(0);
    await sala.escribir('javier', '/escritura');
    expect(sala.ultimo().texto).toContain('Escritura ACTIVADA por Javier');
  });

  it('alias: pregunta del servidor, el si de OTRO socio lo guarda con auditoria, y deshacer lo quita', async () => {
    sala.guion([{ tipo: 'alias_ensenar', clase: 'cliente', alias_texto: 'Memo', oficial_texto: 'Zeta Guillermo Torres', fuente_cita: 'Memo es Zeta Guillermo Torres' }]);
    await sala.escribir('angelo', 'Memo es Zeta Guillermo Torres, ¿si?');
    expect(sala.ultimo().texto).toBe('¿"Memo" es lo mismo que Zeta Guillermo Torres? Si respondes que si, lo recordare como otro nombre de Zeta Guillermo Torres. Responde si o no.');
    expect(await aliasDe('memo')).toBe(0);
    await sala.escribir('javier', 'dale');
    expect(sala.ultimo().texto).toContain('Javier confirmo: "Memo" queda como otro nombre de Zeta Guillermo Torres');
    expect(await aliasDe('memo')).toBe(1);
    expect(Number((await q1<{ n: string }>("select count(*)::text as n from seguridad.auditoria where accion = 'ALIAS_TELEGRAM' and registro_id = 'memo'"))[0]!.n)).toBe(1);
    await sala.escribir('angelo', 'deshacer alias');
    expect(sala.ultimo().texto).toContain('Angelo deshizo el alias "memo"');
    expect(await aliasDe('memo')).toBe(0);
  });

  it('un "ok" sin pregunta abierta no guarda nada (y no gasta una llamada de IA)', async () => {
    const llm = sala.guion([{ tipo: 'ninguna' }]);
    const antes = sala.enviados.length;
    await sala.escribir('javier', 'ok');
    expect(sala.enviados.length).toBe(antes);
    expect(llm.llamadas).toBe(0);
  });

  it('sabores parecidos: "duplicados pendientes", el bot pregunta, "dale" unifica con aviso y se puede deshacer en 10 minutos', async () => {
    await q1("select catalogo.asegurar_sku('Zeta Nexa 50K', 'Blueberry Spash')");
    await q1("select catalogo.asegurar_modelo('Zeta Marca', 'Zeta Blade', 30000, 'ambas')");
    await q1("select catalogo.asegurar_sku('Zeta Blade', 'Blueberry Splash')");
    await q1("select catalogo.escanear_duplicados('sabor')");
    sala.guion([{ tipo: 'ninguna' }]);
    await sala.escribir('angelo', 'duplicados pendientes');
    expect(sala.ultimo().texto).toMatch(/^¿"BLUEBERRY SPASH" es lo mismo que "BLUEBERRY SPLASH"\? Responde si o no\./);
    await sala.escribir('javier', 'no se');
    expect(ultimos(2)[0]).toContain('No entendí si es lo mismo o no');
    expect(sala.ultimo().texto).toContain('Responde si o no');
    await sala.escribir('javier', 'si');
    expect(ultimos(3).join('\n')).toContain('Javier unió los sabores');
    expect(Number((await q1<{ n: string }>('select count(*)::text as n from catalogo.sabor where unificado_en is not null'))[0]!.n)).toBeGreaterThanOrEqual(1);
    await sala.escribir('javier', 'deshacer unión');
    expect(sala.ultimo().texto).toContain('deshizo la unión');
  });

  it('cliente nuevo: el bot pregunta tipo, duenio y plazo habitual y registra con todo; uno parecido se pregunta antes', async () => {
    sala.guion([{ tipo: 'cliente_alta', nombre: 'Zeta Ariel Gomes', fuente_cita: 'alta cliente Zeta Ariel Gomes' }]);
    await sala.escribir('angelo', 'dar de alta al cliente Zeta Ariel Gomes 1');
    expect(sala.ultimo().texto).toBe('¿Es mayoreo o menudeo?');
    await sala.escribir('angelo', 'mayoreo');
    await sala.escribir('angelo', 'angelo');
    await sala.escribir('angelo', '15 días');
    expect(sala.ultimo().texto).toContain('Ya existe "Zeta Ariel Gomez", muy parecido a "Zeta Ariel Gomes"');
    expect(Number((await q1<{ n: string }>("select count(*)::text as n from catalogo.cliente where nombre_canonico = 'Zeta Ariel Gomes'"))[0]!.n)).toBe(0);
    await sala.pulsar('angelo', 'Sí, es otro');
    expect(sala.ultimo().texto).toContain('Angelo dio de alta al cliente "Zeta Ariel Gomes" (mayoreo, de Angelo, plazo habitual 15 dias)');
    expect((await q1<{ dias: number }>("select dias from catalogo.cliente_plazo_habitual where cliente_id = (select id from catalogo.cliente where nombre_canonico = 'Zeta Ariel Gomes')"))[0]!.dias).toBe(15);
  });

  it('sabor nuevo y modelo nuevo sin costo: lo registra sin inventar ninguno', async () => {
    sala.guion([{ tipo: 'sabor_alta', modelo_texto: 'Zeta Nexa 50K', sabor_texto: 'Uva Helada', fuente_cita: 'sabor nuevo Uva Helada de Zeta Nexa 50K' }]);
    await sala.escribir('angelo', 'sabor nuevo Uva Helada de Zeta Nexa 50K');
    expect(sala.ultimo().texto).toContain('Angelo dio de alta el sabor UVA HELADA para ZETA NEXA 50K');
    sala.guion([{ tipo: 'modelo_alta', marca_texto: 'Zeta Marca', modelo_texto: 'Zeta Zafiro', costo_centavos: null, proveedor_texto: null, fuente_cita: 'modelo nuevo Zeta Zafiro marca Zeta Marca' }]);
    await sala.escribir('angelo', 'modelo nuevo Zeta Zafiro marca Zeta Marca');
    await sala.escribir('angelo', '5000');
    await sala.pulsar('angelo', 'Sin costo por ahora');
    expect(sala.ultimo().texto).toContain('Sin costo de lista: hay que fijarlo antes de venderlo.');
    expect(Number((await q1<{ n: string }>("select count(*)::text as n from catalogo.costo_proveedor c join catalogo.modelo m on m.id = c.modelo_id where m.nombre_canonico = 'Zeta Zafiro'"))[0]!.n)).toBe(0);
  });

  it('recargo: el bot sugiere con el calculo de SQL; otro socio no lo aplica; el duenio dice si y queda en la nota', async () => {
    const cli = (await q1<{ id: string }>("select id::text from catalogo.cliente where nombre_canonico = 'Zeta Ariel Gomez'"))[0]!.id;
    await q1("select operacion.crear_pedido('zt-pe', $1::bigint, '[{\"modelo\":\"Zeta Nexa 50K\",\"sabor\":\"Mango\",\"piezas\":100}]'::jsonb, 'isaac_directo', null, 0, 0, 0, negocio.hoy() - 24, null, 7)", [cli]);
    const pid = (await q1<{ id: string }>("select (resultado->>'pedido_id') as id from seguridad.operacion where clave = 'zt-pe'"))[0]!.id;
    await q1("select operacion.confirmar_pedido('zt-pec', $1::bigint)", [pid]);
    await q1("select operacion.enviar_pedido('zt-pes', $1::bigint, null, null, negocio.hoy() - 24, true)", [pid]);
    const folio = (await q1<{ folio: string }>('select folio from operacion.pedido where id = $1::bigint', [pid]))[0]!.folio;
    sala.guion([{ tipo: 'recargo_credito', pedido_folio: folio, cliente_texto: null, fuente_cita: folio }]);
    await sala.escribir('javier', `cobrale el recargo al ${folio}`);
    expect(sala.ultimo().texto).toContain('lleva 2 semanas completas de atraso. Recargo sugerido: $4,000');
    expect(sala.ultimo().texto).toContain('Lo decide Angelo');
    await sala.escribir('javier', 'si');
    expect(sala.ultimo().texto).toContain('lo decide Angelo');
    await sala.escribir('angelo', 'si');
    expect(sala.ultimo().texto).toContain('Angelo aplico el recargo del pedido');
    expect(Number((await q1<{ r: string }>("select (snapshot_cliente->>'recargo_cent') as r from operacion.nota where pedido_id = $1::bigint order by id desc limit 1", [pid]))[0]!.r)).toBe(400000);
  });

  it('jamas se escribe a clientes, proveedores ni Omar: todo va al grupo de los socios', async () => {
    expect(sala.enviados.every((m) => m.chat === ID.grupo)).toBe(true);
    expect(sala.llamadasRed.every((u) => u.endsWith('/sendMessage') || u.endsWith('/answerCallbackQuery') || u.endsWith('/editMessageText') || u.endsWith('/editMessageReplyMarkup'))).toBe(true);
  });
});
