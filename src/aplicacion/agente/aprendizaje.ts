// Modulo de APRENDIZAJE Y ALTA ASISTIDA del bot (carril bot/aprendizaje-alta). Codigo nuevo y aislado: el orquestador (agente.ts) solo lo invoca en cuatro puntos.
//   1. interceptar: respuestas si/no a una pregunta que el SERVIDOR recuerda en ese chat (sabores parecidos, alias, recargo), "duplicados pendientes", "deshacer union/alias", jerga.
//   2. manejarIntencion: alias_ensenar, alias_respuesta, sabor_respuesta y recargo_credito (lo que el interprete extrae; el id de la pregunta jamas lo pone el modelo).
//   3. registrarAlta: alta de cliente, sabor y modelo cuando la conversacion ya tiene todos los datos (con deteccion de parecidos y sin inventar costos).
//   4. contexto / aprender: alias, jerga y ejemplos anonimizados que entran al prompt como contexto acotado; correcciones que alimentan el diccionario.
// Reglas del dueno: el modelo de IA NUNCA calcula dinero ni decide; el bot NUNCA escribe a clientes, proveedores ni Omar; todo lo que se guarda lo avisa el bot al grupo de los socios.
import { anonimizarEjemplo } from '@/dominio/agente/anonimizar';
import {
  bloqueContextoAprendido, interpretarPuffs, reconocerAtajo, respuestaConPendiente, textoRevisionSemanal, VACIO,
  type ClaseAprendida, type ContextoAprendido, type ResumenAprendizaje,
} from '@/dominio/agente/aprendizaje';
import type { Intencion } from '@/dominio/agente/intenciones';
import { resolverCliente, type EntradaCatalogo } from '@/dominio/agente/resolutor';
import { TEXTO_NO_ENTENDI } from '@/dominio/agente/sabores';
import type { Miembro } from '@/dominio/agente/tipos';
import { RegistroCifras } from '@/dominio/agente/cifras';
import type { OperacionCompleta, ResultadoRegistro } from './conversacion';
import type { MensajeListo } from './plantillas';

export type RespSql = { estado?: string; texto?: string; aviso_grupo?: string | null; folio?: string; [k: string]: unknown };
export type SiNo = 'si' | 'no';
export type TipoPregunta = 'sabor_duplicado' | 'alias' | 'recargo';

/** La base rechazo con un mensaje claro (permiso, solo lectura, ventana de 10 minutos...): se le dice tal cual al socio. */
export class RechazoAprendizaje extends Error {
  constructor(mensaje: string, readonly codigo: string) {
    super(mensaje);
    this.name = 'RechazoAprendizaje';
  }
}

/** Puerto hacia las funciones SQL agente.* del carril. Todas verifican al socio por su id de Telegram; ninguna calcula dinero en TypeScript. */
export interface PuertoAprendizaje {
  preguntaVigente(chatId: number): Promise<{ tipo: TipoPregunta; texto: string } | null>;
  aliasProponer(clave: string, autor: Miembro, chatId: number, clase: ClaseAprendida, alias: string, oficial: string): Promise<RespSql>;
  aliasResponder(clave: string, autor: Miembro, chatId: number, respuesta: SiNo): Promise<RespSql>;
  aliasDeshacer(clave: string, autor: Miembro): Promise<RespSql>;
  saborPreguntar(clave: string, chatId: number): Promise<RespSql>;
  saborResponder(clave: string, autor: Miembro, chatId: number, respuesta: SiNo): Promise<RespSql>;
  saborDeshacer(clave: string, autor: Miembro): Promise<RespSql>;
  recargoPreguntar(clave: string, autor: Miembro, chatId: number, destino: { pedidoFolio: string | null; clienteId: string | null }): Promise<RespSql>;
  recargoResponder(clave: string, autor: Miembro, chatId: number, respuesta: SiNo): Promise<RespSql>;
  contexto(texto: string): Promise<ContextoAprendido>;
  ejemploRegistrar(clave: string, autor: Miembro, operacion: string, textoAnonimo: string, folio: string | null): Promise<void>;
  correccionRegistrar(clave: string, autor: Miembro, clase: ClaseAprendida, dicho: string, correcto: string): Promise<RespSql>;
  jergaAgregar(clave: string, autor: Miembro, termino: string, significado: string, tipo: 'jerga' | 'abreviatura'): Promise<RespSql>;
  altaCliente(clave: string, autor: Miembro, a: { nombre: string; tipo: string; duenio: string; plazoDias: number | null; confirmar: boolean }): Promise<RespSql>;
  altaSabor(clave: string, autor: Miembro, a: { modelo: string; sabor: string; confirmar: boolean }): Promise<RespSql>;
  altaModelo(clave: string, autor: Miembro, a: { nombre: string; marca: string; puffs: number | null; proveedorCosto: string; costoCent: number | null; confirmar: boolean }): Promise<RespSql>;
  resumenSemanal(): Promise<ResumenAprendizaje>;
}

export interface EntradaAprendizaje {
  chatId: number;
  autor: Miembro;
  texto: string;
  /** Clave base (p. ej. `tg:<update_id>`): de ella se derivan las claves de idempotencia. */
  clave: string;
}

/** Mensajes que el bot publica en el grupo de los socios (el unico destino: nunca a clientes, proveedores ni Omar). */
export type SalidaAprendizaje = { textos: string[] };

const TIPOS_QUE_MANEJA: ReadonlySet<string> = new Set(['alias_ensenar', 'alias_respuesta', 'sabor_respuesta', 'recargo_credito']);
const sal = (...textos: Array<string | null | undefined>): SalidaAprendizaje => ({ textos: textos.filter((t): t is string => typeof t === 'string' && t !== '') });

export function listoParaGrupo(texto: string): MensajeListo {
  const r = new RegistroCifras();
  r.servidor(texto);
  return { texto, registro: r };
}

export class ModuloAprendizaje {
  constructor(private readonly p: PuertoAprendizaje, private readonly clientes: () => Promise<EntradaCatalogo[]> = async () => []) {}

  maneja(tipo: string): boolean {
    return TIPOS_QUE_MANEJA.has(tipo);
  }

  /** Corre una llamada a la base y convierte un rechazo claro en texto para el socio (un error inesperado sube: el webhook lo registra y avisa). */
  private async seguro(f: () => Promise<SalidaAprendizaje>): Promise<SalidaAprendizaje> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof RechazoAprendizaje) return sal(e.message);
      throw e;
    }
  }

  // ------------------------------------------------------------------ 1. texto del socio

  /**
   * Primera revision de un texto de socio SIN conversacion abierta: atajos del codigo (sin IA) y respuestas a la pregunta que el servidor dejo abierta en este chat.
   * Devuelve null si el mensaje no es para este modulo (sigue el camino normal). "ok", "ya" o "dale" cuentan como si SOLO si hay una pregunta abierta y vigente.
   */
  async interceptar(e: EntradaAprendizaje): Promise<SalidaAprendizaje | null> {
    const atajo = reconocerAtajo(e.texto);
    if (atajo !== null) {
      return this.seguro(async () => {
        switch (atajo.tipo) {
          case 'duplicados_pendientes': {
            const r = await this.p.saborPreguntar(`${e.clave}:pend`, e.chatId);
            return sal(r.texto);
          }
          case 'deshacer_union': {
            const r = await this.p.saborDeshacer(`${e.clave}:du`, e.autor);
            return sal(r.aviso_grupo, r.texto);
          }
          case 'deshacer_alias': {
            const r = await this.p.aliasDeshacer(`${e.clave}:da`, e.autor);
            return sal(r.aviso_grupo, r.texto);
          }
          case 'revision_semanal':
            return sal((await this.revisionSemanal()) ?? 'Esta semana no aprendi nada nuevo.');
          case 'jerga': {
            const r = await this.p.jergaAgregar(`${e.clave}:j`, e.autor, atajo.termino, atajo.significado, atajo.clase);
            return sal(r.aviso_grupo, r.texto);
          }
        }
      });
    }
    const pend = await this.p.preguntaVigente(e.chatId);
    if (pend === null) return null;
    const resp = respuestaConPendiente(e.texto);
    if (resp === 'no_se') {
      // Una frase corta que no se entiende se repregunta; una instruccion larga se deja pasar (la pregunta sigue abierta hasta que caduque o la reemplace otra).
      return e.texto.trim().split(/\s+/).length <= 4 ? sal(TEXTO_NO_ENTENDI, pend.texto) : null;
    }
    return this.responder(pend.tipo, resp, e);
  }

  private async responder(tipo: TipoPregunta, resp: SiNo, e: EntradaAprendizaje): Promise<SalidaAprendizaje> {
    return this.seguro(async () => {
      if (tipo === 'sabor_duplicado') {
        const r = await this.p.saborResponder(`${e.clave}:sr`, e.autor, e.chatId, resp);
        const salida = [r.aviso_grupo ?? null];
        // Terminada una pregunta, el bot ofrece la siguiente de la cola (si la hay).
        if (r.estado === 'unificado' || r.estado === 'distinto') {
          const sig = await this.p.saborPreguntar(`${e.clave}:sn`, e.chatId);
          if (sig.estado === 'pregunta') salida.push(sig.texto ?? null);
        }
        return sal(...salida);
      }
      if (tipo === 'alias') {
        const r = await this.p.aliasResponder(`${e.clave}:ar`, e.autor, e.chatId, resp);
        return sal(r.aviso_grupo, r.texto);
      }
      const r = await this.p.recargoResponder(`${e.clave}:rr`, e.autor, e.chatId, resp);
      return sal(r.aviso_grupo, r.texto);
    });
  }

  // ------------------------------------------------------------------ 2. intenciones del interprete

  async manejarIntencion(i: Intencion, e: EntradaAprendizaje): Promise<SalidaAprendizaje> {
    return this.seguro(async () => {
      if (i.tipo === 'alias_ensenar') {
        const r = await this.p.aliasProponer(`${e.clave}:ae`, e.autor, e.chatId, i.clase, i.alias_texto, i.oficial_texto);
        return sal(r.texto);
      }
      if (i.tipo === 'alias_respuesta' || i.tipo === 'sabor_respuesta') {
        // El modelo solo dice si/no; la pregunta es la que el servidor recuerda (nunca un id del modelo).
        const pend = await this.p.preguntaVigente(e.chatId);
        const esperada: TipoPregunta = i.tipo === 'alias_respuesta' ? 'alias' : 'sabor_duplicado';
        if (pend === null || pend.tipo !== esperada) {
          return sal('No tengo ninguna pregunta pendiente a la que responda ese mensaje. No registre nada.');
        }
        if (i.respuesta === 'no_se') return sal(TEXTO_NO_ENTENDI, pend.texto);
        return this.responder(esperada, i.respuesta, e);
      }
      if (i.tipo === 'recargo_credito') {
        let clienteId: string | null = null;
        if (i.pedido_folio === null) {
          if (i.cliente_texto === null) return sal('¿A qué pedido o cliente le aplico el recargo? Dime el folio.');
          const r = resolverCliente(i.cliente_texto, await this.clientes(), { rol: 'socio' });
          if (r.estado !== 'unico') return sal(`No identifique con certeza al cliente "${i.cliente_texto}". Dime el folio del pedido.`);
          clienteId = r.id;
        }
        const r = await this.p.recargoPreguntar(`${e.clave}:rp`, e.autor, e.chatId, { pedidoFolio: i.pedido_folio, clienteId });
        return sal(r.texto);
      }
      return sal();
    });
  }

  // ------------------------------------------------------------------ 3. altas

  /** Registra una alta con todos los datos que la conversacion ya pregunto. Un parecido (IGUAL o MUY PROBABLE) se PREGUNTA antes de crear; el costo de lista solo si lo dijo el socio. */
  async registrarAlta(op: OperacionCompleta): Promise<ResultadoRegistro> {
    const conf = op.permitirDuplicado;
    const clave = `${op.claveIdem}:c${conf ? 1 : 0}`;
    const s = op.slots;
    try {
      let r: RespSql;
      if (op.operacion === 'alta_cliente') {
        const plazo = s.plazo_habitual === undefined || s.plazo_habitual === null ? null : Number(s.plazo_habitual);
        r = await this.p.altaCliente(clave, op.autor, { nombre: String(s.nombre), tipo: String(s.tipo_cliente ?? 'mayoreo'), duenio: String(s.duenio), plazoDias: Number.isFinite(plazo) ? plazo : null, confirmar: conf });
      } else if (op.operacion === 'alta_sabor') {
        r = await this.p.altaSabor(clave, op.autor, { modelo: String(s.modelo), sabor: String(s.nombre), confirmar: conf });
      } else {
        const prov = String(s.proveedor_costo ?? 'ninguno');
        const costo = typeof s.costo === 'number' ? s.costo : null;
        r = await this.p.altaModelo(clave, op.autor, { nombre: String(s.nombre), marca: String(s.marca), puffs: interpretarPuffs(String(s.puffs ?? '')), proveedorCosto: prov, costoCent: prov === 'ninguno' ? null : costo, confirmar: conf });
      }
      if (r.estado === 'parecidos') return { tipo: 'pregunta', motivo: 'duplicado', texto: String(r.texto ?? 'Se parece a uno que ya existe. ¿Es distinto y lo creo?'), clave: 'duplicado' };
      if (r.estado === 'creado') return { tipo: 'registrado', folio: String(r.folio), mensaje: listoParaGrupo(String(r.aviso_grupo ?? 'Alta registrada.')) };
      if (r.estado === 'existente') return { tipo: 'rechazado', texto: String(r.texto ?? 'Ya existe.') };
      return { tipo: 'rechazado', texto: String(r.texto ?? 'No pude dar de alta eso.') };
    } catch (e) {
      if (e instanceof RechazoAprendizaje) return { tipo: 'rechazado', texto: e.message };
      throw e;
    }
  }

  // ------------------------------------------------------------------ 4. contexto y aprendizaje

  /** Bloque para el prompt: solo lo que el mensaje menciona mas lo reciente; tope duro de caracteres. Si la base falla, el bot sigue sin contexto (el contexto es ayuda, no requisito). */
  async contexto(texto: string): Promise<string> {
    try {
      return bloqueContextoAprendido(await this.p.contexto(texto));
    } catch {
      return bloqueContextoAprendido(VACIO);
    }
  }

  /**
   * Ejemplo propio ANONIMIZADO de una operacion recien registrada. Solo cuenta despues de 10 minutos sin deshacerse (la base lo verifica al leerlo). Un fallo aqui jamas afecta el registro.
   */
  async aprender(e: { clave: string; autor: Miembro; operacion: string; texto: string; folio: string | null; clientes: string[]; modelos: string[]; sabores: string[] }): Promise<void> {
    try {
      const anon = anonimizarEjemplo(e.texto, { clientes: e.clientes, modelos: e.modelos, sabores: e.sabores });
      if (anon === null) return;
      await this.p.ejemploRegistrar(`${e.clave}:ej`, e.autor, e.operacion, anon, e.folio);
    } catch {
      // Aprender es opcional.
    }
  }

  /** Una correccion del socio ("no, era Memo Lopez"): alimenta el diccionario. Con dos iguales el bot SUGIERE guardarlo como alias (nunca lo guarda solo). */
  async correccion(e: { clave: string; autor: Miembro; chatId: number; clase: ClaseAprendida; dicho: string; correcto: string }): Promise<SalidaAprendizaje> {
    try {
      const r = await this.p.correccionRegistrar(`${e.clave}:co`, e.autor, e.clase, e.dicho, e.correcto);
      if (r.sugerir_alias === true) {
        const q = await this.p.aliasProponer(`${e.clave}:coa`, e.autor, e.chatId, e.clase, e.dicho, String(r.oficial ?? e.correcto));
        return sal(q.estado === 'pregunta' ? `Ya me corregiste dos veces con "${e.dicho}". ${q.texto}` : null);
      }
    } catch {
      // Aprender es opcional.
    }
    return sal();
  }

  async revisionSemanal(): Promise<string | null> {
    return textoRevisionSemanal(await this.p.resumenSemanal());
  }
}
