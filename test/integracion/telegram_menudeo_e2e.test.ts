// E2E de la ampliacion del agente de Telegram contra la base LOCAL, sin bot real: comentario de igualacion, pedido_menudeo (fecha comprometida interpretada por codigo),
// pago_pedido_menudeo (comprobante solo por huella, decision del otro socio con botones) y recordatorios del latido con el interruptor `telegram_envio`.
// El cliente de Telegram es el REAL con un fetch falso que NUNCA sale a api.telegram.org; la IA es la simulada. Todo en UNA transaccion que se revierte al final.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAgenteProduccion, procesarWebhook, type DepsProduccion } from '@/composicion/produccion';
import { LlmGuionado, LlmHeuristico, respuesta } from '@/infra/agente/llm_simulado';
import type { FetchLike } from '@/infra/agente/telegram_api';
import type { ClienteLlm } from '@/aplicacion/agente/puertos';
import type { Sql } from '@/infra/postgres/servidor';
import { estado } from '../e2e/ayudas';

const c = new pg.Client({ connectionString: estado().DB_URL });
let n = 0;
let cola: Promise<unknown> = Promise.resolve();
const sql: Sql = (t, p = []) => {
  const turno = cola.then(async () => {
    const sp = `m${n++}`;
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
const ID = { angelo: 6_100_001, javier: 6_100_002, omar: 6_100_003, grupo: -100_901 };

interface Enviado { id: number; chat: number; texto: string; botones: { texto: string; data: string }[][] }

class Sala {
  enviados: Enviado[] = [];
  editados: string[] = [];
  llamadasRed: string[] = [];
  private idMsg = 5000;
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

  deps = (): DepsProduccion => ({ configAgente: { limiteMensajesPorMinuto: 0 }, sql, ahora: () => this.ahora, llm: this.llm, fetchFn: this.fetchFalso, entorno: { TELEGRAM_BOT_TOKEN: TOKEN_FALSO, TELEGRAM_WEBHOOK_SECRET: SECRETO } });
  webhook = (u: unknown) => procesarWebhook(this.deps(), SECRETO, JSON.stringify(u));

  async escribir(quien: 'angelo' | 'javier', texto: string, extra: { updateId?: number; messageId?: number; foto?: boolean } = {}) {
    return this.webhook({
      update_id: extra.updateId ?? ++this.upd,
      message: {
        message_id: extra.messageId ?? ++this.msg, from: { id: ID[quien] }, chat: { id: ID.grupo, type: 'supergroup' }, date: 1_794_000_000,
        ...(texto === '' ? {} : { [extra.foto ? 'caption' : 'text']: texto }),
        ...(extra.foto ? { photo: [{ file_id: 'FILE-CHICA', file_unique_id: 'UNICO-CHICA', width: 90, height: 90 }, { file_id: 'FILE-SINT-E2E', file_unique_id: 'UNICO-SINT-E2E', width: 800, height: 800 }] } : {}),
      },
    });
  }

  async foto(quien: 'angelo' | 'javier', pie = '') {
    return this.escribir(quien, pie, { foto: true });
  }

  ultimo(): Enviado {
    const u = this.enviados.at(-1);
    if (!u) throw new Error('sin mensajes');
    return u;
  }

  con(texto: string): Enviado {
    const m = this.enviados.findLast((x) => x.texto.includes(texto));
    if (!m) throw new Error(`ningun mensaje dice: ${texto}\n${this.enviados.map((x) => x.texto.slice(0, 100)).join('\n--\n')}`);
    return m;
  }

  async pulsar(quien: 'angelo' | 'javier', texto: string, de: Enviado = this.ultimo()) {
    const b = de.botones.flat().find((x) => x.texto.startsWith(texto));
    if (!b) throw new Error(`no hay boton "${texto}" en el mensaje: ${de.texto.slice(0, 300)}`);
    return this.webhook({ update_id: ++this.upd, callback_query: { id: `cb${this.upd}`, from: { id: ID[quien] }, message: { message_id: de.id, chat: { id: ID.grupo, type: 'supergroup' } }, data: b.data } });
  }
}

const sala = new Sala();
/** /enviado de un pedido: la base puede pedir aceptar avisos ("Si, continuar") antes del resumen; despues confirma el autor. */
async function enviar(folio: string) {
  await sala.escribir('angelo', `/enviado ${folio}`);
  for (let i = 0; i < 4; i++) {
    const b = sala.ultimo().botones.flat().map((x) => x.texto);
    if (b.includes('Si, continuar')) await sala.pulsar('angelo', 'Si, continuar');
    else if (b.includes('Confirmar')) await sala.pulsar('angelo', 'Confirmar');
    else break;
  }
}
const cuenta = async (t: string) => Number((await q<{ n: string }>(`select count(*)::text as n from ${t}`))[0]!.n);
const rojas = async () => {
  await q('select contabilidad.asentar_pendientes()');
  return q<{ codigo: string; nombre: string }>('select codigo, nombre from contabilidad.comprobaciones() where not ok and bloqueante');
};
const pedidos = () => q<{ id: string; folio: string; estado: string }>('select p.id::text, p.folio, p.estado from operacion.pedido p join operacion.pedido_ds d on d.pedido_id = p.id order by p.id');
const pendiente = async (folio: string) => Number((await q<{ s: string }>('select operacion.pedido_saldo((select id from operacion.pedido where folio = $1))::text as s', [folio]))[0]!.s);

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier'], [ID.omar, 'omar']] as const) await q('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
  await q("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
  await q("select agente.registrar_chat('privado_omar', $1::bigint)", [ID.omar]);
  await q("select catalogo.asegurar_modelo('Mm Marca', 'Mm Modelo', 10000, 'ambas')");
  await q("select catalogo.asegurar_sku('Mm Modelo', 'Uva')");
  await q("select catalogo.asegurar_sku('Mm Modelo', 'Menta')");
  await q("select catalogo.fijar_costo('mm:k', 'Karen', 'Mm Modelo', 8929, negocio.hoy() - 60, 'prueba')");
});
afterAll(async () => {
  await c.query('rollback');
  await c.end();
});

describe('comentario de igualacion (cifras de la base)', () => {
  it('tras un deposito dice quien lleva mas aportado y a quien le toca; al igualar dice "Aportaciones igualadas."', async () => {
    sala.llm = new LlmGuionado([respuesta([{ tipo: 'aportacion', socio: 'javier', monto_centavos: 100_000, motivo: null, intencion: null, fuente_cita: 'puse 1000' }])]);
    await sala.escribir('javier', 'puse 1000');
    await sala.pulsar('javier', 'Confirmar');
    expect(sala.enviados.some((m) => m.texto.includes('Registrado'))).toBe(true);
    // Otras pruebas de integracion dejan datos comprometidos en la base local: la expectativa se lee de la base, no se supone.
    type Ig = { igualados: boolean; le_toca_aportar: string | null; lleva_mas: string | null; diferencia_cent: number };
    const ig = async () => (await q<{ j: Ig }>('select agente.igualacion() as j'))[0]!.j;
    const pesos = (cent: number) => `$${(cent / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const despues = await ig();
    expect(sala.ultimo().texto).toBe(despues.igualados ? 'Aportaciones igualadas.' : `${despues.lleva_mas} lleva ${pesos(despues.diferencia_cent)} más aportado; el siguiente pago le toca a ${despues.le_toca_aportar}.`);
    expect(sala.ultimo().texto).not.toMatch(/deud|debe|adeuda/i);
    // El que tiene menos pone exactamente la diferencia y quedan igualados.
    if (!despues.igualados) {
      const quien = despues.le_toca_aportar!.toLowerCase() as 'angelo' | 'javier';
      await sala.escribir(quien, `/aporte ${quien} ${(despues.diferencia_cent / 100).toFixed(2)}`);
      await sala.pulsar(quien, 'Confirmar');
    }
    expect(sala.ultimo().texto).toBe('Aportaciones igualadas.');
    expect((await ig()).igualados).toBe(true);
    sala.llm = new LlmHeuristico();
  });
});

describe('pedido_menudeo contra la base', () => {
  it('feliz: la fecha sale del codigo, el resumen trae el costo de la base, confirma el autor y el pedido queda a costo sin destinatario', async () => {
    await sala.escribir('angelo', '/pedidomenudeo mm modelo/uva 10 | cuando 20 de noviembre a las 3 de la tarde');
    const r = sala.ultimo();
    expect(r.texto).toContain('Todavia no se registro nada');
    expect(r.texto).toContain('viernes 20 de noviembre de 2026, 15:00 (hora de Mérida)');
    expect(r.texto).toContain('$892.90');
    expect(r.texto).toContain('Cuadre por dos vias');
    expect(await pedidos()).toHaveLength(0);
    expect(await cuenta("catalogo.cliente where nombre_norm = 'menudeo angelo'")).toBe(0);
    await sala.pulsar('angelo', 'Confirmar');
    const [p] = await pedidos();
    expect(p!.estado).toBe('confirmado');
    expect(sala.enviados.some((m) => m.texto.includes('Registrado') && m.texto.includes('Pedido a costo de menudeo creado y confirmado'))).toBe(true);
    const f = (await q<{ f: string; h: string; s: string; t: string }>("select c.fecha_compromiso::text as f, c.hora_compromiso::text as h, s.nombre as s, d.tipo_venta as t from operacion.ds_pedido_compromiso c join operacion.pedido_ds d on d.pedido_id = c.pedido_id join catalogo.socio s on s.id = c.comprometido_por"))[0]!;
    expect(f).toMatchObject({ f: '2026-11-20', h: '15:00:00', s: 'Angelo', t: 'socio_a_costo' });
    expect(await cuenta('entrega.destinatario')).toBe(0);
    expect(await rojas()).toEqual([]);
  });

  it('otro socio: Javier no puede mandar pedido_menudeo (rechazo antes del resumen; SQL tambien lo exige)', async () => {
    const antes = (await pedidos()).length;
    await sala.escribir('javier', '/pedidomenudeo mm modelo/uva 5 | cuando 21 de noviembre');
    expect(sala.ultimo().texto).toContain('Solo Angelo, que lleva el menudeo');
    expect((await pedidos()).length).toBe(antes);
    await expect(q("select agente.ejecutar_ext('mm:directo', 'pedido_menudeo', jsonb_build_object('autor', 'javier', 'telegram_user_id', $1::bigint, 'origen', 'x', 'lineas', '[]'::jsonb))", [ID.javier])).rejects.toMatchObject({ code: '42501' });
  });

  it('faltante + "sin fecha": el bot pregunta cuando paga y el pedido queda sin fecha comprometida', async () => {
    await sala.escribir('angelo', '/pedidomenudeo mm modelo/menta 5');
    expect(sala.ultimo().texto).toContain('¿Cuándo pagas este pedido?');
    await sala.escribir('angelo', 'sin fecha');
    expect(sala.ultimo().texto).toContain('ninguna');
    await sala.pulsar('angelo', 'Confirmar');
    const p = (await pedidos())[1]!;
    expect((await q<{ f: string | null }>('select fecha_compromiso::text as f from operacion.ds_pedido_compromiso where pedido_id = $1', [p.id]))[0]!.f).toBeNull();
  });

  it('fecha ambigua: "mañana a las 5" se pregunta con botones; nada se registra hasta elegir y confirmar', async () => {
    const antes = (await pedidos()).length;
    await sala.escribir('angelo', '/pedidomenudeo mm modelo/uva 3');
    await sala.escribir('angelo', 'mañana a las 5');
    const op = sala.ultimo();
    expect(op.texto).toContain('mañana o de la tarde');
    expect(op.botones.flat().map((b) => b.texto).filter((t) => t !== 'Cancelar')).toHaveLength(2);
    expect((await pedidos()).length).toBe(antes);
    await sala.pulsar('angelo', op.botones.flat()[1]!.texto);
    expect(sala.ultimo().texto).toContain('17:00');
    await sala.pulsar('angelo', 'Cancelar');
    expect((await pedidos()).length).toBe(antes);
  });

  it('doble envio: el mismo update no duplica y el boton Confirmar se usa una sola vez', async () => {
    const antes = (await pedidos()).length;
    await sala.escribir('angelo', '/pedidomenudeo mm modelo/uva 2 | cuando 25 de noviembre', { updateId: 880_001, messageId: 880_001 });
    await sala.escribir('angelo', '/pedidomenudeo mm modelo/uva 2 | cuando 25 de noviembre', { updateId: 880_001, messageId: 880_001 });
    const resumen = sala.ultimo();
    await sala.pulsar('angelo', 'Confirmar', resumen);
    await sala.pulsar('angelo', 'Confirmar', resumen);
    expect((await pedidos()).length).toBe(antes + 1);
    expect(sala.enviados.filter((m) => m.texto.startsWith('Registrado') && m.texto.includes('2 pz')).length).toBe(1);
  });
});

describe('pago_pedido_menudeo y recordatorios', () => {
  let folio = '';
  let vence = new Date();

  it('el pedido se envia (/enviado) para poder pagarse', async () => {
    folio = (await pedidos())[0]!.folio;
    await enviar(folio);
    expect((await pedidos())[0]!.estado).toBe('enviado');
    // vence el 20-nov a las 15:00 de Merida (21:00 UTC)
    vence = new Date(Date.UTC(2026, 10, 20, 21, 0, 0));
  });

  it('interruptor APAGADO: el latido no envia nada ni reclama recordatorios', async () => {
    await q("update seguridad.interruptor set activo = false where clave = 'telegram_envio'");
    sala.ahora = new Date(vence.getTime() - 20 * 3_600_000);
    const antes = sala.enviados.length;
    const r = await crearAgenteProduccion(sala.deps()).enviarRecordatoriosMenudeo();
    expect(r).toMatchObject({ estado: 'omitido', enviados: 0 });
    expect(sala.enviados.length).toBe(antes);
    expect(await cuenta('operacion.ds_recordatorio_log')).toBe(0);
  });

  it('interruptor ENCENDIDO: avisa 24 h antes al grupo (sin botones); un segundo latido y un reintento no duplican', async () => {
    await q("update seguridad.interruptor set activo = true where clave = 'telegram_envio'");
    const antes = sala.enviados.length;
    const a = crearAgenteProduccion(sala.deps());
    expect((await a.enviarRecordatoriosMenudeo()).enviados).toBe(1);
    const msg = sala.ultimo();
    expect(msg.chat).toBe(ID.grupo);
    expect(msg.texto).toContain(`el pedido ${folio} de Angelo`);
    expect(msg.texto).toContain('vence pronto');
    expect(msg.texto).toContain('Pendiente de pago: $892.90');
    expect(msg.botones.flat()).toHaveLength(0);
    const [r2, r3] = await Promise.all([a.enviarRecordatoriosMenudeo(), crearAgenteProduccion(sala.deps()).enviarRecordatoriosMenudeo()]);
    expect(r2.enviados + r3.enviados).toBe(0);
    expect(sala.enviados.length).toBe(antes + 1);
    expect(await cuenta('operacion.ds_recordatorio_log')).toBe(1);
  });

  it('al vencer: "¿Ya pagaste?" con Pagado y Reprogramar; Javier no responde por Angelo; "Pagado" deja Pago reportado y el otro socio confirma', async () => {
    sala.ahora = new Date(vence.getTime() + 3_600_000);
    await crearAgenteProduccion(sala.deps()).enviarRecordatoriosMenudeo();
    const rec = sala.ultimo();
    expect(rec.texto).toContain('¿Ya pagaste?');
    expect(rec.botones.flat().map((b) => b.texto)).toEqual(['Pagado', 'Reprogramar']);
    await sala.pulsar('javier', 'Pagado', rec);
    expect(sala.ultimo().texto).toContain('¿Ya pagaste?'); // la tarjeta vuelve
    expect(await cuenta('operacion.ds_pago_reporte')).toBe(0);
    await sala.pulsar('angelo', 'Pagado', sala.ultimo());
    expect(await cuenta('operacion.ds_pago_reporte')).toBe(1);
    const tarjeta = sala.con('Pago reportado por Angelo');
    expect(tarjeta.texto).toContain('Todavía NO está aplicado');
    expect(await pendiente(folio)).toBe(89_290);
    await sala.pulsar('angelo', 'Confirmar recibido', tarjeta); // quien reporto no se confirma a si mismo
    expect(await pendiente(folio)).toBe(89_290);
    await sala.pulsar('javier', 'Confirmar recibido', sala.con('Pago reportado por Angelo'));
    expect(await pendiente(folio)).toBe(0);
    expect(sala.editados.some((t) => t.includes('confirmado como recibido por Javier'))).toBe(true);
    // un pago ya hecho no genera mas recordatorios
    sala.ahora = new Date(vence.getTime() + 5 * 24 * 3_600_000);
    expect((await crearAgenteProduccion(sala.deps()).enviarRecordatoriosMenudeo()).enviados).toBe(0);
  });

  it('pago con comprobante (foto): se guarda solo la huella, se aplica y el otro socio aun puede rechazar', async () => {
    const f2 = (await pedidos()).find((p) => p.folio !== folio && p.estado === 'confirmado')!;
    await enviar(f2.folio);
    await sala.foto('angelo');
    expect(sala.ultimo().texto).toContain('solo como evidencia');
    const ev = await q<{ huella: string; reporte_id: string | null; file_id: string }>('select huella, reporte_id::text, file_id from agente.evidencia_tg');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(ev[0]!.file_id).toBe('FILE-SINT-E2E');
    await sala.escribir('angelo', `/pagopedido ${f2.folio} | 100 | proveedor | ref CLAVE-SINT-1`);
    const resumen = sala.ultimo();
    expect(resumen.texto).toContain('aplicado de inmediato');
    await sala.pulsar('angelo', 'Confirmar', resumen);
    const total = Number((await q<{ s: string }>('select sum(l.piezas_pedidas::bigint * l.precio_cent)::text as s from operacion.pedido_linea l where l.pedido_id = $1', [f2.id]))[0]!.s);
    expect(await pendiente(f2.folio)).toBe(total - 10_000);
    const tarjeta = sala.con('Pago reportado por Angelo');
    expect(tarjeta.texto).toContain('Se aplicó con comprobante');
    expect(tarjeta.botones.flat().map((b) => b.texto)).toEqual(['Rechazar']);
    expect((await q<{ reporte_id: string | null }>('select reporte_id::text from agente.evidencia_tg'))[0]!.reporte_id).not.toBeNull();
    expect(await cuenta('entrega.evidencia_pago')).toBe(0); // el bot no guarda ni lee imagenes
    await sala.pulsar('javier', 'Rechazar', tarjeta);
    expect(sala.editados.some((t) => t.includes('rechazado por Javier'))).toBe(true);
  });

  it('Reprogramar: pregunta la fecha, la interpreta el codigo, se confirma con boton y queda en el historial con motivo', async () => {
    const p3 = (await pedidos()).find((p) => p.estado === 'confirmado' && p.folio !== folio)!;
    await enviar(p3.folio);
    sala.ahora = new Date(Date.UTC(2026, 10, 26, 18, 0, 0)); // 26-nov 12:00 Merida: el compromiso del 25-nov ya vencio
    await crearAgenteProduccion(sala.deps()).enviarRecordatoriosMenudeo();
    const rec = sala.con(`el pedido ${p3.folio} de Angelo`);
    expect(rec.botones.flat().map((b) => b.texto)).toEqual(['Pagado', 'Reprogramar']);
    await sala.pulsar('angelo', 'Reprogramar', rec);
    expect(sala.ultimo().texto).toContain('¿Para cuándo reprogramas');
    await sala.escribir('angelo', 'el 30 de noviembre a las 10 de la mañana');
    expect(sala.ultimo().texto).toContain('lunes 30 de noviembre de 2026, 10:00 (hora de Mérida)');
    const antes = await cuenta('operacion.ds_pedido_compromiso');
    await sala.pulsar('angelo', 'Sí, reprogramar');
    expect(await cuenta('operacion.ds_pedido_compromiso')).toBe(antes + 1);
    const ult = (await q<{ f: string; h: string; m: string }>('select fecha_compromiso::text as f, hora_compromiso::text as h, motivo as m from operacion.ds_pedido_compromiso where pedido_id = $1 order by id desc limit 1', [p3.id]))[0]!;
    expect(ult).toMatchObject({ f: '2026-11-30', h: '10:00:00' });
    expect(ult.m).toContain('Reprogramado desde Telegram');
  });

  it('Javier no avisa pagos de los pedidos de Angelo', async () => {
    await sala.escribir('javier', `/pagopedido ${folio} | 100 | proveedor`);
    expect(sala.ultimo().texto).toContain('Solo Angelo');
  });

  it('cierre: cuadra por dos vias, nada salio a otro chat que no sea el grupo y la red solo vio el fetch falso', async () => {
    expect(await rojas()).toEqual([]);
    expect(sala.enviados.every((m) => m.chat === ID.grupo)).toBe(true);
    expect(sala.llamadasRed.every((u) => u.startsWith('https://api.telegram.org/bot<token>/'))).toBe(true);
  });
});
