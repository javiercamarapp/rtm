// E2E del carril bot/ventas-compras contra una base temporal con TODAS las migraciones. Sin bot real: el transporte de Telegram es un fetch falso (nada sale a la red) y el extractor de IA
// es guionado (ninguna llamada a modelos). Cada flujo: mensaje del socio, preguntas del bot, respuestas, registro real en SQL, mensaje final y que el libro cuadre (comprobaciones bloqueantes en verde).
// Todo dentro de UNA transaccion que se revierte al final. Se activa con BV_DB_URL (cadena de conexion de la base temporal); sin ella se omite.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { procesarWebhook, type DepsProduccion } from '@/composicion/produccion';
import { LlmGuionado, respuesta } from '@/infra/agente/llm_simulado';
import type { FetchLike } from '@/infra/agente/telegram_api';
import type { Intencion } from '@/dominio/agente/intenciones';
import type { Sql } from '@/infra/postgres/servidor';

const URL_DB = process.env.BV_DB_URL;
const c = new pg.Client({ connectionString: URL_DB });
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
const ID = { angelo: 6_100_001, javier: 6_100_002, grupo: -100_901 };
const C = 'cita';
const L = (modelo: string, piezas: number, sabor: string | null = null) => ({ modelo_texto: modelo, sabor_texto: sabor, piezas });

interface Enviado { id: number; chat: number; texto: string; botones: { texto: string; data: string }[][] }

class Sala {
  enviados: Enviado[] = [];
  llamadasRed: string[] = [];
  private idMsg = 5000;
  private upd = 1;
  private msg = 1;
  llm = new LlmGuionado([]);
  fetchFalso: FetchLike = async (url, init) => {
    this.llamadasRed.push(url.replace(TOKEN_FALSO, '<token>'));
    const metodo = url.split('/').pop()!;
    const cuerpo = JSON.parse(init.body) as { chat_id: number; text: string; reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] } };
    if (metodo === 'sendMessage') {
      const id = ++this.idMsg;
      this.enviados.push({ id, chat: cuerpo.chat_id, texto: cuerpo.text, botones: (cuerpo.reply_markup?.inline_keyboard ?? []).map((f) => f.map((b) => ({ texto: b.text, data: b.callback_data }))) });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: id } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) };
  };
  deps = (): DepsProduccion => ({ configAgente: { limiteMensajesPorMinuto: 0 }, sql, ahora: () => new Date(), llm: this.llm, fetchFn: this.fetchFalso, entorno: { TELEGRAM_BOT_TOKEN: TOKEN_FALSO, TELEGRAM_WEBHOOK_SECRET: SECRETO } });
  webhook = (u: unknown) => procesarWebhook(this.deps(), SECRETO, JSON.stringify(u));
  /** El socio escribe; `modelo` es lo que "entendio" el extractor guionado (solo si el mensaje llega a la IA). */
  async escribir(quien: 'angelo' | 'javier', texto: string, modelo?: Intencion[]) {
    if (modelo) this.llm = new LlmGuionado([respuesta(modelo)]);
    return this.webhook({ update_id: ++this.upd, message: { message_id: ++this.msg, from: { id: ID[quien] }, chat: { id: ID.grupo, type: 'supergroup' }, date: 1_794_000_000, text: texto } });
  }
  ultimo(): Enviado {
    const u = this.enviados.at(-1);
    if (!u) throw new Error('sin mensajes');
    return u;
  }
  async pulsar(quien: 'angelo' | 'javier', texto: string, de: Enviado = this.ultimo()) {
    const b = de.botones.flat().find((x) => x.texto === texto);
    if (!b) throw new Error(`no hay boton "${texto}" en: ${de.texto.slice(0, 300)} | botones: ${de.botones.flat().map((x) => x.texto).join(' / ')}`);
    return this.webhook({ update_id: ++this.upd, callback_query: { id: `cb${this.upd}`, from: { id: ID[quien] }, message: { message_id: de.id, chat: { id: ID.grupo, type: 'supergroup' } }, data: b.data } });
  }
}

const sala = new Sala();
const rojas = async (): Promise<number> => {
  await q('select contabilidad.asentar_pendientes()');
  return Number((await q<{ n: string }>('select count(*)::text as n from contabilidad.comprobaciones() c where not c.ok and c.bloqueante'))[0]!.n);
};
const pedidos = async (): Promise<number> => Number((await q<{ n: string }>('select count(*)::text as n from operacion.pedido'))[0]!.n);
const folioDe = async (clave: string): Promise<string> => (await q<{ folio: string }>("select folio from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1)", [clave]))[0]!.folio;

describe.skipIf(!URL_DB)('bot de ventas y compras: conversaciones de punta a punta (SQL real, Telegram y modelo simulados)', () => {
  beforeAll(async () => {
    await c.connect();
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    for (const [id, p] of [[ID.angelo, 'angelo'], [ID.javier, 'javier']] as const) await q('select agente.registrar_miembro($1::bigint, $2::text)', [id, p]);
    await q("select agente.registrar_chat('grupo_socios', $1::bigint)", [ID.grupo]);
    for (const nom of ['Ev Lupita Soto', 'Ev Memo Garcia']) await q('select catalogo.asegurar_cliente($1, $2)', [nom, 'Javier']);
    await q("select catalogo.asegurar_modelo('Ev Marca', 'Ev Modelo', 10000, 'ambas')");
    for (const sab of ['Uva', 'Mango']) await q('select catalogo.asegurar_sku($1, $2)', ['Ev Modelo', sab]);
    await q("select catalogo.fijar_costo('ev:k', 'Karen', 'Ev Modelo', 10000, negocio.hoy() - 30, 'prueba')");
    await q("select catalogo.fijar_costo('ev:i', 'Isaac', 'Ev Modelo', 11000, negocio.hoy() - 30, 'prueba')");
    for (const nom of ['Ev Lupita Soto', 'Ev Memo Garcia']) await q("select catalogo.fijar_precio($1, $2, 'Ev Modelo', 25000, negocio.hoy() - 30, 'chat')", [`ev:p:${nom}`, nom]);
    await q("select operacion.registrar_movimiento('ev:m1', 'Ev Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1000000, negocio.hoy() - 5)");
    await q("select operacion.registrar_movimiento('ev:m2', 'Ev Modelo', 'Mango', 'bodega_omar', 'entrada_compra', 100, 1000000, negocio.hoy() - 5)");
  });
  afterAll(async () => {
    await c.query('rollback');
    await c.end();
  });

  it('con la escritura apagada nada se registra; /escritura la enciende', async () => {
    const antes = await pedidos();
    await sala.escribir('angelo', 'dropshipping para Ev Lupita Soto: 10 ev modelo uva por karen directo', [{ tipo: 'pedido_ds', cliente_texto: 'Ev Lupita Soto', proveedor_origen: 'karen_directo', lineas: [L('ev modelo', 10, 'uva')], forma_pago: null, plazo_texto: null, envio_cobrado_centavos: null, folio_proveedor_texto: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toContain('solo lectura');
    expect(await pedidos()).toBe(antes);
    await sala.escribir('javier', '/escritura');
    expect(sala.ultimo().texto).toContain('Escritura ACTIVADA');
  });

  it('dropshipping a credito: pregunta contado o credito, plazo obligatorio y envio; registra, avisa con CxC y CxP y cuadra; se deshace dentro de 10 minutos', async () => {
    const antes = await pedidos();
    await sala.escribir('angelo', 'dropshipping para Ev Lupita Soto: 10 ev modelo uva por karen directo', [{ tipo: 'pedido_ds', cliente_texto: 'Ev Lupita Soto', proveedor_origen: 'karen_directo', lineas: [L('ev modelo', 10, 'uva')], forma_pago: null, plazo_texto: null, envio_cobrado_centavos: null, folio_proveedor_texto: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/contado o a crédito/i);
    await sala.pulsar('angelo', 'A crédito');
    expect(sala.ultimo().texto).toMatch(/cuántos días o semanas/i);
    expect(await pedidos(), 'un credito sin plazo no se registra').toBe(antes);
    await sala.escribir('angelo', 'a 15 dias');
    expect(sala.ultimo().texto).toMatch(/envío/i);
    await sala.pulsar('angelo', 'Sin envío');
    const eco = sala.ultimo();
    expect(eco.texto).toContain('Pedido registrado en sistema con folio');
    expect(eco.texto).toContain('Ev Lupita Soto');
    expect(eco.texto).toMatch(/EV MODELO/);
    expect(eco.texto).toMatch(/Karen/);
    expect(eco.texto).toMatch(/datos de entrega/i);
    const p = (await q<{ folio: string; plazo_dias: number; estado: string }>("select p.folio, p.plazo_dias, p.estado from operacion.pedido p join operacion.pedido_ds d on d.pedido_id = p.id where d.tipo_venta = 'cliente' order by p.id desc limit 1"))[0]!;
    expect(p).toMatchObject({ plazo_dias: 15, estado: 'confirmado' });
    expect(p.folio).toMatch(/^EL-\d{3}$/);
    expect(eco.texto).toContain(p.folio);
    expect(await rojas()).toBe(0);
    await sala.pulsar('angelo', 'Deshacer', eco);
    expect(sala.ultimo().texto).toContain('Deshecho');
    expect((await q<{ estado: string }>('select estado from operacion.pedido where folio = $1', [p.folio]))[0]!.estado).toBe('cancelado');
    expect(await rojas()).toBe(0);
  });

  it('pedidos de bodega, envio en lote SIN guia (avisos preguntados), guias despues emparejadas por pedido y por cliente', async () => {
    for (const [k, cli, sab, pz] of [['ev:b1', 'Ev Lupita Soto', 'Uva', 6], ['ev:b2', 'Ev Memo Garcia', 'Mango', 4], ['ev:b3', 'Ev Memo Garcia', 'Uva', 3]] as const) {
      await q('select agente.ejecutar_ext($1, $2, $3::jsonb)', [k, 'pedido_crear', JSON.stringify({ autor: 'javier', telegram_user_id: ID.javier, origen: 'x', plazo_dias: 7,
        cliente_id: (await q<{ id: string }>('select id from catalogo.cliente where nombre_canonico = $1', [cli]))[0]!.id,
        lineas: [{ modelo_id: Number((await q<{ id: string }>("select id from catalogo.modelo where nombre_canonico = 'Ev Modelo'"))[0]!.id), sabor_id: Number((await q<{ id: string }>('select id from catalogo.sabor where nombre_canonico = $1', [sab]))[0]!.id), piezas: pz }] })]);
    }
    const [f1, f2, f3] = [await folioDe('ev:b1'), await folioDe('ev:b2'), await folioDe('ev:b3')];
    // Primer tiempo: salen los tres con Castores, sin guia.
    await sala.escribir('javier', `ya salieron ${f1}, ${f2} y ${f3} por Castores`, [{ tipo: 'envio_lote', paqueteria: 'castores', folios: [f1, f2, f3], fuente_cita: C }]);
    let t = sala.ultimo();
    // La base avisa si el pedido tiene avisos sin aceptar: el bot pregunta, nunca los salta.
    if (/avisos sin aceptar/i.test(t.texto)) {
      expect(t.botones.flat().map((b) => b.texto)).toContain('Sí, continuar');
      await sala.pulsar('javier', 'Sí, continuar');
      t = sala.ultimo();
    }
    expect(t.texto).toContain('Pedidos enviados');
    expect(t.texto).toContain('Castores');
    expect((await q<{ n: string }>("select count(*)::text as n from operacion.pedido where folio = any($1) and estado = 'enviado' and paqueteria = 'Castores'", [[f1, f2, f3]]))[0]!.n).toBe('3');
    expect((await q<{ n: string }>('select count(*)::text as n from operacion.guia where pedido_id in (select id from operacion.pedido where folio = any($1))', [[f1, f2, f3]]))[0]!.n).toBe('0');
    expect(await rojas()).toBe(0);
    // Segundo tiempo: llegan las guias. La del primero por folio; la de "Ev Memo Garcia" es ambigua (dos pedidos): el bot PREGUNTA y no adivina.
    await sala.escribir('javier', `guias: ${f1} 8801001 y Ev Memo Garcia 8801002`, [{ tipo: 'guias_lote', paqueteria: null, guias: [{ pedido_folio: f1, cliente_texto: null, guia_texto: '8801001' }, { pedido_folio: null, cliente_texto: 'Ev Memo Garcia', guia_texto: '8801002' }], fuente_cita: C }]);
    expect(sala.ultimo().texto).toContain(`Ya emparejé: ${f1} con la guía 8801001`);
    expect(sala.ultimo().texto).toContain(f2);
    expect(sala.ultimo().texto).toContain(f3);
    expect((await q<{ n: string }>('select count(*)::text as n from operacion.guia where pedido_id in (select id from operacion.pedido where folio = any($1))', [[f1, f2, f3]]))[0]!.n, 'con duda no escribe').toBe('0');
    await sala.escribir('javier', `${f3} 8801002`);
    t = sala.ultimo();
    expect(t.texto).toContain('Guías capturadas');
    const g = await q<{ folio: string; numero: string; paqueteria: string }>('select p.folio, g.numero, g.paqueteria from operacion.guia g join operacion.pedido p on p.id = g.pedido_id where p.folio = any($1) order by p.folio', [[f1, f2, f3]]);
    expect(g).toEqual([{ folio: f1, numero: '8801001', paqueteria: 'Castores' }, { folio: f3, numero: '8801002', paqueteria: 'Castores' }].sort((a, b) => a.folio.localeCompare(b.folio)));
    expect(await rojas()).toBe(0);
    // Un envio en lote solo se puede corregir con un movimiento inverso: el boton Deshacer de un envio lo explica.
    expect(sala.llamadasRed.every((u) => u.startsWith('https://api.telegram.org/bot<token>/'))).toBe(true);
    expect(sala.enviados.every((e) => e.chat === ID.grupo)).toBe(true);
  });

  it('cobro con varios pedidos abiertos: pregunta a cual se aplica y la cuenta; sin tope', async () => {
    await sala.escribir('angelo', 'Ev Memo Garcia pago 250', [{ tipo: 'pago', cliente_texto: 'Ev Memo Garcia', monto_centavos: 25000, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: C }]);
    const t = sala.ultimo();
    expect(t.texto).toMatch(/cuenta/i);
    await sala.pulsar('angelo', 'Efectivo');
    // Con dos pedidos abiertos pregunta a cual se aplica (lo lee de la base): el mas antiguo o el que diga el socio.
    expect(sala.ultimo().texto).toMatch(/debe .* en 2 pedidos/);
    await sala.pulsar('angelo', 'Al más antiguo');
    expect(sala.ultimo().texto).toMatch(/Registrado|registrado/);
    expect(Number((await q<{ n: string }>("select count(*)::text as n from operacion.pago_aplicacion a join operacion.pedido p on p.id = a.pedido_id where a.reversa_de is null and p.folio like 'EM-%'"))[0]!.n)).toBe(1);
    expect(await rojas()).toBe(0);
  });

  it('devolucion y paquete perdido por conversacion (antes decian "hazlo en el software")', async () => {
    const f1 = await folioDe('ev:b1');
    const f2 = await folioDe('ev:b2');
    await sala.escribir('angelo', `${f1}: Ev Lupita Soto devolvio 2 ev modelo uva, vuelven al inventario, llego mal`, [{ tipo: 'devolucion', cliente_texto: 'Ev Lupita Soto', pedido_folio: f1, lineas: [{ modelo_texto: 'ev modelo', sabor_texto: 'uva', piezas: 2 }], destino: 'inventario', motivo: 'llego mal', fuente_cita: C }]);
        expect(sala.ultimo().texto).toMatch(/Registrado DV-\d+ por Angelo[\s\S]*Devolución de cliente registrada/);
    expect((await q<{ n: string }>('select count(*)::text as n from operacion.devolucion_cliente where pedido_id = (select id from operacion.pedido where folio = $1)', [f1]))[0]!.n).toBe('1');
    expect(await rojas()).toBe(0);
    await sala.escribir('angelo', `se perdio el paquete del pedido ${f2}, la paqueteria no lo entrego`, [{ tipo: 'paquete_perdido', pedido_folio: f2, cliente_texto: null, incidente: 'perdido', detalle: 'la paqueteria no lo entrego', fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/Registrado [\s\S]*Paquete perdido reportado/);
    expect((await q<{ n: string }>('select count(*)::text as n from operacion.paquete_incidente where pedido_id = (select id from operacion.pedido where folio = $1)', [f2]))[0]!.n).toBe('1');
    expect(await rojas()).toBe(0);
  });

  it('compra a proveedor, llegada parcial y cierre con faltante; el libro cuadra', async () => {
    await sala.escribir('javier', 'compra a isaac 20 ev modelo uva', [{ tipo: 'compra', proveedor_texto: 'isaac', lineas: [{ modelo_texto: 'ev modelo', sabor_texto: 'uva', piezas: 20 }], guia_centavos: null, pagado_por: null, fuente_cita: C }]);
    expect(sala.ultimo().texto).toMatch(/Registrado|Compra/);
    const cf = (await q<{ folio: string }>('select folio from operacion.compra order by id desc limit 1'))[0]!.folio;
    await sala.escribir('javier', `de la compra ${cf} llegaron 15 ev modelo uva`, [{ tipo: 'compra_recepcion', compra_folio: cf, lineas: [{ modelo_texto: 'ev modelo', sabor_texto: 'uva', piezas: 15 }], fuente_cita: C }]);
    expect((await q<{ estado: string }>('select estado from operacion.compra where folio = $1', [cf]))[0]!.estado).toBe('recibida_parcial');
    await sala.escribir('javier', `cierra la compra ${cf} con faltante, el proveedor no manda el resto`, [{ tipo: 'compra_cierre', compra_folio: cf, motivo: 'el proveedor no manda el resto', fuente_cita: C }]);
    expect((await q<{ estado: string }>('select estado from operacion.compra where folio = $1', [cf]))[0]!.estado).toBe('recibida');
    expect(await rojas()).toBe(0);
  });

  it('consultas: vencimientos y pedidos abiertos de un cliente, solo lectura', async () => {
    await sala.escribir('angelo', 'que pedidos vencen', [{ tipo: 'consulta', consulta: 'vencimientos', modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null, periodo: null }]);
    expect(sala.ultimo().texto).toMatch(/Vencimientos/);
    await sala.escribir('angelo', 'pedidos de Ev Memo Garcia', [{ tipo: 'consulta', consulta: 'pedidos', modelo_texto: null, sabor_texto: null, sujeto_texto: 'Ev Memo Garcia', folio: null, periodo: null }]);
    expect(sala.ultimo().texto).toMatch(/Pedidos abiertos de Ev Memo Garcia/);
  });
});
