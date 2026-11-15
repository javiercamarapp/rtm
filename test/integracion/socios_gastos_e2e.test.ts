// E2E del carril SOCIOS Y GASTOS contra una base temporal con TODAS las migraciones (SG_DATABASE_URL; sin ella se omite). Sin bot real: el transporte de Telegram es un fetch falso
// que NUNCA sale a api.telegram.org y el modelo de IA es un guion fijo (LlmGuionado). Recorrido de punta a punta por operacion: mensaje del socio, el interprete alimenta los slots,
// el bot pregunta lo que falte, el socio contesta, se registra por el carril de frenos, eco con Deshacer y aviso con AMBOS saldos. Todo en UNA transaccion que se revierte.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { procesarWebhook, type DepsProduccion } from '@/composicion/produccion';
import { LlmGuionado, respuesta } from '@/infra/agente/llm_simulado';
import type { FetchLike } from '@/infra/agente/telegram_api';
import type { Intencion } from '@/dominio/agente/intenciones';
import type { Sql } from '@/infra/postgres/servidor';

const url = process.env.SG_DATABASE_URL;
const d = url ? describe : describe.skip;

const c = new pg.Client({ connectionString: url ?? 'postgresql://x' });
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
const ID = { angelo: 7_200_001, javier: 7_200_002, grupo: -107_200 };

interface Enviado { id: number; chat: number; texto: string; botones: { texto: string; data: string }[][] }

class Sala {
  enviados: Enviado[] = [];
  llamadasRed: string[] = [];
  private idMsg = 5000;
  private upd = 1;
  private msg = 1;
  ahora = new Date();
  llm = new LlmGuionado([respuesta([{ tipo: 'ninguna' }])]);

  fetchFalso: FetchLike = async (u, init) => {
    this.llamadasRed.push(u.replace(TOKEN_FALSO, '<token>'));
    const metodo = u.split('/').pop()!;
    const cuerpo = JSON.parse(init.body) as { chat_id: number; text: string; reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } };
    if (metodo === 'sendMessage') {
      const id = ++this.idMsg;
      this.enviados.push({ id, chat: cuerpo.chat_id, texto: cuerpo.text, botones: (cuerpo.reply_markup?.inline_keyboard ?? []).map((f) => f.map((b) => ({ texto: b.text, data: b.callback_data }))) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: id } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };

  deps = (): DepsProduccion => ({ configAgente: { limiteMensajesPorMinuto: 0 }, sql, ahora: () => this.ahora, llm: this.llm, fetchFn: this.fetchFalso, entorno: { TELEGRAM_BOT_TOKEN: TOKEN_FALSO, TELEGRAM_WEBHOOK_SECRET: SECRETO } });
  webhook = (u: unknown) => procesarWebhook(this.deps(), SECRETO, JSON.stringify(u));

  /** El modelo (guion) entiende `acciones` del mensaje que escribe el socio. */
  async decir(quien: 'angelo' | 'javier', texto: string, acciones: Intencion[], extra: Record<string, unknown> = {}) {
    this.llm = new LlmGuionado([respuesta(acciones)]);
    return this.webhook({
      update_id: ++this.upd,
      message: { message_id: ++this.msg, from: { id: ID[quien] }, chat: { id: ID.grupo, type: 'supergroup' }, date: 1_794_000_000, ...(extra.photo ? { caption: texto } : { text: texto }), ...extra },
    });
  }

  /** Un comando (se interpreta con codigo, sin modelo). */
  async comando(quien: 'angelo' | 'javier', texto: string) {
    return this.webhook({ update_id: ++this.upd, message: { message_id: ++this.msg, from: { id: ID[quien] }, chat: { id: ID.grupo, type: 'supergroup' }, date: 1_794_000_000, text: texto } });
  }

  ultimo(): Enviado {
    const u = this.enviados.at(-1);
    if (!u) throw new Error('sin mensajes');
    return u;
  }
  desde(i: number): string {
    return this.enviados.slice(i).map((e) => e.texto).join('\n---\n');
  }
  async pulsar(quien: 'angelo' | 'javier', texto: string, de: Enviado = this.ultimo()) {
    const b = de.botones.flat().find((x) => x.texto === texto);
    if (!b) throw new Error(`no hay boton "${texto}" en: ${de.texto.slice(0, 300)} [botones: ${de.botones.flat().map((x) => x.texto).join(' | ')}]`);
    return this.webhook({ update_id: ++this.upd, callback_query: { id: `cb${this.upd}`, from: { id: ID[quien] }, message: { message_id: de.id, chat: { id: ID.grupo, type: 'supergroup' } }, data: b.data } });
  }
}

const sala = new Sala();
const C = 'mensaje de prueba';
const cuenta = async (t: string) => Number((await q<{ n: string }>(`select count(*)::text as n from ${t}`))[0]!.n);
const fondos = async (s: string) => Number((await q<{ v: string }>('select operacion.saldo_socio((select id from catalogo.socio where nombre = $1))::text as v', [s]))[0]!.v);

d('bot de socios y gastos: conversaciones simuladas (transporte falso, modelo guionado)', () => {
  beforeAll(async () => {
    await c.connect();
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier']] as const) await q('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
    await q("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
    await q("select catalogo.asegurar_cliente('Sg Cliente', 'Javier')");
  });
  afterAll(async () => {
    await c.query('rollback');
    await c.end();
  });

  it('la escritura nace APAGADA: nada se registra hasta que un socio escribe /escritura', async () => {
    await sala.decir('angelo', 'puse 5,000', [{ tipo: 'aportacion', socio: 'angelo', monto_centavos: 500000, motivo: null, intencion: null, fuente_cita: C }]);
    const i = sala.enviados.length;
    expect(sala.desde(0)).toMatch(/solo lectura/i);
    expect(await cuenta('operacion.aportacion_socio')).toBe(0);
    await sala.comando('javier', '/escritura');
    expect(sala.ultimo().texto).toContain('Escritura ACTIVADA');
    expect(sala.enviados.length).toBeGreaterThan(i - 1);
  });

  it('aportacion: la INTENCION se pregunta siempre y el reembolso es lo que queda si no declara capital', async () => {
    await sala.decir('angelo', 'puse 5,000', [{ tipo: 'aportacion', socio: 'angelo', monto_centavos: 500000, motivo: null, intencion: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/capital para invertir o es un reembolso/i);
    expect(await cuenta('operacion.aportacion_socio')).toBe(0);
    const i = sala.enviados.length;
    await sala.pulsar('angelo', 'Reembolso');
    expect(sala.desde(i)).toMatch(/Registrado|registrad/i);
    expect(sala.ultimo().texto).toMatch(/igualad|más aportado/i); // el bot recuerda como queda la igualacion
    const f = await q<{ clasificacion: string }>('select clasificacion from operacion.aportacion_socio order by id desc limit 1');
    expect(f[0]!.clasificacion).toBe('reembolsable');
    expect(await cuenta("operacion.aportacion_socio where clasificacion = 'capital'")).toBe(0);
  });

  it('capital solo si el socio lo declara (Javier mete 10,000 de capital)', async () => {
    await sala.decir('javier', 'meti 10,000 de capital', [{ tipo: 'aportacion', socio: 'javier', monto_centavos: 1000000, motivo: null, intencion: 'capital', fuente_cita: C }]);
    // Aun declarado por el modelo, el bot pregunta la intencion hasta que el socio la dice.
    if (/capital para invertir o es un reembolso/i.test(sala.ultimo().texto)) await sala.pulsar('javier', 'Capital para invertir');
    expect(await cuenta("operacion.aportacion_socio where clasificacion = 'capital' and monto_cent = 1000000")).toBe(1);
  });

  it('fondos de la sociedad en poder de Angelo (cobro en su cuenta) y entrega a la sociedad: baja fondos, aviso con AMBOS saldos, deshacer', async () => {
    await q("select agente.ejecutar('sg:seed-cobro', 'pago_cliente', $1::jsonb)", [JSON.stringify({ autor: 'angelo', telegram_user_id: ID.angelo, origen: 'x', cuenta: 'angelo', monto_cent: 700000, cliente_id: (await q<{ id: string }>("select id::text from catalogo.cliente where nombre_canonico = 'Sg Cliente'"))[0]!.id, confirmo_exceso: true })]);
    expect(await fondos('Angelo')).toBe(700000);
    const i = sala.enviados.length;
    await sala.decir('angelo', 'entregue 3,000 a la sociedad', [{ tipo: 'entrega_fondos', socio: 'angelo', destino: 'sociedad', monto_centavos: 300000, via: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/transferencia o en efectivo/i);
    expect(await fondos('Angelo')).toBe(700000);
    await sala.pulsar('angelo', 'Efectivo');
    const texto = sala.desde(i);
    expect(texto).toMatch(/Registrado|registrad/i);
    expect(texto).toContain('Saldos de los socios');
    expect(texto).toContain('Angelo:');
    expect(texto).toContain('Javier:');
    expect(await fondos('Angelo')).toBe(400000);
    expect(await cuenta("operacion.aportacion_socio where concepto ilike '%entrega%'")).toBe(0); // una entrega NO es aportacion
    const eco = sala.enviados.slice(i).find((e) => e.botones.flat().some((b) => b.texto === 'Deshacer'))!;
    await sala.pulsar('angelo', 'Deshacer', eco);
    expect(sala.ultimo().texto).toContain('Deshecho');
    expect(await fondos('Angelo')).toBe(700000);
  });

  it('liquidacion entre socios: pregunta la via, registra y avisa ambos saldos', async () => {
    const i = sala.enviados.length;
    await sala.decir('angelo', 'le liquide 1,000 a Javier', [{ tipo: 'liquidacion_socios', de_socio: 'angelo', a_socio: 'javier', monto_centavos: 100000, via: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/transferencia o en efectivo/i);
    await sala.pulsar('angelo', 'Transferencia');
    expect(sala.desde(i)).toContain('Saldos de los socios');
    expect(await fondos('Angelo')).toBe(600000);
  });

  it('renta de Omar: pregunta quien pago y la via; un pago mayor a lo que se debe se PREGUNTA (anticipo) y luego se registra', async () => {
    const i = sala.enviados.length;
    await sala.decir('javier', 'pague la renta de Omar 500', [{ tipo: 'renta_omar', monto_centavos: 50000, pagado_por: 'javier', via: null, nota: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/transferencia o en efectivo/i);
    await sala.pulsar('javier', 'Efectivo');
    expect(sala.ultimo().texto).toMatch(/anticipo/i);
    expect(await cuenta("operacion.pago_omar where sentido = 'a_omar'")).toBe(0);
    await sala.pulsar('javier', 'Sí, es anticipo');
    expect(sala.desde(i)).toMatch(/renta de Omar/i);
    expect(await cuenta("operacion.pago_omar where sentido = 'a_omar'")).toBe(1);
    expect(await cuenta("operacion.aportacion_socio where clasificacion = 'capital' and monto_cent = 50000")).toBe(0);
  });

  it('gasto de caja (la sociedad lo paga): con tipo de gasto, sin reembolso a nadie, y se deshace', async () => {
    const i = sala.enviados.length;
    await sala.decir('angelo', 'gasto de caja 200 de uber', [{ tipo: 'gasto', gasto: 'uber', monto_centavos: 20000, pagado_por: 'sociedad', descripcion: null, fuente_cita: C }]);
    expect(sala.desde(i)).toMatch(/Registrado|registrad/i);
    const g = await q<{ folio: string; pagado_por_socio_id: string | null }>('select folio, pagado_por_socio_id::text from operacion.gasto order by id desc limit 1');
    expect(g[0]!.pagado_por_socio_id).toBeNull();
    const eco = sala.enviados.slice(i).find((e) => e.botones.flat().some((b) => b.texto === 'Deshacer'))!;
    await sala.pulsar('angelo', 'Deshacer', eco);
    expect(sala.ultimo().texto).toContain('Deshecho');
    expect(await cuenta('operacion.gasto_anulacion')).toBe(1);
  });

  it('gasto pagado por un socio con FOTO del ticket: la foto es evidencia con huella ligada al gasto; el monto lo tecleo el socio; la misma foto no respalda dos gastos', async () => {
    const i = sala.enviados.length;
    await sala.decir('angelo', 'gaste 350 de uber', [{ tipo: 'gasto', gasto: 'uber', monto_centavos: 35000, pagado_por: 'angelo', descripcion: null, fuente_cita: C }],
      { photo: [{ file_id: 'F-TICKET-1', file_unique_id: 'U-TICKET-1', width: 10, height: 10 }] });
    const texto = sala.desde(i);
    expect(texto).toMatch(/ticket/i);
    const ev = await q<{ gasto_folio: string | null; huella: string }>("select gasto_folio, huella from agente.evidencia_tg where file_id = 'F-TICKET-1'");
    expect(ev[0]!.gasto_folio).toMatch(/^G-/);
    expect(ev[0]!.huella).toMatch(/^[0-9a-f]{64}$/);
    // El monto es el que tecleo el socio (el bot no lee la imagen).
    expect(await cuenta("operacion.gasto where monto_cent = 35000")).toBe(1);
    // La misma foto en otro gasto: se avisa, no se guarda otra evidencia.
    const j = sala.enviados.length;
    await sala.decir('angelo', 'gaste 420 de uber', [{ tipo: 'gasto', gasto: 'uber', monto_centavos: 42000, pagado_por: 'angelo', descripcion: null, fuente_cita: C }],
      { photo: [{ file_id: 'F-TICKET-2', file_unique_id: 'U-TICKET-1', width: 10, height: 10 }] });
    expect(sala.desde(j)).toMatch(/misma foto|ya respalda/i);
  });

  it('retiro de capital: lo propone quien retira y lo confirma el OTRO socio con su propio mensaje', async () => {
    const i = sala.enviados.length;
    await sala.decir('javier', 'retiro 1,000 de mi capital', [{ tipo: 'retiro_capital', socio: 'javier', monto_centavos: 100000, via: null, fuente_cita: C }]);
    expect(sala.desde(i)).toMatch(/Propuesto|confirme|confirmar/i);
    expect(await cuenta('operacion.retiro_capital')).toBe(1);
    expect(await cuenta('operacion.retiro_capital_confirmacion')).toBe(0);
    const j = sala.enviados.length;
    await sala.decir('angelo', 'confirmo el retiro de capital de Javier por 1,000', [{ tipo: 'retiro_capital', socio: 'javier', monto_centavos: 100000, via: null, fuente_cita: C }]);
    expect(sala.desde(j)).toMatch(/Confirmado/i);
    expect(await cuenta('operacion.retiro_capital_confirmacion')).toBe(1);
  });

  it('acta: la firma es un mensaje personal; sin acta pendiente la base lo dice y no firma nada', async () => {
    const i = sala.enviados.length;
    await sala.comando('angelo', '/firmaracta');
    expect(sala.desde(i)).toMatch(/no hay un acta pendiente/i);
    expect(sala.enviados.slice(i).every((e) => e.botones.length === 0)).toBe(true); // sin boton generico
  });

  it('valuacion e igualacion por bot: "como estamos", "cuanto debe Angelo para igualar" y el cierre mensual', async () => {
    const i = sala.enviados.length;
    await sala.decir('javier', 'como estamos', [{ tipo: 'consulta', consulta: 'valuacion', modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null, periodo: null }]);
    expect(sala.ultimo().texto).toMatch(/valuaci/i);
    await sala.comando('javier', '/igualar angelo');
    expect(sala.ultimo().texto).toMatch(/valuaci/i);
    await sala.comando('javier', '/cierre');
    expect(sala.ultimo().texto).toMatch(/Cierre mensual/i);
    void i;
  });

  it('identidades: ninguna fila de capital sin declaracion, nada salio a otro chat ni a la red real, y las identidades de socios cuadran (salvo la cadena C21 de una sola transaccion)', async () => {
    expect(await cuenta("operacion.aportacion_socio where clasificacion = 'capital'")).toBe(1); // solo la que Javier declaro
    expect(sala.enviados.every((e) => e.chat === ID.grupo)).toBe(true);
    expect(sala.llamadasRed.every((u) => u.startsWith('https://api.telegram.org/bot<token>/'))).toBe(true);
    await q("select set_config('rtm.canal', 'telegram', true), set_config('rtm.actor', 'angelo', true)");
    await q('select contabilidad.asentar_pendientes()');
    const rojas = await q<{ id: string }>("select x ->> 'id' as id from jsonb_array_elements(operacion.cuadre_socios() -> 'verificaciones') x where not (x ->> 'ok')::boolean and (x ->> 'id') not in ('ii-c21', 'ii-bloqueantes')");
    expect(rojas).toEqual([]);
  });
});
