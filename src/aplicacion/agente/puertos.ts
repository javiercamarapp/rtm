// Puertos del agente de Telegram. La aplicacion habla con estas interfaces; infra/agente las implementa (Telegram, OpenRouter, memoria).
// En esta ola todo corre contra implementaciones en memoria y un LLM simulado: ninguna llamada real.
import type { EntradaCatalogo, IdProveedor } from '@/dominio/agente/resolutor';
import type { Intencion, IConsulta } from '@/dominio/agente/intenciones';
import type { RolIa } from '@/dominio/agente/modelos';
import type { AvisoPresupuesto, MotivoCorte, RolPresupuesto } from '@/dominio/agente/presupuesto';
import type { CifraServidor, Miembro, RolMiembro, ChatsRegistrados } from '@/dominio/agente/tipos';

// ---------------------------------------------------------------- almacen del agente

export interface EstadoModoSinIa {
  activo: boolean;
  motivo: string | null;
  /** true si ya se aviso al grupo en este periodo (el aviso es unico). */
  avisado: boolean;
}

/** Evento de auditoria del agente. NUNCA lleva el texto de los usuarios: solo intencion, motivo y tamanos. */
export interface EventoAgente {
  tipo:
    | 'update_duplicado'
    | 'mensaje_duplicado'
    | 'mensaje_ignorado'
    | 'chat_ajeno'
    | 'boton_no_autorizado'
    | 'sospecha_inyeccion'
    | 'cifra_sin_procedencia'
    | 'modo_sin_ia'
    | 'omar_fuera_de_alcance'
    | 'respuesta_bloqueada'
    | 'limite_frecuencia'
    | 'error_llm'
    | 'validacion_fallida';
  miembro: number | null;
  detalle: string;
}

export interface AlmacenAgente {
  /** INSERT ... ON CONFLICT DO NOTHING por update_id, ANTES de gastar IA. true = es nuevo. */
  reclamarUpdate(updateId: number): Promise<boolean>;
  /** Reclamo por (chat, mensaje). true = es nuevo. Un reenvio con otro update_id no se vuelve a ejecutar. */
  reclamarMensaje(chatId: number, messageId: number): Promise<boolean>;
  miembroPorTelegramId(id: number): Promise<Miembro | null>;
  chats(): Promise<ChatsRegistrados>;
  modoSinIa(): Promise<EstadoModoSinIa>;
  /** Devuelve true si el estado cambio. */
  fijarModoSinIa(activo: boolean, motivo: string | null): Promise<boolean>;
  marcarAvisoSinIa(): Promise<void>;
  /** Resultado guardado de una llamada al modelo (clave = hash de mensaje, version de prompt y rol): nunca se paga dos veces. */
  corrida(clave: string): Promise<unknown | null>;
  guardarCorrida(clave: string, resultado: unknown): Promise<void>;
  contarNoProcesado(): Promise<void>;
  /** Mensajes reclamados en ese chat en los ultimos `segundos` (limite de frecuencia). */
  mensajesRecientes?(chatId: number, segundos: number): Promise<number>;
  registrarEvento(evento: EventoAgente): Promise<void>;
}

// ---------------------------------------------------------------- presupuesto

export interface SolicitudReserva {
  /** Idempotente: la misma clave no reserva dos veces. */
  clave: string;
  rol: RolPresupuesto;
  microUsd: bigint;
  fechaNeg: string;
}

export type ResultadoReserva = { ok: true; avisos: AvisoPresupuesto[] } | { ok: false; motivo: MotivoCorte };

export interface AlmacenPresupuesto {
  /** Reserva el peor caso ANTES de llamar al modelo. Corta al tope. */
  reservar(s: SolicitudReserva): Promise<ResultadoReserva>;
  /** Sustituye la reserva por el costo real que devolvio el proveedor. */
  liquidar(clave: string, costoRealMicroUsd: bigint): Promise<{ avisos: AvisoPresupuesto[] }>;
  /** La llamada fallo antes de gastar: devuelve la reserva. */
  liberar(clave: string): Promise<void>;
}

// ---------------------------------------------------------------- modelo de lenguaje (puerto; OpenRouter detras)

export interface PeticionLlm {
  rol: RolIa;
  /** Slugs en orden fijo: principal y respaldos. */
  modelos: string[];
  sistema: string;
  usuario: string;
  maxTokensSalida: number;
  /** JSON Schema del objeto de salida (modo estricto). */
  esquemaJson: unknown;
}

export interface RespuestaLlm {
  /** Objeto JSON ya parseado; la aplicacion lo valida otra vez con zod. */
  contenido: unknown;
  modeloUsado: string;
  tokensEntrada: number;
  tokensSalida: number;
  /** Costo real que reporta el proveedor, en micro-USD. */
  costoMicroUsd: bigint;
}

export class ErrorLlm extends Error {
  constructor(
    readonly motivo: 'red' | 'tiempo' | 'proveedor' | 'respuesta_invalida' | 'politica',
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorLlm';
  }
}

export interface ClienteLlm {
  extraer(p: PeticionLlm): Promise<RespuestaLlm>;
}

// ---------------------------------------------------------------- Telegram (envio)

export interface BotonEnLinea {
  texto: string;
  /** callback_data <= 64 bytes: es el token de un solo uso. */
  callbackData: string;
}

export interface MensajeSalida {
  chatId: number;
  texto: string;
  botones?: BotonEnLinea[][];
  respondeA?: number;
  /** protect_content en mensajes financieros. */
  protegido?: boolean;
  /** Sin sonido (horario silencioso). */
  silencioso?: boolean;
}

export interface EnviadorTelegram {
  enviar(m: MensajeSalida): Promise<{ messageId: number }>;
  /** Sin `botones` se retira el teclado. */
  editar(chatId: number, messageId: number, texto: string, botones?: BotonEnLinea[][]): Promise<void>;
  responderCallback(callbackId: string, texto: string | null, alerta: boolean): Promise<void>;
  salirDelChat(chatId: number): Promise<void>;
}

// ---------------------------------------------------------------- botones de un solo uso

export type AccionBoton =
  | 'deshacer'
  | 'deshacer_expreso'
  | 'autorizar_toma'
  | 'rechazar_toma'
  | 'aclarar'
  | 'confirmar_accion'
  | 'confirmar_resumen'
  | 'confirmar_refuerzo'
  | 'completar'
  | 'cancelar'
  | 'otro';

export interface NuevoToken {
  accion: AccionBoton;
  rolesPermitidos: readonly RolMiembro[];
  chatId: number;
  caducaEn: Date;
  /** Los botones de un mismo grupo se invalidan entre si (Autorizar y Rechazar). */
  grupoExclusivo: string | null;
  payload: unknown;
}

export type ResultadoConsumo =
  | { estado: 'ok'; accion: AccionBoton; payload: unknown }
  | { estado: 'no_autorizado' }
  | { estado: 'chat_distinto' }
  | { estado: 'caducado' }
  | { estado: 'usado' }
  | { estado: 'invalido' };

export interface AlmacenTokens {
  /** Devuelve el callback_data (<= 64 bytes). */
  emitir(t: NuevoToken): Promise<string>;
  /**
   * Orden de validacion: (1) rol del que pulsa; (2) chat registrado del token; (3) caducidad; (4) un solo uso.
   * Un pulsador no autorizado NO consume el token.
   */
  consumir(entrada: { token: string; rol: RolMiembro; chatId: number; ahora: Date }): Promise<ResultadoConsumo>;
}

// ---------------------------------------------------------------- catalogo (solo lectura) y negocio (lo que calcula el servidor)

export interface CatalogoAgente {
  clientes(): Promise<EntradaCatalogo[]>;
  modelos(): Promise<EntradaCatalogo[]>;
  /** Sabores EN EXISTENCIA de un modelo. */
  saboresEnExistencia(modeloId: string): Promise<EntradaCatalogo[]>;
}

/** Ids resueltos por el codigo para una intencion de escritura. */
export interface Resoluciones {
  clienteId: string | null;
  proveedorId: IdProveedor | null;
  /** Una entrada por linea de la intencion (en el mismo orden). */
  lineas: Array<{ modeloId: string; saborId: string | null }>;
  /** Para consultas: id de modelo ya resuelto. */
  modeloId: string | null;
  /** Lote historico: cliente resuelto por posicion de renglon. */
  clientesLote?: Record<string, string>;
}

export interface AccionResuelta {
  intencion: Intencion;
  resoluciones: Resoluciones;
}

export interface ContextoEjecucion {
  autor: Miembro;
  /** Idempotencia: la misma clave aplica una sola vez. */
  claveIdem: string;
  origen: { updateId: number; chatId: number; messageId: number };
  ahora: Date;
  /** El socio ya contesto "si" a la pregunta del servidor (precio fuera de tabulador, etc.). */
  confirmado: boolean;
}

export type MotivoPreguntaNegocio =
  | 'precio_fuera_tabulador'
  | 'bajo_costo'
  | 'existencia_insuficiente'
  | 'menos_de_20_piezas'
  | 'modelo_fuera_de_catalogo'
  | 'monto_parecido_a_saldo'
  | 'baja_confianza'
  | 'falta_destino'
  | 'otro';

export interface ResultadoEjecutado {
  tipo: 'ejecutado';
  folio: string;
  titulo: string;
  lineas: CifraServidor[];
  comprobacion: CifraServidor[];
  saldos: CifraServidor[];
  advertencias: string[];
  ejecutadoEn: Date;
  /** true si la clave de idempotencia ya estaba aplicada: se devuelve el mismo resultado sin duplicar. */
  repetido: boolean;
}

export type ResultadoNegocio =
  | ResultadoEjecutado
  | { tipo: 'pregunta'; motivo: MotivoPreguntaNegocio; texto: string; cifras: CifraServidor[] }
  | { tipo: 'toma_pendiente'; folio: string; titulo: string; lineas: CifraServidor[]; resumen: CifraServidor[] }
  | { tipo: 'rechazado'; codigo: string; texto: string };

export interface RespuestaConsulta {
  titulo: string;
  lineas: CifraServidor[];
}

export interface DependenciasDeFolio {
  cantidad: number;
  descripcion: CifraServidor[];
}

export type ResultadoDeshacer = { tipo: 'deshecho'; folioContra: string; titulo: string; lineas: CifraServidor[]; repetido: boolean } | { tipo: 'rechazado'; codigo: string; texto: string };

export type ResultadoTomaResuelta =
  | { tipo: 'resuelta'; folio: string; estado: 'autorizada' | 'rechazada'; lineas: CifraServidor[]; saldoSemanal: CifraServidor | null; repetido: boolean }
  | { tipo: 'ya_resuelta'; folio: string; estado: string }
  | { tipo: 'no_encontrada' };

export interface TomaCaducada {
  folio: string;
  lineas: CifraServidor[];
}

/** Efecto que calcula el servidor al simular una escritura (se revierte siempre). */
export type ResultadoSimulacion =
  | { tipo: 'simulado'; lineas: CifraServidor[]; advertencias: string[]; cuadra: boolean; rojas: string[] }
  | { tipo: 'pregunta'; motivo: MotivoPreguntaNegocio; texto: string; cifras: CifraServidor[] }
  | { tipo: 'rechazado'; codigo: string; texto: string };

export interface NegocioAgente {
  /** Opcional: el negocio simulado de las pruebas unitarias no lo implementa. */
  simular?(a: AccionResuelta, ctx: ContextoEjecucion): Promise<ResultadoSimulacion>;
  ejecutar(a: AccionResuelta, ctx: ContextoEjecucion): Promise<ResultadoNegocio>;
  consultar(c: IConsulta, r: Resoluciones, autor: Miembro, ahora: Date): Promise<RespuestaConsulta>;
  /** Ultimo hecho aplicado por el autor, o el folio dado. */
  localizarParaDeshacer(autor: Miembro, folio: string | null): Promise<{ folio: string; ejecutadoEn: Date } | null>;
  dependenciasDe(folio: string): Promise<DependenciasDeFolio>;
  deshacer(entrada: { folio: string; autor: Miembro; claveIdem: string }): Promise<ResultadoDeshacer>;
  autorizarToma(entrada: { folio: string; socio: Miembro; autorizar: boolean; claveIdem: string }): Promise<ResultadoTomaResuelta>;
  /** Pendientes con mas de `horas` sin decision: pasan a caducadas y liberan su reserva. */
  caducarTomas(ahora: Date, horas: number): Promise<TomaCaducada[]>;
}
