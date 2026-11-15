// Integracion de los TRES carriles de avisos (reloj + resumenes, cobranza, inventario y proveedores) con RELOJ SIMULADO: un dia completo (17-nov, hora de Merida) con TODOS los avisos
// encendidos SOLO dentro de la prueba (una transaccion que se revierte). Verifica: techo unico de 6 mensajes entre los tres carriles, silencio nocturno, deduplicacion, un solo digest
// (inventario viaja dentro del reporte del reloj), cesion de cobranza y que con los interruptores apagados no sale nada. Telegram FALSO: nada sale a la red. Datos ficticios.
// Base: RTM_TEST_DB_URL (base temporal con todas las migraciones).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarLatidoProduccion } from '@/composicion/produccion';
import { ejecutarPendientes, ejecutarResumenDiario } from '@/aplicacion/notificaciones/reportes_programados';
import { ejecutarRelojCobranza } from '@/aplicacion/agente/cobranza_reloj';
import { ejecutarRelojAvisos } from '@/aplicacion/agente/avisos_inventario';
import type { EnviadorTelegram } from '@/aplicacion/agente/puertos';
import { PuertoRelojCobranzaDb } from '@/infra/agente/cobranza_postgres';
import { PuertoAvisosInventarioDb } from '@/infra/agente/avisos_inventario_postgres';
import { PuertoReportesDb } from '@/infra/notificaciones/reportes_postgres';
import type { Sql } from '@/infra/postgres/servidor';
import { estado } from '../e2e/ayudas';

const url = process.env.RTM_TEST_DB_URL;
const c = new pg.Client({ connectionString: url ?? estado().DB_URL });
let n = 0;
const sql: Sql = async (t, p = []) => {
  const sp = `d${n++}`;
  await c.query(`savepoint ${sp}`);
  try { const r = (await c.query(t, [...p])).rows as never; await c.query(`release savepoint ${sp}`); return r; } catch (e) { await c.query(`rollback to savepoint ${sp}`); throw e; }
};
const q = async <T = Record<string, unknown>>(t: string, p: unknown[] = []): Promise<T[]> => sql<T>(t, p);

const GRUPO = -4_170_001;
const enviados: { chat: number; texto: string }[] = [];
const telegram: EnviadorTelegram = {
  async enviar(m) { enviados.push({ chat: m.chatId, texto: m.texto }); return { messageId: 7000 + enviados.length }; },
  async editar() {}, async responderCallback() {}, async salirDelChat() {},
};
const DIA = '2026-11-17';
// Merida = UTC-6 fijo.
const a = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 17, h + 6, m, 0));
const hhmm = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const interruptor = (clave: string, activo: boolean) => q('insert into seguridad.interruptor (clave, activo) values ($1, $2) on conflict (clave) do update set activo = $2', [clave, activo]);
const fijarRegla = (r: string) => q('select notificacion.fijar_regla($1::text, true, $2::timestamptz)', [r, '2026-11-01T00:00:00Z']);
const entregasTg = async () => Number((await q<{ n: number }>("select count(*)::int as n from notificacion.entrega where canal = 'telegram' and estado = 'pendiente'"))[0]!.n);
/** Mensajes que SALEN: los de transporte directo (cobranza, avisos de inventario) y las entregas del outbox (reloj) listas para el despacho. */
const salidas = async () => enviados.length + (await entregasTg());
const libro = async () => Number((await q<{ j: number }>('select notificacion.mensajes_dia($1::date) as j', [DIA]))[0]!.j);

// Un tick de cada carril a una hora simulada.
const pendientes = (h: number, m = 0) => ejecutarPendientes(new PuertoReportesDb(sql), a(h, m));
const resumen = (h: number, m = 0) => ejecutarResumenDiario(new PuertoReportesDb(sql), a(h, m));
const cobranza = async (h: number, m: number, tipo: 'am' | 'cierre') => ejecutarRelojCobranza(tipo, new PuertoRelojCobranzaDb(sql, { hoy: DIA, hora: hhmm(h, m) }), telegram);
const avisos = (h: number, m = 0) => ejecutarRelojAvisos(new PuertoAvisosInventarioDb(sql), { aGrupo: async (t) => { enviados.push({ chat: GRUPO, texto: t }); return true; } }, a(h, m));
const encolar = (codigo: string, clave: string, payload: Record<string, unknown>) => q('select notificacion.emitir($1::text, $2::text, $3::jsonb) as id', [codigo, clave, JSON.stringify(payload)]);

async function pedidoVencido(): Promise<void> {
  await q("update seguridad.interruptor set activo = true where clave = 'agente_escritura'");
  await q('select agente.registrar_miembro($1::bigint, $2::text)', [6_400_001, 'javier']);
  await q('select catalogo.asegurar_cliente($1, $2)', ['Dia Alfa', 'Javier']);
  await q(`do $$ begin if not exists (select 1 from catalogo.persona_bodega) then perform catalogo.asegurar_cliente('Dia Omar Cliente', 'Javier'); perform catalogo.asegurar_persona_bodega('Dia Omar Cliente', 'Dia Omar'); end if; end $$`);
  await q("select catalogo.asegurar_modelo('Dia Marca', 'Dia Modelo', 10000, 'ambas')");
  await q("select catalogo.asegurar_sku('Dia Modelo', 'Uva')");
  await q("select catalogo.fijar_costo('dia:k', 'Karen', 'Dia Modelo', 10000, negocio.hoy() - 40, 'prueba')");
  await q("select catalogo.fijar_costo('dia:k2', 'Isaac', 'Dia Modelo', 11000, negocio.hoy() - 40, 'prueba')");
  await q("select catalogo.fijar_precio('dia:p', 'Dia Alfa', 'Dia Modelo', 25000, negocio.hoy() - 40, 'chat')");
  await q("select operacion.registrar_movimiento('dia:m1', 'Dia Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 900, 9000000, negocio.hoy() - 30)");
  await q("select set_config('rtm.fecha_negocio', '2026-11-06', true)");
  const j = (extra: Record<string, unknown>) => JSON.stringify({ autor: 'javier', telegram_user_id: 6_400_001, origen: 'x', ...extra });
  const cli = (await q<{ id: string }>("select id::text from catalogo.cliente where nombre_canonico = 'Dia Alfa'"))[0]!.id;
  const lin = (await q<{ l: unknown }>("select jsonb_build_array(jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_canonico = 'Dia Modelo'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = 'Uva'), 'piezas', 16)) as l"))[0]!.l;
  await q("select agente.ejecutar_ext('dia:a1', 'pedido_crear', $1::jsonb)", [j({ cliente_id: Number(cli), plazo_dias: 10, lineas: lin })]);
  const folio = (await q<{ f: string }>("select folio as f from operacion.pedido where id = (select (resultado ->> 'pedido_id')::bigint from seguridad.operacion where clave = 'dia:a1')"))[0]!.f;
  await q("select agente.ejecutar_ext('dia:a1e', 'envio_lote', $1::jsonb)", [j({ aceptar_avisos: true, paqueteria: 'castores', folios: [folio] })]);
  await q("select set_config('rtm.fecha_negocio', '', true)");
  await q("update seguridad.interruptor set activo = false where clave = 'agente_escritura'");
}

beforeAll(async () => {
  if (!url) return;
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  await q('select agente.registrar_chat($1::text, $2::bigint)', ['grupo_socios', GRUPO]);
  await q('select notificacion.vaciar_pendientes(true)');
  await pedidoVencido();
});
afterAll(async () => { if (!url) return; await c.query('rollback').catch(() => undefined); await c.end(); });

describe.skipIf(!url)('un dia completo con los tres carriles, reloj simulado', () => {
  it('con TODOS los interruptores apagados no sale nada en todo el dia, aunque telegram_envio este encendido', async () => {
    await interruptor('telegram_envio', true);
    await q("update agente.aviso_regla set activo = true where codigo in ('din_descuento', 'cli_pago_dup', 'oc_llega', 'oc_atraso', 'inv_agotado')"); // reglas con su interruptor general apagado
    for (const [h, m] of [[3, 0], [7, 5], [9, 0], [9, 5], [12, 0], [17, 0], [20, 0], [22, 30]] as const) {
      await pendientes(h, m);
      await resumen(h, m);
      await cobranza(h, m, 'am');
      await cobranza(h, m, 'cierre');
      await encolar('din_descuento', `apagado:${h}:${m}`, { folio: 'X-1', cliente: 'C', descuento_cent: 1000, pct: 9 });
      await avisos(h, m);
    }
    expect(await salidas()).toBe(0);
    expect(await libro()).toBe(0);
    expect((await q<{ n: number }>('select count(*)::int as n from agente.aviso_cola'))[0]!.n).toBe(0);
    // El latido real (con las tareas nuevas de cobranza e inventario) tampoco manda nada.
    await ejecutarLatidoProduccion({ sql, ahora: () => a(9, 5), telegram, llm: undefined, entorno: {} });
    expect(await salidas()).toBe(0);
  });

  it('encendidos solo aqui: silencio nocturno, techo de 6, un solo digest, dedup y cesion', async () => {
    for (const k of ['reglas_automaticas', 'avisos_inventario', 'cobranza_activa']) await interruptor(k, true);
    for (const r of ['resumen_diario', 'pendientes_diarios', 'margen_bajo', 'cobertura_pagos', 'libro_no_cuadra', 'cuenta_vencida']) await fijarRegla(r);

    // 03:00 (silencio): un aviso inmediato NO critico espera; uno critico sale.
    await encolar('din_descuento', 'dia:desc1', { folio: 'D-1', cliente: 'Dia Alfa', descuento_cent: 5000, pct: 9 });
    expect((await avisos(3, 0)).enviados).toHaveLength(0);
    await encolar('cli_pago_dup', 'dia:dup1', { cliente: 'Dia Alfa', monto_cent: 100000, folio: 'F-1', folio_previo: 'F-0' });
    const noche = await avisos(3, 10);
    expect(noche.enviados).toHaveLength(1);
    expect(noche.enviados[0]!.texto).toContain('Posible pago duplicado');
    expect(await libro()).toBe(1);

    // 07:05: termina el silencio y sale el descuento que esperaba (inmediato 2 del dia).
    expect((await avisos(7, 5)).enviados.map((e) => e.ventana)).toEqual(['I']);
    expect(await libro()).toBe(2);

    // 08:30 llegan avisos de ventana M; 09:00 el reporte de pendientes los LLEVA DENTRO (un solo digest) y la ventana M de inventario no manda mensaje propio.
    await encolar('oc_llega', 'dia:oc1', { folio: 'OC-9', proveedor: 'Prov', piezas: 120, es_hoy: true });
    const antesM = enviados.length;
    expect(await pendientes(9, 0)).toEqual({ estado: 'ok', detalle: 'emitido' });
    expect((await avisos(9, 0)).enviados).toHaveLength(0); // M fusionado: sin mensaje propio
    expect(enviados.length).toBe(antesM);
    const cuerpo = (await q<{ t: string }>("select payload ->> 'texto' as t from operacion.aviso where clave_dedupe = $1", [`pendientes:${DIA}`]))[0]!.t;
    expect(cuerpo).toContain('OC-9');
    expect((await q<{ e: string }>("select estado as e from agente.aviso_cola where clave = 'dia:oc1'"))[0]!.e).toBe('enviado');
    expect(await libro()).toBe(3);

    // 09:05 digest de cobranza (mensaje aparte con tarjetas, cuenta en el mismo techo). El reloj cede su alerta de cuenta vencida: un solo mensaje por hecho.
    const cb = await cobranza(9, 5, 'am');
    expect(cb.estado).toBe('enviado');
    expect(enviados.at(-1)!.chat).toBe(GRUPO);
    expect(await libro()).toBe(4);
    const ced = await q<{ j: { estado: string } }>("select notificacion.emitir_estado('cuenta_vencida', 'dia:cv1', $1::jsonb, null, $2::timestamptz) as j", [JSON.stringify({ texto: 'Cuenta vencida', severidad: 'I' }), a(9, 10).toISOString()]);
    expect(ced[0]!.j.estado).toBe('cedida_a_cobranza');

    // Deduplicacion: repetir cada tick varias veces no manda nada nuevo.
    const base = await salidas();
    for (const m of [0, 3, 8]) { await pendientes(9, m); await cobranza(9, 10 + m, 'am'); await avisos(9, m); }
    expect(await salidas()).toBe(base);
    expect(await libro()).toBe(4);

    // Mediodia y tarde: dos alertas del reloj llevan el dia al techo (6).
    const emitir = async (regla: string, clave: string, h: number, m: number, sev: 'I' | 'C' = 'I') =>
      (await q<{ j: { estado: string; diferido_a?: string } }>('select notificacion.emitir_estado($1::text, $2::text, $3::jsonb, null, $4::timestamptz) as j', [regla, clave, JSON.stringify({ texto: `alerta ${regla}`, severidad: sev }), a(h, m).toISOString()]))[0]!.j;
    expect((await emitir('margen_bajo', 'dia:mb1', 12, 0)).estado).toBe('emitido');
    expect((await emitir('cobertura_pagos', 'dia:cob1', 14, 0)).estado).toBe('emitido');
    expect(await libro()).toBe(6);

    // 15:00 otro inmediato de inventario: el techo unico lo detiene (queda en la cola, no se pierde).
    await encolar('din_descuento', 'dia:desc2', { folio: 'D-2', cliente: 'Dia Alfa', descuento_cent: 7000, pct: 8 });
    expect((await avisos(15, 0)).enviados).toHaveLength(0);
    expect((await q<{ e: string }>("select estado as e from agente.aviso_cola where clave = 'dia:desc2'"))[0]!.e).toBe('pendiente');

    // 17:00 cierre de cobranza y 20:00 resumen: ambos topados.
    expect((await cobranza(17, 0, 'cierre')).estado).toBe('techo');
    expect(await resumen(20, 0)).toEqual({ estado: 'omitida', detalle: 'techo' });

    // 20:30 un CRITICO salta el techo (y cuenta).
    expect((await emitir('libro_no_cuadra', 'dia:lib1', 20, 30, 'C')).estado).toBe('emitido');
    expect(await libro()).toBe(7);

    // Total del dia: 6 mensajes hasta el techo + 1 critico; ninguno duplicado; todos al grupo de los socios.
    expect(await salidas()).toBe(7);
    expect(enviados.every((e) => e.chat === GRUPO)).toBe(true);
    expect(new Set(enviados.map((e) => e.texto)).size).toBe(enviados.length);

    // Silencio nocturno del reloj: a las 00:30 del dia siguiente un informativo se emite pero su entrega espera a las 07:00 de Merida.
    const madrugada = await q<{ j: { estado: string; diferido_a: string } }>("select notificacion.emitir_estado('resumen_diario', 'resumen:2026-11-18', $1::jsonb, null, $2::timestamptz) as j", [JSON.stringify({ texto: 'resumen nocturno', severidad: 'F' }), new Date(Date.UTC(2026, 10, 18, 6, 30)).toISOString()]);
    expect(madrugada[0]!.j.estado).toBe('emitido');
    expect(new Date(madrugada[0]!.j.diferido_a).toISOString()).toBe('2026-11-18T13:00:00.000Z');
  });
});
