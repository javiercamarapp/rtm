// Conexion del rol de base `servidor` (sin BYPASSRLS): la usan el webhook de Telegram y las tareas programadas. Nunca la usa una pagina de socio.
// Consultas simples con parametros (compatibles con el pooler en modo transaccion).
import pg from 'pg';
import { env } from '@/config/env';

export type Sql = <T = Record<string, unknown>>(texto: string, params?: readonly unknown[]) => Promise<T[]>;

let pool: pg.Pool | null = null;
function obtener(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: env().SERVIDOR_DATABASE_URL, max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
  return pool;
}

export const sqlServidor: Sql = async (texto, params = []) => (await obtener().query(texto, [...params])).rows as never;

/** Una funcion SQL que devuelve jsonb: `select esquema.fn($1, $2) as j`. */
export async function llamar<T = unknown>(sql: Sql, fn: string, args: readonly unknown[] = []): Promise<T> {
  const marcas = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await sql<{ j: T }>(`select ${fn}(${marcas}) as j`, args);
  return r[0]?.j as T;
}

/** Varias llamadas en una sola transaccion (por ejemplo, marcar la ejecucion y hacer el trabajo). */
export async function enTransaccion<T>(f: (sql: Sql) => Promise<T>): Promise<T> {
  const c = await obtener().connect();
  const sql: Sql = async (texto, params = []) => (await c.query(texto, [...params])).rows as never;
  try {
    await c.query('begin');
    const r = await f(sql);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
