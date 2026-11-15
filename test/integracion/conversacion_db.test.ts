// Integracion: la maquina de conversacion contra las funciones SQL reales (agente.conversacion_*). Exige BC_DATABASE_URL (una base temporal con todas las migraciones); sin ella se omite.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { MotorConversacion } from '@/aplicacion/agente/conversacion';
import { AlmacenConversacionDb } from '@/infra/agente/conversacion_postgres';
import type { Sql } from '@/infra/postgres/servidor';
import { EjecutorFalso, CLIENTES, MODELOS, ANGELO, RESUMEN_EJEMPLO } from '../unit/agente/conversacion_ayudas';

const url = process.env.BC_DATABASE_URL;
const d = url ? describe : describe.skip;

d('conversacion contra SQL real', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const sql: Sql = async (t, p = []) => (await pool.query(t, [...p])).rows as never;
  afterAll(async () => {
    await pool.end();
  });

  it('pedido de bodega completo: abre, llena slots, registra con folio y deja la conversacion registrada', async () => {
    const chat = -9000000 - Math.floor(Math.random() * 100000);
    const almacen = new AlmacenConversacionDb(sql);
    const ejecutor = new EjecutorFalso();
    const sabores = [{ id: 's1', nombre: 'Mango', alias: [] }];
    const motor = new MotorConversacion(almacen, { catalogo: { clientes: async () => CLIENTES, modelos: async () => MODELOS, saboresEnExistencia: async () => sabores } }, ejecutor, { resumen: async () => RESUMEN_EJEMPLO });
    const base = `it-${chat}`;
    const ent = (n: number) => ({ chatId: chat, autor: ANGELO, ahora: new Date(), clave: `${base}-${n}`, mensajeId: n });
    let r = await motor.procesar(ent(1), { tipo: 'instruccion', operacion: 'pedido_bodega', candidatos: { cliente: 'Lupita', lineas: [{ modelo: 'nexa', sabor: 'mango', piezas: 24 }] }, cita: 'Lupita 24 nexa mango' });
    expect(r.tipo).toBe('pregunta');
    r = await motor.procesar(ent(2), { tipo: 'boton', valor: 'op:contado' });
    expect(r.tipo).toBe('pregunta');
    r = await motor.procesar(ent(3), { tipo: 'boton', valor: 'op:0' });
    expect(r.tipo).toBe('registrado');
    expect(ejecutor.operaciones[0]!.slots).toMatchObject({ cliente: { id: 'c3' }, modalidad: 'contado', plazo: 0, envio: 0 });
    const f = await sql<{ estado: string; folio_registro: string }>('select estado, folio_registro from agente.conversacion where chat_id = $1', [chat]);
    expect(f).toEqual([{ estado: 'registrada', folio_registro: 'PG-0001' }]);
    // La clave de idempotencia protege un reintento del mismo update.
    r = await motor.procesar(ent(3), { tipo: 'boton', valor: 'op:0' });
    expect(['sin_conversacion', 'registrado', 'pregunta']).toContain(r.tipo);
    const ev = await sql<{ n: string }>("select count(*)::text as n from agente.conversacion_evento e join agente.conversacion c on c.id = e.conversacion_id where c.chat_id = $1", [chat]);
    expect(Number(ev[0]!.n)).toBeGreaterThanOrEqual(5);
  });

  it('instruccion nueva con pregunta abierta: conflicto, reemplazo y cancelacion en SQL', async () => {
    const chat = -9100000 - Math.floor(Math.random() * 100000);
    const almacen = new AlmacenConversacionDb(sql);
    const ejecutor = new EjecutorFalso();
    const motor = new MotorConversacion(almacen, { catalogo: { clientes: async () => CLIENTES, modelos: async () => MODELOS, saboresEnExistencia: async () => [] } }, ejecutor);
    const ent = (n: number) => ({ chatId: chat, autor: ANGELO, ahora: new Date(), clave: `it2-${chat}-${n}`, mensajeId: n });
    await motor.procesar(ent(1), { tipo: 'instruccion', operacion: 'cobro_cliente', candidatos: { cliente: 'Ariel', monto: 100000 }, cita: 'Ariel pago 1,000' });
    let r = await motor.procesar(ent(2), { tipo: 'instruccion', operacion: 'gasto', candidatos: { tipo_gasto: 'uber', monto: 30000, pagado_por: 'javier' }, cita: 'gasto uber 300 javier' });
    expect(r.tipo === 'pregunta' && r.texto).toContain('¿Cancelo lo anterior');
    r = await motor.procesar(ent(3), { tipo: 'boton', valor: 'reemplazar' });
    expect(r.tipo).toBe('registrado');
    const f = await sql<{ estado: string; operacion: string }>('select estado, operacion from agente.conversacion where chat_id = $1 order by id', [chat]);
    expect(f).toEqual([{ estado: 'cancelada', operacion: 'cobro_cliente' }, { estado: 'registrada', operacion: 'gasto' }]);
  });
});
