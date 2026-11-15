// E2E del reloj, el resumen diario, los pendientes y las alertas contra una base con TODAS las migraciones, con reloj simulado (se avanza `ahora`) y un Telegram FALSO que
// nunca sale a la red. Verifica: con los interruptores apagados NO sale nada aunque telegram_envio este encendido; encendidos, sale exactamente lo esperado y sin duplicados.
// Base: RTM_TEST_DB_URL o el Supabase local. Todo en UNA transaccion que se revierte al final.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarLatidoProduccion } from '@/composicion/produccion';
import type { EnviadorTelegram } from '@/aplicacion/agente/puertos';
import type { Sql } from '@/infra/postgres/servidor';
import { estado } from '../e2e/ayudas';

const c = new pg.Client({ connectionString: process.env.RTM_TEST_DB_URL ?? estado().DB_URL });
let n = 0;
const sql: Sql = async (t, p = []) => {
  const sp = `r${n++}`;
  await c.query(`savepoint ${sp}`);
  try { const r = (await c.query(t, [...p])).rows as never; await c.query(`release savepoint ${sp}`); return r; } catch (e) { await c.query(`rollback to savepoint ${sp}`); throw e; }
};

const enviados: { chat: number; texto: string }[] = [];
const telegram: EnviadorTelegram = {
  async enviar(m) { enviados.push({ chat: m.chatId, texto: m.texto }); return { messageId: 9000 + enviados.length }; },
  async editar() {}, async responderCallback() {}, async salirDelChat() {},
};
const GRUPO = -4_160_001;
// Merida es UTC-6: 20:00 Merida = 02:00 UTC del dia siguiente; 09:00 Merida = 15:00 UTC.
const utc = (dia: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, dia, h, mi, 0));
const latido = (ahora: Date) => ejecutarLatidoProduccion({ sql, ahora: () => ahora, telegram, llm: undefined, entorno: {} });
const interruptor = (clave: string, activo: boolean) => sql('insert into seguridad.interruptor (clave, activo) values ($1, $2) on conflict (clave) do update set activo = $2', [clave, activo]);

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
  await sql("select set_config('rtm.canal', 'importacion', true)");
  await sql('select agente.registrar_chat($1::text, $2::bigint)', ['grupo_socios', GRUPO]);
  await sql('select notificacion.vaciar_pendientes(true)');
});
afterAll(async () => { await c.query('rollback').catch(() => undefined); await c.end(); });

describe('reloj, resumen diario y pendientes con reloj simulado', () => {
  it('con los interruptores apagados NO sale nada, aunque telegram_envio este encendido', async () => {
    await interruptor('telegram_envio', true);
    for (const ahora of [utc(15, 15), utc(17, 2), utc(17, 15), utc(18, 2)]) await latido(ahora);
    expect(enviados).toHaveLength(0);
    const r = await sql<{ n: number }>("select count(*)::int as n from operacion.aviso where clave_dedupe like 'resumen:%' or clave_dedupe like 'pendientes:%'");
    expect(r[0]!.n).toBe(0);
  });

  it('encendidos, el resumen de las 20:00 sale una sola vez por dia, aunque el latido corra varias veces', async () => {
    await sql('select notificacion.fijar_regla($1::text, true)', ['resumen_diario']);
    await interruptor('reglas_automaticas', true);
    await latido(utc(19, 2, 0)); // 20:00 del 18-nov (Merida)
    await latido(utc(19, 2, 3)); // otro latido dentro de la misma ventana de 10 minutos
    await latido(utc(19, 2, 5));
    const textos = enviados.filter((e) => e.texto.startsWith('Resumen del 18-11'));
    expect(textos).toHaveLength(1);
    expect(textos[0]!.chat).toBe(GRUPO);
    expect(textos[0]!.texto).toContain('Ventas del dia:');
    expect(textos[0]!.texto).toContain('Libro: cuadra.');
    // Al dia siguiente, otro resumen (clave estable por fecha). El reloj de la base es el real: se envejece la entrega anterior para simular que paso un dia.
    await sql("update notificacion.entrega set creada_at = creada_at - interval '1 day' where creada_at > now() - interval '1 hour'");
    await latido(utc(20, 2, 0));
    await latido(utc(20, 2, 6)); // el despacho de la entrega ocurre en el latido siguiente al que emite
    expect(enviados.filter((e) => e.texto.startsWith('Resumen del 19-11'))).toHaveLength(1);
    expect(enviados.filter((e) => e.texto.startsWith('Resumen del'))).toHaveLength(2);
  });

  it('los pendientes de las 09:00 salen solo con su propia regla encendida', async () => {
    const antes = enviados.length;
    await latido(utc(20, 15, 0)); // 09:00 del 20-nov: regla de pendientes apagada
    expect(enviados.slice(antes).filter((e) => e.texto.startsWith('Pendientes'))).toHaveLength(0);
    await sql('select notificacion.fijar_regla($1::text, true)', ['pendientes_diarios']);
    await latido(utc(21, 15, 0)); // 09:00 del 21-nov
    await latido(utc(21, 15, 2));
    await latido(utc(21, 15, 7));
    expect(enviados.filter((e) => e.texto.startsWith('Pendientes del 21-11'))).toHaveLength(1);
  });

  it('el resumen cae dentro del horario (20:00) y nunca se entrega fuera de el: a las 22:30 un informativo espera a las 07:00', async () => {
    const r = await sql<{ j: { estado: string; diferido_a: string | null } }>(
      "select notificacion.emitir_programado('resumen_diario', 'e2e:silencio:1', 'F', 'x', 'texto de prueba', null::text, null::bigint, '{}'::jsonb, $1::timestamptz) as j", [utc(22, 4, 30).toISOString()]);
    expect(r[0]!.j.estado).toBe('emitido');
    expect(new Date(r[0]!.j.diferido_a!).toISOString()).toBe('2026-11-22T13:00:00.000Z'); // 07:00 de Merida del 22-nov
    const antes = enviados.length;
    await latido(utc(22, 4, 31)); // 22:31 Merida (el 21): en silencio, no sale
    expect(enviados.slice(antes).some((e) => e.texto === 'texto de prueba')).toBe(false);
  });

  it('el maestro apagado corta todo de inmediato', async () => {
    await interruptor('reglas_automaticas', false);
    const antes = enviados.length;
    await latido(utc(23, 2, 0));
    expect(enviados).toHaveLength(antes);
  });

  it('el vaciado deja la cola sin pendientes y no reabre las omitidas', async () => {
    const r = await sql<{ j: { pendientes_despues: number } }>('select notificacion.vaciar_pendientes(true) as j');
    expect(r[0]!.j.pendientes_despues).toBe(0);
  });
});
