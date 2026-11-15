// E2E del carril COBRANZA contra una base temporal con TODAS las migraciones (RTM_DB_URL_COBRANZA; sin ella se omite). Transporte de Telegram FALSO: NADA sale a la red.
// Recorrido de punta a punta por cada operacion: mensaje del socio, interprete guionado, preguntas del bot (cifra con "mil", cuenta, fecha, motivo), respuestas, registro por las funciones SQL reales y mensaje final.
// Tambien simula el calendario del 14 al 21-nov (vencimientos 16, 17 y 20) con el reloj apagado/encendido por interruptor. Todo en UNA transaccion que se revierte al final. Datos FICTICIOS.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { procesarWebhook, type DepsProduccion } from '@/composicion/produccion';
import { ejecutarRelojCobranza } from '@/aplicacion/agente/cobranza_reloj';
import { PuertoRelojCobranzaDb } from '@/infra/agente/cobranza_postgres';
import { respuesta, LlmGuionado } from '@/infra/agente/llm_simulado';
import type { FetchLike } from '@/infra/agente/telegram_api';
import type { ClienteLlm, EnviadorTelegram, MensajeSalida } from '@/aplicacion/agente/puertos';
import type { ICobranzaRespuesta } from '@/dominio/agente/intenciones_ampliadas';
import type { Sql } from '@/infra/postgres/servidor';

const url = process.env.RTM_DB_URL_COBRANZA;
const c = new pg.Client({ connectionString: url });
let n = 0;
let cola: Promise<unknown> = Promise.resolve();
/** Fecha de negocio simulada para SQL (solo la honra el rol propietario de la prueba; el servidor real nunca la manda). */
let hoySql: string | null = null;
const sql: Sql = (t, p = []) => {
  const turno = cola.then(async () => {
    const sp = `s${n++}`;
    await c.query(`savepoint ${sp}`);
    try {
      const params = [...p];
      if (hoySql !== null && /agente\.cobranza_responder/.test(t)) params[1] = JSON.stringify({ ...JSON.parse(String(params[1])), hoy: hoySql });
      const r = (await c.query(t, params)).rows as never;
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
const ID = { angelo: 6_300_001, javier: 6_300_002, grupo: -100_960 };

interface Enviado { id: number; chat: number; texto: string }
class Sala {
  enviados: Enviado[] = [];
  llamadasRed: string[] = [];
  private idMsg = 3000;
  private upd = 1;
  private msg = 1;
  ahora = new Date('2026-11-17T16:00:00Z');
  llm: ClienteLlm = new LlmGuionado([]);
  guion(...salidas: ICobranzaRespuesta[][]): LlmGuionado {
    const l = new LlmGuionado(salidas.map((a) => respuesta(a)));
    this.llm = l;
    return l;
  }
  fetchFalso: FetchLike = async (u, init) => {
    this.llamadasRed.push(u.replace(TOKEN_FALSO, '<token>'));
    const metodo = u.split('/').pop()!;
    const cuerpo = JSON.parse(init.body) as { chat_id: number; text: string };
    if (metodo === 'sendMessage') {
      const id = ++this.idMsg;
      this.enviados.push({ id, chat: cuerpo.chat_id, texto: cuerpo.text });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: id } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };
  deps = (): DepsProduccion => ({ configAgente: { limiteMensajesPorMinuto: 0 }, sql, ahora: () => this.ahora, llm: this.llm, fetchFn: this.fetchFalso, entorno: { TELEGRAM_BOT_TOKEN: TOKEN_FALSO, TELEGRAM_WEBHOOK_SECRET: SECRETO } });
  async escribir(quien: 'angelo' | 'javier', texto: string) {
    return procesarWebhook(this.deps(), SECRETO, JSON.stringify({
      update_id: ++this.upd, message: { message_id: ++this.msg, from: { id: ID[quien] }, chat: { id: ID.grupo, type: 'supergroup' }, date: 1_794_000_000, text: texto },
    }));
  }
  ultimo(): Enviado { const u = this.enviados.at(-1); if (!u) throw new Error('sin mensajes'); return u; }
}
const sala = new Sala();
const q = async <T = Record<string, unknown>>(t: string, p: unknown[] = []): Promise<T[]> => sql<T>(t, p);

const intent = (x: Partial<ICobranzaRespuesta>): ICobranzaRespuesta => ({ tipo: 'cobranza_respuesta', accion: 'aun_no', cliente_texto: 'Cobra Beta', pedidos_texto: [], monto_texto: null, cuenta: null, cuando_texto: null, duracion_texto: null, motivo: null, fuente_cita: 'x', ...x });
const saldo = async (cliente: string): Promise<number> => Number((await q<{ s: string }>("select coalesce(sum(operacion.pedido_saldo(pe.id)), 0)::text as s from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id where c.nombre_canonico = $1 and pe.estado = 'enviado'", [cliente]))[0]!.s);
const digest = async (hoy: string) => (await q<{ j: { vacio: boolean; texto: string | null } }>('select cobranza.armar_digest($1::date, $2) as j', [hoy, 'am']))[0]!.j;

async function pedido(clave: string, cliente: string, plazo: number, pz: number, envio: string): Promise<void> {
  await q("select set_config('rtm.fecha_negocio', $1, true)", [envio]);
  const a = (extra: Record<string, unknown>) => JSON.stringify({ autor: 'javier', telegram_user_id: ID.javier, origen: 'x', ...extra });
  const cli = (await q<{ id: string }>('select id::text from catalogo.cliente where nombre_canonico = $1', [cliente]))[0]!.id;
  const lin = (await q<{ l: unknown }>("select jsonb_build_array(jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_canonico = 'Cobra Modelo'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = 'Uva'), 'piezas', $1::int)) as l", [pz]))[0]!.l;
  await q("select agente.ejecutar_ext($1, 'pedido_crear', $2::jsonb)", [clave, a({ cliente_id: Number(cli), plazo_dias: plazo, lineas: lin })]);
  const folio = (await q<{ f: string }>("select folio as f from operacion.pedido where id = (select (resultado ->> 'pedido_id')::bigint from seguridad.operacion where clave = $1)", [clave]))[0]!.f;
  await q("select agente.ejecutar_ext($1, 'envio_lote', $2::jsonb)", [`${clave}e`, a({ aceptar_avisos: true, paqueteria: 'castores', folios: [folio] })]);
  await q("select set_config('rtm.fecha_negocio', '', true)");
}

beforeAll(async () => {
  if (!url) return;
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  await c.query("update seguridad.interruptor set activo = true where clave = 'agente_escritura'"); // solo para armar los pedidos de prueba
  for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier']] as const) await q('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
  await q("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
  for (const [nom, d] of [['Cobra Alfa', 'Javier'], ['Cobra Beta', 'Javier'], ['Cobra Gama', 'Angelo'], ['Cobra Delta', 'Javier']] as const) {
    await q('select catalogo.asegurar_cliente($1, $2)', [nom, d]);
  }
  await q(`do $$ begin if not exists (select 1 from catalogo.persona_bodega) then perform catalogo.asegurar_cliente('Cobra Omar Cliente', 'Javier'); perform catalogo.asegurar_persona_bodega('Cobra Omar Cliente', 'Cobra Omar'); end if; end $$`);
  await q("select catalogo.asegurar_modelo('Cobra Marca', 'Cobra Modelo', 10000, 'ambas')");
  await q("select catalogo.asegurar_sku('Cobra Modelo', 'Uva')");
  await q("select catalogo.fijar_costo('cob:k', 'Karen', 'Cobra Modelo', 10000, negocio.hoy() - 40, 'prueba')");
  await q("select catalogo.fijar_costo('cob:k2', 'Isaac', 'Cobra Modelo', 11000, negocio.hoy() - 40, 'prueba')");
  for (const [i, nom] of ['Cobra Alfa', 'Cobra Beta', 'Cobra Gama', 'Cobra Delta'].entries()) await q("select catalogo.fijar_precio($1, $2, 'Cobra Modelo', 25000, negocio.hoy() - 40, 'chat')", [`cob:p${i}`, nom]);
  await q("select operacion.registrar_movimiento('cob:m1', 'Cobra Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 900, 9000000, negocio.hoy() - 30)");
  // Vencimientos del 16 (Alfa), 17 (Beta, dos pedidos) y 20 (Gama y Delta): equivalentes ficticios del calendario real.
  await pedido('cob:a1', 'Cobra Alfa', 10, 16, '2026-11-06');
  await pedido('cob:b1', 'Cobra Beta', 10, 160, '2026-11-07');
  await pedido('cob:b2', 'Cobra Beta', 10, 80, '2026-11-07');
  await pedido('cob:g1', 'Cobra Gama', 10, 12, '2026-11-10');
  await pedido('cob:d1', 'Cobra Delta', 10, 8, '2026-11-10');
  await c.query("update seguridad.interruptor set activo = false where clave = 'agente_escritura'"); // como arranca en produccion: solo lectura
});
afterAll(async () => {
  if (!url) return;
  await c.query('rollback');
  await c.end();
});

describe.skipIf(!url)('cobranza contra la base (transporte falso de Telegram)', () => {
  it('con la escritura apagada (como arranca en produccion) el bot no registra nada y lo explica', async () => {
    hoySql = '2026-11-17';
    sala.guion([intent({ accion: 'aun_no', cliente_texto: 'Cobra Beta' })]);
    await sala.escribir('javier', 'Beta todavía no paga');
    expect(sala.ultimo().texto).toContain('solo lectura');
    expect((await q<{ n: string }>('select count(*)::text as n from cobranza.respuesta'))[0]!.n).toBe('0');
    await sala.escribir('javier', '/escritura');
    expect(sala.ultimo().texto).toContain('Escritura ACTIVADA por Javier');
  });

  it('PAGO PARCIAL: "Beta depositó 20 mil" repite la cifra, pregunta la cuenta, registra con reparto y pregunta por el resto; la fecha del resto la resuelve el codigo', async () => {
    const antes = await saldo('Cobra Beta');
    sala.guion([intent({ accion: 'pago_parcial', cliente_texto: 'Cobra Beta', monto_texto: '20 mil' })]);
    await sala.escribir('javier', 'Beta depositó 20 mil');
    expect(sala.ultimo().texto).toBe('¿Son $20,000.00? Responde sí o no antes de registrarlo.');
    expect(await saldo('Cobra Beta')).toBe(antes);
    await sala.escribir('javier', 'sí');
    expect(sala.ultimo().texto).toBe('¿A qué cuenta entró el pago de Cobra Beta? Angelo, Javier, Isaac, Karen o Efectivo.');
    await sala.escribir('angelo', 'a la de Javier');
    expect(sala.ultimo().texto).toMatch(/^Registrado COB-\d+: pago de \$20,000 de Cobra Beta en la cuenta de Javier \([A-Z]+-\d+\)\. Se aplicó a [A-Z]+-\d+ \$20,000\. Queda pendiente \$40,000 \(/);
    expect(sala.ultimo().texto).toContain('¿Y el resto, para cuándo?');
    expect(await saldo('Cobra Beta')).toBe(antes - 2_000_000);
    await sala.escribir('javier', 'el jueves');
    expect(sala.ultimo().texto).toMatch(/^Anotado COB-\d+: Cobra Beta paga el jueves 19-nov\./);
    expect(sala.ultimo().texto).toContain('¿Solo cambio mi recordatorio (el recargo sigue corriendo desde el martes 17-nov)');
    const plazoAntes = (await q<{ p: number }>("select plazo_dias as p from operacion.pedido where cliente_id = (select id from catalogo.cliente where nombre_canonico = 'Cobra Beta') order by id limit 1"))[0]!.p;
    await sala.escribir('javier', 'solo recordatorio');
    expect(sala.ultimo().texto).toBe('Listo: queda solo como recordatorio. El plazo y el recargo no cambian.');
    expect(plazoAntes).toBe(10);
  });

  it('el mismo pago repetido a los pocos segundos se frena por contenido y solo se registra si el socio dice que es otro', async () => {
    sala.guion([intent({ accion: 'pago_parcial', cliente_texto: 'Cobra Beta', monto_texto: '20,000', cuenta: 'javier' })]);
    const antes = await saldo('Cobra Beta');
    await sala.escribir('javier', 'Beta depositó 20,000 a mi cuenta');
    expect(sala.ultimo().texto).toMatch(/^Ya registré un pago de \$20,000 de Cobra Beta hace unos minutos \(COB-\d+\)\. ¿Es otro pago\?/);
    expect(await saldo('Cobra Beta')).toBe(antes);
    await sala.escribir('javier', 'no');
    expect(sala.ultimo().texto).toBe('De acuerdo, no registré otro pago.');
    expect(await saldo('Cobra Beta')).toBe(antes);
  });

  it('SE ATRASA: "Gama se atrasa una semana" suma 7 dias a su vencimiento en SQL; el plazo contractual no cambia', async () => {
    sala.guion([intent({ accion: 'se_atrasa', cliente_texto: 'Cobra Gama', duracion_texto: 'una semana' })]);
    await sala.escribir('javier', 'Gama se atrasa una semana');
    expect(sala.ultimo().texto).toMatch(/^Anotado COB-\d+: Cobra Gama paga el viernes 27-nov\./);
    const r = (await q<{ plazo: number; vence: string; prom: string }>("select pe.plazo_dias as plazo, cobranza.vence_efectivo(pe.id)::text as vence, sg.promesa_fecha::text as prom from operacion.pedido pe join cobranza.seguimiento sg on sg.pedido_id = pe.id where pe.cliente_id = (select id from catalogo.cliente where nombre_canonico = 'Cobra Gama')"))[0]!;
    expect(r).toEqual({ plazo: 10, vence: '2026-11-20', prom: '2026-11-27' });
  });

  it('DISPUTA: sin motivo pregunta, con el motivo queda en disputa y reaparece el lunes', async () => {
    sala.guion([intent({ accion: 'disputa', cliente_texto: 'Cobra Delta' })]);
    await sala.escribir('javier', 'Delta disputa el pedido');
    expect(sala.ultimo().texto).toBe('¿Cuál es el motivo de la disputa de Cobra Delta? Escríbelo con tus palabras.');
    await sala.escribir('javier', 'dice que le faltaron 5 piezas');
    expect(sala.ultimo().texto).toMatch(/^En disputa COB-\d+: Cobra Delta\. Motivo: "dice que le faltaron 5 piezas"/);
    expect((await digest('2026-11-23')).texto).toContain('En disputa: Cobra Delta');
  });

  it('DECISION DEL DUENIO: el otro socio no puede contradecir la promesa del duenio; los pagos si se aceptan de cualquiera', async () => {
    sala.guion([intent({ accion: 'prometio', cliente_texto: 'Cobra Alfa', cuando_texto: 'el viernes' })]);
    await sala.escribir('javier', 'Alfa promete pagar el viernes');
    expect(sala.ultimo().texto).toMatch(/^Anotado COB-\d+: Cobra Alfa paga el viernes 20-nov\./);
    await sala.escribir('javier', 'solo recordatorio');
    sala.guion([intent({ accion: 'prometio', cliente_texto: 'Cobra Alfa', cuando_texto: 'el lunes 30' })]);
    await sala.escribir('angelo', 'Alfa dijo que paga el lunes 30');
    expect(sala.ultimo().texto).toBe('Javier ya anotó una promesa de pago para Cobra Alfa; no lo cambio. Javier, ¿lo cambio?');
    sala.guion([intent({ accion: 'extender_plazo', cliente_texto: 'Cobra Alfa', cuando_texto: 'el 24 de noviembre' })]);
    await sala.escribir('angelo', 'Alfa: extiéndele el plazo hasta el 24 de noviembre');
    expect(sala.ultimo().texto).toContain('lo decide Javier, dueño del cliente'.replace('lo decide', 'Extender el plazo de Cobra Alfa lo decide'));
  });

  it('EXTENSION EXPLICITA por el duenio mueve el vencimiento efectivo (y el recargo), no el plazo contractual; se deshace dentro de 10 minutos', async () => {
    sala.guion([intent({ accion: 'extender_plazo', cliente_texto: 'Cobra Alfa', cuando_texto: 'el 24 de noviembre' })]);
    await sala.escribir('javier', 'Alfa: extiéndele el plazo hasta el 24 de noviembre');
    expect(sala.ultimo().texto).toMatch(/^Plazo extendido COB-(\d+): Cobra Alfa vence ahora el martes 24-nov; el recargo cuenta desde esa fecha\. Decidió Javier\./);
    const folio = /COB-\d+/.exec(sala.ultimo().texto)![0];
    const v = (await q<{ v: string; p: number }>("select cobranza.vence_efectivo(id)::text as v, plazo_dias as p from operacion.pedido where cliente_id = (select id from catalogo.cliente where nombre_canonico = 'Cobra Alfa')"))[0]!;
    expect(v).toEqual({ v: '2026-11-24', p: 10 });
    await sala.escribir('javier', `deshacer ${folio}`);
    expect(sala.ultimo().texto).toMatch(/^Javier deshizo COB-\d+ \(extender_plazo\) de Cobra Alfa\./);
    expect((await q<{ v: string }>("select cobranza.vence_efectivo(id)::text as v from operacion.pedido where cliente_id = (select id from catalogo.cliente where nombre_canonico = 'Cobra Alfa')"))[0]!.v).toBe('2026-11-16');
  });

  it('PAGO TOTAL directo a la cuenta de un proveedor, y DESHACER dentro de 10 minutos devuelve el saldo exacto', async () => {
    const antes = await saldo('Cobra Alfa');
    sala.guion([intent({ accion: 'pago_total', cliente_texto: 'Cobra Alfa', cuenta: 'isaac' })]);
    await sala.escribir('javier', 'Alfa le pagó todo directo a Isaac');
    expect(sala.ultimo().texto).toMatch(/^Registrado COB-\d+: pago de \$4,000 de Cobra Alfa en la cuenta de Isaac \([A-Z]+-\d+\)\. Se aplicó a [A-Z]+-\d+ \$4,000\. Queda saldado\./);
    expect(await saldo('Cobra Alfa')).toBe(0);
    const folio = /COB-\d+/.exec(sala.ultimo().texto)![0];
    await sala.escribir('angelo', `deshacer ${folio}`);
    expect(sala.ultimo().texto).toMatch(/^Angelo deshizo COB-\d+ \(pago_total\) de Cobra Alfa\./);
    expect(await saldo('Cobra Alfa')).toBe(antes);
  });

  it('SILENCIAR (atajo del digest, sin IA): "silenciar Cobra Delta 3 dias" no necesita llamar al modelo', async () => {
    const llm = sala.guion([intent({})]);
    await sala.escribir('javier', 'silenciar Cobra Gama 3 días');
    expect(sala.ultimo().texto).toMatch(/^Pausa COB-\d+: no se mencionará a Cobra Gama hasta el /);
    expect(llm.llamadas).toBe(0);
  });

  it('nada de lo anterior salio a la red ni a otro chat que no sea el grupo de los socios', async () => {
    expect(sala.enviados.every((m) => m.chat === ID.grupo)).toBe(true);
    expect(sala.llamadasRed.every((u) => u.endsWith('/sendMessage') || u.endsWith('/editMessageText') || u.endsWith('/answerCallbackQuery') || u.endsWith('/setMyCommands'))).toBe(true);
  });
});

describe.skipIf(!url)('reloj de la cobranza: calendario del 14 al 21-nov (transporte falso)', () => {
  const enviados: Array<{ dia: string; tipo: string; texto: string; chat: number }> = [];
  const telegram = (dia: string, tipo: string): EnviadorTelegram => ({
    enviar: async (m: MensajeSalida) => { enviados.push({ dia, tipo, texto: m.texto, chat: m.chatId }); return { messageId: 9000 + enviados.length }; },
  }) as unknown as EnviadorTelegram;
  const tick = (dia: string, tipo: 'am' | 'cierre', hora: string) => ejecutarRelojCobranza(tipo, new PuertoRelojCobranzaDb(sql, { hoy: dia, hora }), telegram(dia, tipo));

  it('APAGADO por interruptor: ni un mensaje, aunque haya mucho vencido', async () => {
    expect(await tick('2026-11-17', 'am', '09:00')).toEqual({ estado: 'apagado', enviado: false });
    expect(enviados).toHaveLength(0);
  });

  it('encendido (solo en esta prueba): calendario completo, un digest por dia, nunca vacio, solo al grupo', async () => {
    // Antes de encender, se limpian las respuestas de la conversacion para que el calendario parta de lo que dicta el vencimiento.
    await q("update seguridad.interruptor set activo = true where clave in ('cobranza_activa', 'telegram_envio')");
    await q('update cobranza.seguimiento set promesa_fecha = null, pausa_hasta = null, estado_manual = null, ignorados_consecutivos = 0');
    const resultados: Record<string, string> = {};
    for (const dia of ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) {
      resultados[dia] = (await tick(dia, 'am', '09:00')).estado;
      expect((await tick(dia, 'am', '09:05')).enviado).toBe(false); // el segundo tick del mismo dia no reenvia
    }
    expect(resultados['2026-11-14']).toBe('sin_contenido');
    for (const dia of ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) expect(resultados[dia]).toBe('enviado');
    const del = (dia: string) => enviados.filter((m) => m.dia === dia && m.tipo === 'am');
    expect(del('2026-11-14')).toHaveLength(0);
    for (const dia of ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) expect(del(dia)).toHaveLength(1);
    expect(del('2026-11-15')[0]!.texto).toContain('Próximos: Cobra Alfa vence mañana');
    expect(del('2026-11-16')[0]!.texto).toContain('Cobra Alfa vence HOY');
    expect(del('2026-11-17')[0]!.texto).toMatch(/Cobra Beta vence HOY\. [A-Z]+-\d+ \$[\d,]+ \+ [A-Z]+-\d+ \$[\d,]+ = \$/);
    expect(del('2026-11-20')[0]!.texto).toContain('Cobra Gama vence HOY');
    expect(del('2026-11-20')[0]!.texto).toMatch(/Cobra Alfa lleva 4 días vencido/);
    expect(enviados.every((m) => m.chat === ID.grupo)).toBe(true);
    // Cierre de las 17:00: solo si vencia algo hoy sin respuesta.
    expect((await tick('2026-11-16', 'cierre', '16:59')).estado).toBe('temprano');
    expect((await tick('2026-11-16', 'cierre', '17:00')).enviado).toBe(true);
    expect(enviados.at(-1)!.texto).toContain('Cierre del día de cobranza, lunes 16-nov');
    expect((await tick('2026-11-19', 'cierre', '17:00')).estado).toBe('sin_contenido');
    // Maximo de mensajes de cobranza en un dia: 09:00 + 17:00 condicional.
    const porDia = new Map<string, number>();
    for (const m of enviados) porDia.set(m.dia, (porDia.get(m.dia) ?? 0) + 1);
    expect(Math.max(...porDia.values())).toBeLessThanOrEqual(2);
  });

  it('una respuesta del socio cambia el digest del dia siguiente: lo pagado sale de TODO seguimiento y lo prometido se calla', async () => {
    hoySql = '2026-11-17';
    sala.ahora = new Date('2026-11-17T16:00:00Z');
    sala.guion([intent({ accion: 'pago_total', cliente_texto: 'Cobra Alfa', cuenta: 'efectivo' })], [intent({ accion: 'prometio', cliente_texto: 'Cobra Beta', cuando_texto: 'el viernes' })]);
    await sala.escribir('javier', 'Alfa pagó todo en efectivo');
    expect(sala.ultimo().texto).toContain('Queda saldado.');
    await sala.escribir('javier', 'Beta promete el viernes');
    expect(sala.ultimo().texto).toContain('Cobra Beta paga el viernes 20-nov');
    const d = (await digest('2026-11-18')).texto ?? '';
    expect(d).not.toContain('Cobra Alfa');
    expect(d).toContain('Prometido: Cobra Beta pagará el viernes 20-nov');
    expect(d).not.toMatch(/Cobra Beta (vence|venció|lleva)/);
  });
});
