// Adaptador de Postgres de los avisos de inventario (rol `servidor`; funciones agente.* de las migraciones 20261116800000 a 20261116800200).
// Cada puerta de escritura verifica en SQL que el telegram_user_id sea el del socio indicado; aqui solo se transporta. Ningun calculo en TypeScript.
import { RechazoInventario, type LineaConsulta, type PuertoAvisosInventario, type RespInventario } from '@/aplicacion/agente/avisos_inventario';
import type { DigestArmado, VentanaAviso } from '@/dominio/agente/avisos_inventario';
import type { Miembro } from '@/dominio/agente/tipos';
import type { Sql } from '@/infra/postgres/servidor';

const CODIGOS_RECHAZO: ReadonlySet<string> = new Set(['P0460', 'P0463', 'P0464', '42501', '22023']);

async function f<T>(sql: Sql, fn: string, marcas: string, args: readonly unknown[]): Promise<T> {
  try {
    const r = await sql<{ j: T }>(`select agente.${fn}(${marcas}) as j`, args);
    return r[0]!.j;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code !== undefined && CODIGOS_RECHAZO.has(err.code)) throw new RechazoInventario((err.message ?? 'La base rechazo la operacion.').replace(/^error: /i, ''), err.code);
    throw e;
  }
}

const quien = (a: Miembro): Record<string, unknown> => ({ autor: a.persona, telegram_user_id: a.telegramUserId });

export class PuertoAvisosInventarioDb implements PuertoAvisosInventario {
  constructor(private readonly sql: Sql) {}

  armar(ventana: VentanaAviso, ahora: Date): Promise<DigestArmado> {
    return f<DigestArmado>(this.sql, 'avisos_digest_armar', '$1::text, $2::timestamptz', [ventana, ahora.toISOString()]).then((d) => ({ estado: d.estado, items: d.items ?? [], restantes: Number((d as { restantes?: number }).restantes ?? 0) }));
  }
  confirmar(ventana: VentanaAviso, ids: number[], ahora: Date): Promise<number | null> {
    return f<number | null>(this.sql, 'avisos_digest_confirmar', '$1::text, $2::bigint[], $3::timestamptz', [ventana, ids, ahora.toISOString()]);
  }
  consulta(tipo: 'mas_vendido' | 'reponer'): Promise<{ titulo: string; lineas: LineaConsulta[] }> {
    return f(this.sql, 'consulta_inventario', '$1::text', [tipo]);
  }
  async hayPregunta(chatId: number, autor: Miembro): Promise<boolean> {
    return (await f<boolean>(this.sql, 'minimo_hay_pregunta', '$1::bigint, $2::text', [chatId, autor.persona])) === true;
  }
  minimoPaso(clave: string, autor: Miembro, chatId: number, texto: string): Promise<RespInventario> {
    return f(this.sql, 'minimo_paso', '$1::text, $2::jsonb', [clave, JSON.stringify({ ...quien(autor), chat_id: chatId, texto })]);
  }
  fijarAvisos(_clave: string, autor: Miembro, activo: boolean, regla: string | null): Promise<RespInventario> {
    return f(this.sql, 'avisos_fijar', '$1::boolean, $2::text, $3::bigint, $4::text', [activo, autor.persona, autor.telegramUserId, regla]);
  }
}
