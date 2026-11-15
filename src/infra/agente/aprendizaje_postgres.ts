// Adaptador de Postgres del modulo de aprendizaje y alta asistida (rol `servidor`, funciones agente.* de las migraciones 20261116500000 a 20261116500400).
// Cada puerta verifica en SQL que el telegram_user_id sea el del socio indicado; aqui solo se transporta. Ningun calculo de dinero en TypeScript.
import { RechazoAprendizaje, type PuertoAprendizaje, type RespSql, type SiNo, type TipoPregunta } from '@/aplicacion/agente/aprendizaje';
import type { ClaseAprendida, ContextoAprendido, ResumenAprendizaje } from '@/dominio/agente/aprendizaje';
import type { Miembro } from '@/dominio/agente/tipos';
import type { Sql } from '@/infra/postgres/servidor';

/** Codigos de error de negocio que la base devuelve con un mensaje pensado para el socio (identidad, solo lectura, ventana de 10 minutos, validacion). */
const CODIGOS_RECHAZO: ReadonlySet<string> = new Set(['P0460', 'P0463', 'P0464', '42501', '22023', 'P0409']);

async function f(sql: Sql, fn: string, marcas: string, args: readonly unknown[]): Promise<RespSql> {
  try {
    const r = await sql<{ j: RespSql | null }>(`select agente.${fn}(${marcas}) as j`, args);
    return r[0]?.j ?? {};
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code !== undefined && CODIGOS_RECHAZO.has(err.code)) {
      throw new RechazoAprendizaje((err.message ?? 'La base rechazo la operacion.').replace(/^error: /i, ''), err.code);
    }
    throw e;
  }
}

const quien = (a: Miembro): Record<string, unknown> => ({ autor: a.persona, telegram_user_id: a.telegramUserId });

export class PuertoAprendizajeDb implements PuertoAprendizaje {
  constructor(private readonly sql: Sql) {}

  private q(fn: string, clave: string, args: Record<string, unknown>): Promise<RespSql> {
    return f(this.sql, fn, '$1, $2::jsonb', [clave, JSON.stringify(args)]);
  }

  async preguntaVigente(chatId: number) {
    const r = await f(this.sql, 'pregunta_vigente', '$1::bigint', [chatId]);
    return r.tipo === undefined ? null : { tipo: (r as { tipo: TipoPregunta }).tipo, texto: String(r.texto ?? '') };
  }
  aliasProponer(clave: string, autor: Miembro, chatId: number, clase: ClaseAprendida, alias: string, oficial: string) {
    return this.q('alias_proponer', clave, { ...quien(autor), chat_id: chatId, clase, alias_texto: alias, oficial_texto: oficial });
  }
  aliasResponder(clave: string, autor: Miembro, chatId: number, respuesta: SiNo) { return this.q('alias_responder', clave, { ...quien(autor), chat_id: chatId, respuesta }); }
  aliasDeshacer(clave: string, autor: Miembro) { return this.q('alias_deshacer', clave, quien(autor)); }
  saborPreguntar(clave: string, chatId: number) { return this.q('sabor_preguntar_chat', clave, { chat_id: chatId }); }
  saborResponder(clave: string, autor: Miembro, chatId: number, respuesta: SiNo) { return this.q('sabor_responder_chat', clave, { ...quien(autor), chat_id: chatId, respuesta }); }
  saborDeshacer(clave: string, autor: Miembro) { return this.q('sabor_deshacer', clave, quien(autor)); }
  recargoPreguntar(clave: string, autor: Miembro, chatId: number, d: { pedidoFolio: string | null; clienteId: string | null }) {
    return this.q('recargo_preguntar', clave, { ...quien(autor), chat_id: chatId, pedido_folio: d.pedidoFolio, cliente_id: d.clienteId });
  }
  recargoResponder(clave: string, autor: Miembro, chatId: number, respuesta: SiNo) { return this.q('recargo_responder', clave, { ...quien(autor), chat_id: chatId, respuesta }); }
  async contexto(texto: string): Promise<ContextoAprendido> {
    const r = (await f(this.sql, 'aprendizaje_contexto', '$1::jsonb', [JSON.stringify({ texto: texto.slice(0, 2000) })])) as Partial<ContextoAprendido>;
    return { alias: r.alias ?? [], recientes: r.recientes ?? [], jerga: r.jerga ?? [], ejemplos: r.ejemplos ?? [] };
  }
  async ejemploRegistrar(clave: string, autor: Miembro, operacion: string, textoAnonimo: string, folio: string | null) {
    await this.q('ejemplo_registrar', clave, { ...quien(autor), operacion, texto_anonimo: textoAnonimo, folio });
  }
  correccionRegistrar(clave: string, autor: Miembro, clase: ClaseAprendida, dicho: string, correcto: string) {
    return this.q('correccion_registrar', clave, { ...quien(autor), clase, dicho_texto: dicho, correcto_texto: correcto });
  }
  jergaAgregar(clave: string, autor: Miembro, termino: string, significado: string, tipo: 'jerga' | 'abreviatura') {
    return this.q('jerga_agregar', clave, { ...quien(autor), termino, significado, tipo });
  }
  altaCliente(clave: string, autor: Miembro, a: { nombre: string; tipo: string; duenio: string; plazoDias: number | null; confirmar: boolean }) {
    return this.q('alta_cliente', clave, { ...quien(autor), nombre: a.nombre, tipo: a.tipo, duenio: a.duenio, plazo_dias: a.plazoDias, confirmar: a.confirmar });
  }
  altaSabor(clave: string, autor: Miembro, a: { modelo: string; sabor: string; confirmar: boolean }) {
    return this.q('alta_sabor', clave, { ...quien(autor), modelo_texto: a.modelo, sabor_texto: a.sabor, confirmar: a.confirmar });
  }
  altaModelo(clave: string, autor: Miembro, a: { nombre: string; marca: string; puffs: number | null; proveedorCosto: string; costoCent: number | null; confirmar: boolean }) {
    return this.q('alta_modelo', clave, { ...quien(autor), nombre: a.nombre, marca: a.marca, puffs: a.puffs, proveedor_costo: a.proveedorCosto, costo_cent: a.costoCent, confirmar: a.confirmar });
  }
  async resumenSemanal(): Promise<ResumenAprendizaje> {
    const r = await this.sql<{ j: ResumenAprendizaje }>('select agente.aprendizaje_resumen() as j');
    return r[0]!.j;
  }
}
