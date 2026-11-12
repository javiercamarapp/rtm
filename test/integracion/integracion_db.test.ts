// Integracion contra la base LOCAL de las cuatro piezas de esta ola (agente de Telegram, latido y proveedores, reportes, paridad SQL/TypeScript).
// Todo corre dentro de UNA transaccion que se revierte al final: no deja filas. Ningun servicio externo: Telegram, IA, fuente de proveedores y reloj son dobles.
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tareaProgramada, webhookTelegram, type DepsProduccion } from '@/composicion/produccion';
import { techoCent, techoPctDeFraccion } from '@/dominio/dinero/techo';
import { estadoInicial, evaluarReserva, aplicarLiquidacion, aplicarLiberacion, REPARTO_DIA_MICRO, type RolPresupuesto } from '@/dominio/agente/presupuesto';
import { EnviadorTelegramMemoria } from '@/infra/agente/memoria';
import { LlmGuionado, respuesta } from '@/infra/agente/llm_simulado';
import { ContadorUpdates, updateBoton, updateTexto } from '@/infra/agente/updates';
import type { Sql } from '@/infra/postgres/servidor';
import { AlmacenPresupuestoDb } from '@/infra/agente/postgres';
import { estado } from '../e2e/ayudas';
import { LectorSimulado, modeloConSabores } from '../unit/proveedores/ayudas';

const c = new pg.Client({ connectionString: estado().DB_URL });
let n = 0;
let cola: Promise<unknown> = Promise.resolve();
/** Cada sentencia en su savepoint (un error esperado no aborta la transaccion de la prueba) y en fila: una sola conexion no admite sentencias intercaladas. */
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
      if (process.env.DEPURAR) process.stderr.write(`\nSQLERR ${t.slice(0, 90)} ${String(e)}\n`);
      throw e;
    }
  });
  cola = turno.catch(() => undefined);
  return turno as never;
};

const SECRETO = 's'.repeat(24);
const IDS = { angelo: 5_000_001, javier: 5_000_002, omar: 5_000_003, grupo: -100_200, extrano: 5_999_999 };

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
});
afterAll(async () => {
  await c.query('rollback');
  await c.end();
});

describe('paridad SQL y TypeScript', () => {
  it('el techo SQL es gemelo del de TypeScript (300 casos, incluidos negativos)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: -(10n ** 21n), max: 10n ** 21n }), fc.bigInt({ min: 1n, max: 10n ** 17n }), fc.constantFrom(1n, 100n), async (num, den, paso) => {
        const r = await c.query('select costos.techo($1::numeric, $2::numeric, $3::numeric)::text as t', [num.toString(), den.toString(), paso.toString()]);
        expect(BigInt(r.rows[0].t)).toBe(techoCent(num, den, paso));
      }),
      { numRuns: 300 },
    );
  });
  it('la participacion con techo al punto es gemela', async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 0n, max: 10n ** 9n }), fc.bigInt({ min: 1n, max: 10n ** 9n }), async (a, b) => {
        const [n, d] = a <= b ? [a, b] : [b, a];
        const r = await c.query('select costos.techo_pct_fraccion($1::numeric, $2::numeric)::text as t', [n.toString(), d.toString()]);
        expect(BigInt(r.rows[0].t)).toBe(techoPctDeFraccion(n, d));
      }),
      { numRuns: 300 },
    );
  });
  it('el presupuesto de IA de la base da lo mismo que el oraculo de TypeScript en secuencias al azar (100 secuencias)', async () => {
    const roles = Object.keys(REPARTO_DIA_MICRO) as RolPresupuesto[];
    const op = fc.record({ rol: fc.constantFrom(...roles), monto: fc.integer({ min: 1_000, max: 600_000 }), accion: fc.constantFrom('reservar', 'liquidar', 'liberar'), real: fc.integer({ min: 0, max: 700_000 }) });
    const almacen = new AlmacenPresupuestoDb(sql);
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 14 }), async (ops) => {
        await c.query('savepoint seq');
        try {
          await c.query('delete from agente.ia_reserva where true');
          await c.query('delete from agente.ia_presupuesto where true');
          let e = estadoInicial('2026-11-10');
          const abiertas: { clave: string; rol: RolPresupuesto; monto: bigint }[] = [];
          for (const [i, o] of ops.entries()) {
            if (o.accion === 'reservar') {
              const sdb = await almacen.reservar({ clave: `p:${i}`, rol: o.rol, microUsd: BigInt(o.monto), fechaNeg: '2026-11-10' });
              const ts = evaluarReserva(e, o.rol, BigInt(o.monto), '2026-11-10');
              expect(sdb.ok).toBe(ts.ok);
              if (ts.ok) { e = ts.estado; abiertas.push({ clave: `p:${i}`, rol: o.rol, monto: BigInt(o.monto) }); }
              else if (!sdb.ok) expect(sdb.motivo).toBe(ts.motivo);
            } else if (abiertas.length > 0) {
              const r = abiertas.shift()!;
              if (o.accion === 'liquidar') { await almacen.liquidar(r.clave, BigInt(o.real)); e = aplicarLiquidacion(e, r.rol, r.monto, BigInt(o.real)).estado; }
              else { await almacen.liberar(r.clave); e = aplicarLiberacion(e, r.rol, r.monto); }
            }
            const db = ((await c.query('select agente.presupuesto_estado() as j')).rows[0].j ?? { dia_micro: 0, mes_micro: 0 }) as { dia_micro: number; mes_micro: number };
            expect(BigInt(db.dia_micro)).toBe(e.diaMicro);
            expect(BigInt(db.mes_micro)).toBe(e.mesMicro);
          }
        } finally {
          await c.query('rollback to savepoint seq');
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('webhook de Telegram contra la base', () => {
  const tg = new EnviadorTelegramMemoria();
  const cont = new ContadorUpdates();
  const llm = new LlmGuionado([
    respuesta([{ tipo: 'gasto', gasto: 'uber', monto_centavos: 9000, pagado_por: 'javier', descripcion: null, fuente_cita: 'uber 90' }]),
    respuesta([{ tipo: 'toma_omar', lineas: [{ modelo_texto: 'Int Modelo 10K', sabor_texto: 'Sandia', piezas: 3 }], fuente_cita: '3 sandia' }]),
  ], 150_000n);
  const deps = (): DepsProduccion => ({ sql, telegram: tg, llm, ahora: () => new Date(), entorno: { TELEGRAM_WEBHOOK_SECRET: SECRETO } });
  const enviar = (u: unknown, secreto: string | null = SECRETO) => webhookTelegram2(deps(), secreto, JSON.stringify(u));
  const webhookTelegram2 = async (d: DepsProduccion, s: string | null, cuerpo: string) => (await import('@/composicion/produccion')).procesarWebhook(d, s, cuerpo);

  it('prepara miembros, chats y un modelo con existencia (todo sintetico)', async () => {
    await sql('select agente.registrar_miembro($1::bigint, $2::text)', [IDS.angelo, 'angelo']);
    await sql('select agente.registrar_miembro($1::bigint, $2::text)', [IDS.javier, 'javier']);
    await sql('select agente.registrar_miembro($1::bigint, $2::text)', [IDS.omar, 'omar']);
    await sql('select agente.registrar_chat($1::text, $2::bigint)', ['grupo_socios', IDS.grupo]);
    await sql('select agente.registrar_chat($1::text, $2::bigint)', ['privado_omar', IDS.omar]);
    await sql("select set_config('rtm.canal', 'importacion', true)");
    // La persona de la bodega es unica: si la base ya tiene una, se usa (y se le pone precio a este modelo sintetico); si no, se crea.
    let persona = (await sql<{ n: string }>('select c.nombre_canonico as n from catalogo.persona_bodega pb join catalogo.cliente c on c.id = pb.cliente_id limit 1'))[0]?.n;
    if (!persona) {
      persona = 'Int Omar Persona';
      await sql("select catalogo.asegurar_cliente('Int Omar Persona', 'Javier')");
      await sql("select catalogo.asegurar_persona_bodega('Int Omar Persona', 'Int Omar Persona')");
    }
    await sql("select catalogo.asegurar_modelo('Int Marca', 'Int Modelo 10K', 10000, 'ambas')");
    await sql("select catalogo.asegurar_sku('Int Modelo 10K', 'Sandia')");
    await sql("select catalogo.fijar_costo('int:k', 'Isaac', 'Int Modelo 10K', 10000, negocio.hoy() - 30, 'prueba')");
    await sql("select catalogo.fijar_precio('int:p', $1::text, 'Int Modelo 10K', 15000, negocio.hoy() - 30, 'chat')", [persona]);
    await sql("select operacion.registrar_movimiento('int:m', 'Int Modelo 10K', 'Sandia', 'bodega_omar', 'entrada_compra', 30, 300000, negocio.hoy() - 1)");
    await sql("select set_config('rtm.canal', '', true)");
    expect((await sql<{ j: unknown }>('select agente.chats() as j'))[0]!.j).toMatchObject({ grupoSocios: IDS.grupo });
  });

  it('sin secreto, con secreto equivocado o sin secreto configurado: 401 y no se toca nada', async () => {
    const u = updateTexto(cont, { de: IDS.javier, chat: IDS.grupo, texto: 'uber 90 pago javier' });
    expect((await enviar(u, null)).status).toBe(401);
    expect((await enviar(u, 'x'.repeat(24))).status).toBe(401);
    expect((await webhookTelegram2({ ...deps(), entorno: {} }, SECRETO, JSON.stringify(u))).status).toBe(401);
    expect((await sql<{ n: number }>('select count(*)::int as n from agente.tg_update'))[0]!.n).toBe(0);
  });

  it('una indicacion de Javier en el grupo se ejecuta directo, con canal telegram, eco y reserva de IA liquidada', async () => {
    const antes = (await sql<{ n: number }>("select count(*)::int as n from operacion.evento where canal = 'telegram'"))[0]!.n;
    const r = await enviar(updateTexto(cont, { de: IDS.javier, chat: IDS.grupo, texto: 'uber 90 pago javier', updateId: 9001 }));
    expect(r).toEqual({ status: 200, detalle: 'procesado' });
    expect((await sql<{ n: number }>("select count(*)::int as n from operacion.evento where canal = 'telegram'"))[0]!.n).toBeGreaterThan(antes);
    expect((await sql<{ n: number }>("select count(*)::int as n from operacion.gasto where categoria = 'uber' and monto_cent = 9000 and evento_id in (select id from operacion.evento where canal = 'telegram')"))[0]!.n).toBe(1);
    expect(tg.aChat(IDS.grupo).some((m) => m.texto.includes('$90.00'))).toBe(true);
    expect((await sql<{ n: number }>("select count(*)::int as n from ia.llamada where estado = 'liquidada'"))[0]!.n).toBeGreaterThanOrEqual(1);
    expect((await sql<{ j: { dia_micro: number } }>('select agente.presupuesto_estado() as j'))[0]!.j.dia_micro).toBe(150_000);
  });

  it('el mismo update_id dos veces no se ejecuta dos veces ni gasta IA', async () => {
    const llamadas = llm.llamadas;
    await enviar(updateTexto(cont, { de: IDS.javier, chat: IDS.grupo, texto: 'uber 90 pago javier', updateId: 9001 }));
    expect(llm.llamadas).toBe(llamadas);
    expect((await sql<{ n: number }>("select count(*)::int as n from operacion.gasto where categoria = 'uber' and monto_cent = 9000 and evento_id in (select id from operacion.evento where canal = 'telegram')"))[0]!.n).toBe(1);
  });

  it('alguien ajeno al grupo no ejecuta nada', async () => {
    const llamadas = llm.llamadas;
    await enviar(updateTexto(cont, { de: IDS.extrano, chat: IDS.grupo, texto: 'uber 500 pago javier' }));
    expect(llm.llamadas).toBe(llamadas);
  });

  it('Omar pide una toma: queda pendiente (reserva, sin kardex ni saldo), el grupo recibe la tarjeta y solo un socio autoriza, una vez', async () => {
    await enviar(updateTexto(cont, { de: IDS.omar, chat: IDS.omar, texto: '3 sandia' }));
    const tarjeta = tg.aChat(IDS.grupo).filter((m) => m.botones).at(-1)!;
    expect(tarjeta.botones!.flat().map((b) => b.texto)).toEqual(['Autorizar', 'Rechazar']);
    expect((await sql<{ e: string }>("select estado as e from operacion.toma_omar order by id desc limit 1"))[0]!.e).toBe('pendiente');
    expect((await sql<{ n: number }>("select count(*)::int as n from operacion.reserva where origen_tipo = 'toma_omar' and estado = 'activa'"))[0]!.n).toBe(1);
    expect(tg.aChat(IDS.omar).map((m) => m.texto).join(' ')).not.toMatch(/costo|margen|utilidad|proveedor|isaac|karen|socio|cliente/i);
    const boton = tarjeta.botones![0]![0]!;
    // Omar pulsa: sin cambios.
    await enviar(updateBoton(cont, { de: IDS.omar, chat: IDS.grupo, messageId: tarjeta.messageId, data: boton.callbackData }));
    expect((await sql<{ e: string }>("select estado as e from operacion.toma_omar order by id desc limit 1"))[0]!.e).toBe('pendiente');
    // Javier autoriza.
    await enviar(updateBoton(cont, { de: IDS.javier, chat: IDS.grupo, messageId: tarjeta.messageId, data: boton.callbackData }));
    expect((await sql<{ e: string }>("select estado as e from operacion.toma_omar order by id desc limit 1"))[0]!.e).toBe('autorizada');
    // Segunda pulsacion: token usado, sin cambios.
    await enviar(updateBoton(cont, { de: IDS.angelo, chat: IDS.grupo, messageId: tarjeta.messageId, data: boton.callbackData }));
    expect((await sql<{ n: number }>("select count(*)::int as n from operacion.toma_omar where estado = 'autorizada'"))[0]!.n).toBe(1);
  });
});

describe('latido, proveedores y reportes contra la base', () => {
  const lector = new LectorSimulado();
  const tg = new EnviadorTelegramMemoria();
  // Lunes 16-nov-2026 06:03 en Merida = 12:03 UTC.
  const d = (): Partial<DepsProduccion> => ({ sql, telegram: tg, lectorProveedor: lector, ahora: () => new Date('2026-11-16T12:03:00Z'), entorno: { TAREAS_SECRETO: 't'.repeat(24) }, urlApp: 'http://127.0.0.1:3100' });
  const AUT = `Bearer ${'t'.repeat(24)}`;
  // Los asientos nacen al COMMIT (trigger diferido): se adelantan para que el libro y los auxiliares cuadren dentro de la transaccion de la prueba.
  beforeAll(async () => { await sql('set constraints all immediate'); });

  it('el latido exige su secreto', async () => {
    expect((await tareaProgramada('latido', null, d())).status).toBe(401);
    expect((await tareaProgramada('latido', 'Bearer malo', d())).status).toBe(401);
    expect((await tareaProgramada('latido', AUT, { ...d(), entorno: {} })).status).toBe(401);
  });

  it('con el interruptor apagado la lectura de proveedores queda omitida; encendido, lee con el puerto simulado, guarda estado y NO avisa en la primera lectura', async () => {
    lector.poner([modeloConSabores(1, 'Modelo Sintetico 8000', 4, 3)]);
    const a = (await tareaProgramada('latido', AUT, d())).cuerpo as { omitidas: string[]; ejecutadas: string[] };
    expect(a.omitidas.some((x) => x.startsWith('inventario-proveedores'))).toBe(true);
    expect(lector.peticiones.catalogo).toBe(0);
    await sql("update seguridad.interruptor set activo = true where clave = 'lectura_proveedores'");
    await sql('delete from notificacion.ejecucion where tarea = $1', ['inventario-proveedores']);
    const b = (await tareaProgramada('latido', AUT, d())).cuerpo as { ejecutadas: string[] };
    expect(b.ejecutadas.some((x) => x.startsWith('inventario-proveedores'))).toBe(true);
    expect(lector.peticiones.catalogo).toBe(1);
    expect((await sql<{ n: number }>('select count(*)::int as n from proveedores.variante'))[0]!.n).toBe(4);
    expect((await sql<{ n: number }>("select count(*)::int as n from operacion.aviso where clave_dedupe like 'prov:%'"))[0]!.n).toBe(0);
    expect((await sql<{ usadas: number }>("select usadas from proveedores.presupuesto where dia = '2026-11-16'"))[0]!.usadas).toBe(1);
  });

  it('dos latidos para la misma ventana: una sola lectura', async () => {
    const antes = lector.peticiones.catalogo;
    await tareaProgramada('latido', AUT, d());
    expect(lector.peticiones.catalogo).toBe(antes);
  });

  it('el lunes 06:00 el latido prepara el semanal del periodo cerrado: PDF por Chromium, aviso al grupo con enlace y nada de adjuntos', async () => {
    const r = await sql<{ j: { clave: string; version: number; estado: string; etiquetas: string[]; entregas: { telegram: boolean } }[] }>("select rep.versiones('semanal:2026-11-09') as j");
    expect(r[0]!.j).toHaveLength(1);
    const v = r[0]!.j[0]!;
    expect(v.estado).toBe('publicado');
    expect(v.etiquetas.length).toBeGreaterThan(0);
    const pdf = await sql<{ b: Buffer }>("select rep.pdf('semanal:2026-11-09', 1) as b");
    expect(pdf[0]!.b.subarray(0, 4).toString()).toBe('%PDF');
    const aviso = await sql<{ payload: { clave: string; version: number } }>("select payload from operacion.aviso where codigo = 'reporte_semanal' order by id desc limit 1");
    expect(aviso[0]!.payload).toMatchObject({ clave: 'semanal:2026-11-09', version: 1 });
    const entregas = await sql<{ canal: string; estado: string }>("select e.canal, e.estado from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.codigo = 'reporte_semanal' order by e.canal");
    expect(entregas.map((e) => e.canal)).toEqual(['correo', 'telegram']);
  }, 120_000);

  it('con Telegram encendido el siguiente latido despacha el aviso al grupo y no adjunta el PDF', async () => {
    await sql("update seguridad.interruptor set activo = true where clave = 'telegram_envio'");
    await sql("update notificacion.destino set telegram_chat_id = -100200 where clave = 'grupo_socios'");
    await sql("update notificacion.entrega set estado = 'pendiente', siguiente_intento_at = now(), codigo_error = null where canal = 'telegram' and estado = 'omitida'");
    // Una entrega por chat y por pasada: el latido de cada 5 minutos las despacha en orden.
    for (let i = 0; i < 6 && !tg.aChat(-100200).some((m) => m.texto.includes('/reportes/')); i++) await tareaProgramada('latido', AUT, d());
    const enviados = tg.aChat(-100200);
    expect(enviados.length).toBeGreaterThan(0);
    expect(enviados.some((m) => m.texto.includes('/reportes/semanal%3A2026-11-09/1'))).toBe(true);
    expect(enviados.every((m) => !('adjunto' in m))).toBe(true);
  });
});
