// Nucleo del agente de Telegram. El modelo propone (JSON de intencion, sin herramientas, sin dinero); el codigo resuelve, calcula,
// ejecuta con clave de idempotencia y responde con eco, comprobacion y Deshacer. Nada llega a una respuesta si no lo entrego el servidor.
//
// Orden de cada update:
//   1. reclamo unico por update_id (antes de gastar IA)   2. identidad por id de Telegram y chat registrado
//   3. reclamo por (chat, mensaje)                        4. comandos (sin IA) o prefiltro + modo sin IA
//   5. reserva de presupuesto -> modelo -> liquidacion    6. esquema estricto + guardia de cifras de entrada
//   7. permisos por rol, resolucion de alias (pregunta ante duda), ejecucion idempotente, eco.
import { cifrasDeMonto, cifrasDePiezas, cifrasSinProcedencia, esMontoAmbiguo, parsearPrecio, valoresDeTexto, type CifraExtraida } from '@/dominio/agente/cifras';
import { parsearComando } from '@/dominio/agente/comandos';
import { VENTANA_DESHACER_MIN, evaluarDeshacer } from '@/dominio/agente/deshacer';
import { debeProcesarConIa, declaraCapitalExpreso, detectarInyeccion, redactarContactos, sanitizar } from '@/dominio/agente/entrada';
import { CATALOGO_INTENCIONES, confirmacionDe } from '@/dominio/agente/catalogo_intenciones';
import { esEscritura, exigeConfirmacion, type IPedidoMenudeo, type Intencion, type RespuestaExtractor, type TipoIntencion } from '@/dominio/agente/intenciones';
import { cadenaParaRol, peorCasoTokens } from '@/dominio/agente/modelos';
import { permisoParaIntencion } from '@/dominio/agente/permisos';
import { ALERTA_PORCENTAJE, type AvisoPresupuesto } from '@/dominio/agente/presupuesto';
import type { Candidato } from '@/dominio/agente/resolutor';
import type { ChatsRegistrados, FuenteMensaje, Miembro, Persona } from '@/dominio/agente/tipos';
import { fechaNeg } from '@/dominio/calendario';
import { dijoSinFecha, interpretarFechaPago, type OpcionFecha } from '@/dominio/agente/fecha_pago';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { Comunicador, verificarMensajeOmar } from './comunicador';
import { esquemaJsonDeRespuesta, validarRespuesta } from './esquemas';
import * as P from './plantillas';
import type { MensajeListo } from './plantillas';
import { MAX_TOKENS_SALIDA_R1, SISTEMA_R1, VERSION_PROMPT, construirUsuarioR1, estimarTokens } from './prompt';
import type {
  AccionBoton,
  AccionResuelta,
  ResultadoNegocio,
  AlmacenAgente,
  AlmacenPresupuesto,
  AlmacenTokens,
  BotonEnLinea,
  CatalogoAgente,
  ClienteLlm,
  ContextoEjecucion,
  EnviadorTelegram,
  ResultadoSimulacion,
  NegocioAgente,
  RecordatorioMenudeo,
  ResultadoEjecutado,
  RespuestaLlm,
  TipoEspera,
} from './puertos';
import { resolverAccion, type PreguntaAbierta } from './resolucion';
import type { TgCallback, TgMensaje, UpdateTelegram } from './telegram';

export interface ConfigAgente {
  maxPreguntas: number;
  caducaPreguntaHoras: number;
  caducaTomaHoras: number;
  ventanaDeshacerMin: number;
  maxOpciones: number;
  /**
   * Modo de los socios (produccion): todo movimiento de dinero se muestra en un resumen y NO se registra hasta que un socio pulsa Confirmar;
   * si falta un dato (cuenta, quien pago, via, pedido) se pregunta en vez de suponerlo. En false conserva el comportamiento anterior (eco + Deshacer).
   */
  confirmarMovimientos: boolean;
  /** Produccion: un renglon sin sabor se pregunta (la base exige sku). En simulacion sin base se deja en false. */
  exigirSabor: boolean;
  /** Limite de frecuencia por chat: mensajes procesados por minuto (0 = sin limite). */
  limiteMensajesPorMinuto: number;
  /** Minutos que espera el bot la respuesta de una pregunta abierta ("¿cuando pagas?"). */
  caducaEsperaMin: number;
  /** Intentos para entender una fecha antes de soltar la pregunta. */
  maxIntentosFecha: number;
}

export const CONFIG_POR_OMISION: ConfigAgente = {
  maxPreguntas: 3,
  caducaPreguntaHoras: 24,
  caducaTomaHoras: 72,
  ventanaDeshacerMin: VENTANA_DESHACER_MIN,
  maxOpciones: 4,
  confirmarMovimientos: true,
  exigirSabor: false,
  limiteMensajesPorMinuto: 20,
  caducaEsperaMin: 30,
  maxIntentosFecha: 3,
};

export interface DependenciasAgente {
  almacen: AlmacenAgente;
  presupuesto: AlmacenPresupuesto;
  llm: ClienteLlm;
  telegram: EnviadorTelegram;
  tokens: AlmacenTokens;
  catalogo: CatalogoAgente;
  negocio: NegocioAgente;
  reloj: () => Date;
  config?: Partial<ConfigAgente>;
}

export type ResultadoUpdate =
  | { estado: 'duplicado'; motivo: 'update' | 'mensaje' }
  | { estado: 'ignorado'; motivo: string }
  | { estado: 'procesado'; acciones: number }
  | { estado: 'sin_ia' }
  | { estado: 'boton'; resultado: string }
  | { estado: 'error' };

/** Estado serializable de una accion en curso (viaja en el token de un boton, no en el callback_data). */
interface EstadoAccion {
  intencion: Intencion;
  overrides: Record<string, string>;
  preguntasPrevias: number;
  claveIdem: string;
  origen: { updateId: number; chatId: number; messageId: number };
  autor: Miembro;
  confirmado: boolean;
  /** Un socio ya pulso Confirmar en el resumen del movimiento (distinto de `confirmado`, que contesta preguntas del negocio). */
  vistoBueno: boolean;
  confirmadoPor: Persona | null;
  /** Confirmacion reforzada (acciones que no se deshacen por Telegram): el segundo "si, estoy seguro". */
  refuerzo: boolean;
  /** Hash del efecto que mostro la vista previa al socio (la base aborta si el efecto real cambio). */
  efectoHash: string | null;
  /** Boton "Si, estoy seguro" que consumio el autor (la base lo exige para la firma del acta). */
  tokenConfirmacion: string | null;
  cita: string;
}

/**
 * POLITICA DE QUIEN CONFIRMA (MEDIO-2).
 *  - Por omision, el AUTOR de la indicacion confirma lo suyo (Confirmar, "Si, continuar" y "Si, estoy seguro"). Si el otro socio pulsa, no se registra nada
 *    y se vuelve a mostrar la tarjeta; el otro socio puede cancelar, completar un dato faltante o elegir una opcion de aclaracion, pero no confirmar.
 *  - Un segundo socio NO es obligatorio, salvo en las acciones listadas aqui: el segundo paso ("Si, estoy seguro") lo da el OTRO socio.
 *  - La firma del acta es personal: solo la da quien la pide (acta_firma), con su propio boton.
 */
export const SEGUNDO_SOCIO_OBLIGATORIO: ReadonlySet<TipoIntencion> = new Set<TipoIntencion>(['lote_historico']);

interface PayloadAclarar {
  estado: EstadoAccion;
  clave: string;
  opcionId: string;
  opcionNombre: string;
}

interface PayloadDeshacer {
  folio: string;
  ejecutadoEn: string;
  claveIdem: string;
}

interface PayloadPago {
  reporteId: number;
  folio: string;
  reportadoPor: Persona;
  /** Banderas que devolvio la base (los centavos como texto: el payload viaja como JSON). */
  datos: { reporte_id: number; aplicado: boolean; pendiente_cent: string | null; comprobante_telegram: boolean };
  monto: string | null;
}

interface PayloadFecha {
  estado: EstadoAccion;
  base: EstadoAccion;
  texto: string;
  intentos: number;
}

interface PayloadReprogramar {
  pedidoId: number;
  folio: string;
  intentos?: number;
}

interface PayloadReprogramarConfirma {
  pedidoId: number;
  folio: string;
  fecha: string;
  hora: string | null;
  autor: Miembro;
  base: PayloadReprogramar;
  texto: string;
}

type FilaRecordatorio = RecordatorioMenudeo & { tipo: 'por_vencer' | 'vence_hoy' | 'vencido' };

interface PayloadRecordatorio {
  fila: Omit<FilaRecordatorio, 'pendienteCent'> & { pendienteCent: string };
}

/** Movimientos que cambian la aportacion neta de un socio: despues de ellos el bot comenta la igualacion. */
export function esMovimientoDeAportacion(i: Intencion): boolean {
  switch (i.tipo) {
    case 'aportacion':
    case 'reembolso_socio':
    case 'retiro_utilidad':
      return true;
    case 'pago_proveedor':
      // Dinero propio de un socio que paga a un proveedor (no el de la sociedad ni el pago de un cliente directo al proveedor).
      return i.pagado_por !== 'sociedad' && i.cliente_texto === null;
    case 'pago': {
      const cuenta = normalizar(i.cuenta_destino_texto ?? '');
      return cuenta === 'angelo' || cuenta === 'javier';
    }
    case 'lote_historico':
      return i.renglones.some((r) => r.tipo === 'aportacion' || r.tipo === 'reembolso' || r.tipo === 'retiro' || (r.tipo === 'cobro' && ['angelo', 'javier'].includes(normalizar(r.cuenta_texto ?? ''))));
    default:
      return false;
  }
}

interface ContextoMensaje {
  autor: Miembro;
  chats: ChatsRegistrados;
  texto: string;
  fuente: FuenteMensaje;
  updateId: number;
  messageId: number;
  chatId: number;
  /** Las cifras vienen del modelo: exigen procedencia en el mensaje. Los comandos no (son tecleadas por el socio). */
  verificarCifras: boolean;
  sospecha: boolean;
}

const MENSAJE_MONTO_AMBIGUO = 'el monto sin ambiguedad: con coma para los miles y punto para los centavos (un punto seguido de tres cifras puede leerse de dos maneras)';
const MSG_ERROR = 'No pude procesar ese mensaje. Intentalo de nuevo o usa los comandos.';

function cifrasDeIntencion(a: Intencion): CifraExtraida[] {
  const salida: CifraExtraida[] = [];
  switch (a.tipo) {
    case 'pedido':
      a.lineas.forEach((l, i) => salida.push(cifrasDePiezas(`lineas.${i}.piezas`, l.piezas)));
      if (a.envio_cobrado_centavos !== null && a.envio_cobrado_centavos > 0) salida.push(cifrasDeMonto('envio', a.envio_cobrado_centavos));
      break;
    case 'pago':
    case 'pago_proveedor':
    case 'gasto':
    case 'aportacion':
    case 'reembolso_socio':
    case 'retiro_utilidad':
      salida.push(cifrasDeMonto('monto', a.monto_centavos));
      break;
    case 'devolucion':
    case 'compra_recepcion':
    case 'conteo':
    case 'pedido_menudeo':
      a.lineas.forEach((l, i) => salida.push(cifrasDePiezas(`lineas.${i}.piezas`, l.piezas)));
      break;
    case 'merma':
      salida.push(cifrasDePiezas('piezas', a.piezas));
      break;
    case 'pago_pedido_menudeo':
      if (a.monto_centavos !== null) salida.push(cifrasDeMonto('monto', a.monto_centavos));
      break;
    case 'gasto_servicio':
      if (a.monto_usd_centavos !== null) salida.push(cifrasDeMonto('monto_usd', a.monto_usd_centavos));
      if (a.monto_mxn_centavos !== null) salida.push(cifrasDeMonto('monto_mxn', a.monto_mxn_centavos));
      break;
    case 'cliente_precio':
      salida.push(cifrasDeMonto('precio', a.precio_centavos));
      break;
    case 'acta_propuesta':
      for (const [k, v] of Object.entries(a)) if (k.endsWith('_centavos') && typeof v === 'number') salida.push(cifrasDeMonto(k, v));
      break;
    case 'lote_historico':
      a.renglones.forEach((r, i) => salida.push(cifrasDeMonto(`renglones.${i}.monto`, r.monto_centavos)));
      if (a.total_dictado_centavos !== null) salida.push(cifrasDeMonto('total', a.total_dictado_centavos));
      break;
    case 'compra':
    case 'orden_compra':
    case 'toma_omar':
      a.lineas.forEach((l, i) => salida.push(cifrasDePiezas(`lineas.${i}.piezas`, l.piezas)));
      if (a.tipo === 'compra' && a.guia_centavos !== null && a.guia_centavos > 0) salida.push(cifrasDeMonto('guia', a.guia_centavos));
      break;
    default:
      break;
  }
  return salida;
}

function cifrasDePrecios(a: Intencion, fuente: string): string[] {
  if (a.tipo !== 'pedido') return [];
  const enFuente = valoresDeTexto(fuente);
  const faltan: string[] = [];
  a.lineas.forEach((l, i) => {
    if (l.precio_texto === null) return;
    const valores = valoresDeTexto(l.precio_texto);
    if (valores.size === 0 || [...valores].every((v) => !enFuente.has(v))) faltan.push(`lineas.${i}.precio`);
  });
  return faltan;
}

/** Dato que la base necesita y el mensaje no trajo. Se pregunta; jamas se supone un valor por omision. */
export function datoFaltante(a: Intencion): string | null {
  switch (a.tipo) {
    case 'pedido':
      return a.lineas.some((l) => l.precio_texto !== null && parsearPrecio(l.precio_texto).ok === false)
        ? 'el precio de cada renglon sin ambiguedad: con coma para los miles y punto para los centavos (un punto seguido de tres cifras puede leerse de dos maneras)'
        : null;
    case 'pago':
      return a.cuenta_destino_texto === null ? 'a que cuenta entro el pago (Angelo, Javier, Isaac, Karen o efectivo)' : null;
    case 'gasto':
      return a.pagado_por === 'sociedad' ? 'quien pago el gasto, Angelo o Javier' : null;
    case 'reembolso_socio':
    case 'retiro_utilidad':
      return a.via === null ? 'si fue por transferencia o en efectivo' : null;
    case 'devolucion':
      return a.pedido_folio === null ? 'de que pedido es la devolucion (folio)' : null;
    case 'paquete_perdido':
      return a.pedido_folio === null ? 'de que pedido es el paquete (folio)' : null;
    case 'pedido_envio':
      return a.pedido_folio === null ? 'el folio del pedido (por ejemplo P-0001)' : null;
    case 'pedido_cancelar':
      return a.pedido_folio === null ? 'el folio del pedido (por ejemplo P-0001)' : a.motivo === null ? 'el motivo de la cancelacion' : null;
    case 'compra_aprobar':
    case 'compra_estado':
    case 'compra_recepcion':
      return a.compra_folio === null ? 'el folio de la compra (por ejemplo C-0001)' : null;
    case 'merma':
      return a.motivo === null ? 'el motivo de la merma' : null;
    case 'gasto_servicio':
      return a.monto_usd_centavos === null && a.monto_mxn_centavos === null ? 'el monto del cargo (en dolares o en pesos)' : a.pagado_por === 'sociedad' ? 'quien pago el servicio, Angelo o Javier' : null;
    case 'pago_pedido_menudeo':
      return a.pedido_folio === null ? 'el folio del pedido (por ejemplo P-0001)' : a.monto_centavos === null ? 'el monto del pago' : a.via === null ? 'si pagaste directo al proveedor o como abono a la sociedad' : null;
    case 'lote_historico':
      return a.renglones.some((r) => (r.tipo !== 'cobro' && r.socio === null) || (r.tipo === 'cobro' && (r.cliente_texto === null || r.cuenta_texto === null)) || ((r.tipo === 'reembolso' || r.tipo === 'retiro') && r.via === null))
        ? 'en cada renglon: socio (o cliente y cuenta en un cobro) y via en reembolsos y retiros'
        : null;
    default:
      return null;
  }
}

interface OpcionFaltante {
  texto: string;
  parche: (a: Intencion) => Intencion;
}

/** Datos que se piden con botones (estado de conversacion en el token, con expiracion). El resto se pide por texto. */
export function opcionesFaltante(a: Intencion): OpcionFaltante[] | null {
  if (a.tipo === 'pago' && a.cuenta_destino_texto === null) {
    return ['Angelo', 'Javier', 'Isaac', 'Karen', 'Efectivo'].map((c) => ({ texto: c, parche: (x) => (x.tipo === 'pago' ? { ...x, cuenta_destino_texto: c } : x) }));
  }
  if ((a.tipo === 'gasto' || a.tipo === 'gasto_servicio') && a.pagado_por === 'sociedad') {
    return (['angelo', 'javier'] as const).map((q) => ({ texto: q === 'angelo' ? 'Angelo' : 'Javier', parche: (x) => (x.tipo === 'gasto' || x.tipo === 'gasto_servicio' ? { ...x, pagado_por: q } : x) }));
  }
  if ((a.tipo === 'reembolso_socio' || a.tipo === 'retiro_utilidad') && a.via === null) {
    return (['transferencia', 'efectivo'] as const).map((v) => ({ texto: v === 'efectivo' ? 'Efectivo' : 'Transferencia', parche: (x) => (x.tipo === 'reembolso_socio' || x.tipo === 'retiro_utilidad' ? { ...x, via: v } : x) }));
  }
  if (a.tipo === 'pago_pedido_menudeo' && a.pedido_folio !== null && a.monto_centavos !== null && a.via === null) {
    return ([['proveedor', 'Directo al proveedor'], ['sociedad', 'Abono a la sociedad']] as const).map(([v, texto]) => ({ texto, parche: (x) => (x.tipo === 'pago_pedido_menudeo' ? { ...x, via: v } : x) }));
  }
  return null;
}

/** BAJO-4: el capital lo declara cada socio por si mismo; un socio no lo registra a nombre del otro. */
export function capitalAjeno(a: Intencion, autor: Persona): boolean {
  if (a.tipo === 'aportacion') return a.intencion === 'capital' && a.socio !== autor;
  if (a.tipo === 'pago_proveedor') return a.intencion === 'capital' && a.pagado_por !== 'sociedad' && a.pagado_por !== autor;
  if (a.tipo === 'lote_historico') return a.renglones.some((r) => r.tipo === 'aportacion' && r.intencion === 'capital' && r.socio !== autor);
  return false;
}

/** La frase aparece en el mensaje del socio (sin acentos ni mayusculas): evita que el modelo invente la fecha o la referencia. */
export function contieneTexto(fuente: string, frase: string): boolean {
  const f = normalizar(frase);
  return f !== '' && normalizar(fuente).includes(f);
}

export class AgenteTelegram {
  private readonly cfg: ConfigAgente;
  private readonly com: Comunicador;

  constructor(private readonly d: DependenciasAgente) {
    this.cfg = { ...CONFIG_POR_OMISION, ...d.config };
    this.com = new Comunicador(d.telegram, d.almacen);
  }

  // ------------------------------------------------------------------ entrada

  async procesarUpdate(update: UpdateTelegram): Promise<ResultadoUpdate> {
    // Reclamo unico ANTES de cualquier IA: el mismo update (reintento de Telegram) se aplica una sola vez.
    if (!(await this.d.almacen.reclamarUpdate(update.update_id))) {
      await this.d.almacen.registrarEvento({ tipo: 'update_duplicado', miembro: null, detalle: 'update_id repetido' });
      return { estado: 'duplicado', motivo: 'update' };
    }
    try {
      return update.callback_query ? await this.boton(update.callback_query) : await this.mensaje(update);
    } catch {
      await this.d.almacen.registrarEvento({ tipo: 'validacion_fallida', miembro: null, detalle: 'error_inesperado' });
      try {
        await this.com.aGrupo(await this.d.almacen.chats(), P.textoSimple(MSG_ERROR));
      } catch {
        // Telegram tambien esta caido: el fallo ya quedo registrado y el webhook responde 200.
      }
      return { estado: 'error' };
    }
  }

  /**
   * Cola de solicitudes de la vista web de Omar: pasa por el MISMO negocio y publica la MISMA tarjeta de autorizacion en el grupo de socios
   * que una toma escrita por Telegram. La idempotencia por `claveIdem` la garantiza el negocio; el llamador no reenvia la tarjeta si ya existia.
   */
  async solicitarTomaDesdeWeb(a: AccionResuelta, autor: Miembro, claveIdem: string): Promise<ResultadoNegocio> {
    const r = await this.d.negocio.ejecutar(a, { autor, claveIdem, origen: { updateId: 0, chatId: 0, messageId: 0 }, ahora: this.d.reloj(), confirmado: false });
    if (r.tipo === 'toma_pendiente') await this.publicarTomaPendiente(r, await this.d.almacen.chats(), autor);
    return r;
  }

  private async publicarTomaPendiente(r: Extract<ResultadoNegocio, { tipo: 'toma_pendiente' }>, chats: ChatsRegistrados, autor: Miembro): Promise<void> {
    const exclusivo = `toma:${r.folio}`;
    const caduca = this.mas(this.cfg.caducaTomaHoras * 3_600_000);
    const aut = await this.boton1('Autorizar', 'autorizar_toma', ['socio'], chats.grupoSocios, caduca, exclusivo, { folio: r.folio });
    const rec = await this.boton1('Rechazar', 'rechazar_toma', ['socio'], chats.grupoSocios, caduca, exclusivo, { folio: r.folio });
    await this.com.aGrupo(chats, P.tarjetaToma(r.folio, r.titulo, r.lineas, r.resumen, autor), { botones: [[aut, rec]] });
    await this.com.aOmar(chats, P.omarRecibido(r.folio, r.lineas));
  }

  /** Cron: las tomas sin decision pasan a caducadas, se libera su reserva y se avisa al grupo y a Omar. */
  async caducarTomasVencidas(): Promise<string[]> {
    const caducadas = await this.d.negocio.caducarTomas(this.d.reloj(), this.cfg.caducaTomaHoras);
    const chats = await this.d.almacen.chats();
    for (const t of caducadas) {
      await this.com.aGrupo(chats, P.tomaCaducadaGrupo(t.folio));
      await this.com.aOmar(chats, P.omarCaducado(t.folio));
    }
    return caducadas.map((t) => t.folio);
  }

  // ------------------------------------------------------------------ mensajes

  private async mensaje(update: UpdateTelegram): Promise<ResultadoUpdate> {
    const esEdicion = update.message === undefined && update.edited_message !== undefined;
    const msg = update.message ?? update.edited_message;
    if (!msg?.from) return { estado: 'ignorado', motivo: 'sin_remitente' };

    const chats = await this.d.almacen.chats();
    const miembro = await this.d.almacen.miembroPorTelegramId(msg.from.id);
    const autor = await this.autorizar(msg, miembro, chats);
    if (!autor) return { estado: 'ignorado', motivo: 'no_autorizado' };

    // El reclamo por (chat, mensaje) va ANTES del limite de frecuencia: un mensaje rechazado por frecuencia queda reclamado, y su edicion posterior no se procesa como nuevo.
    if (!(await this.d.almacen.reclamarMensaje(msg.chat.id, msg.message_id))) {
      await this.d.almacen.registrarEvento({ tipo: 'mensaje_duplicado', miembro: autor.telegramUserId, detalle: esEdicion ? 'edicion' : 'reenvio' });
      if (esEdicion) {
        await this.responder(autor, chats, P.textoSimple('Ese mensaje ya se proceso y no se vuelve a ejecutar. Si hay un error, usa /deshacer y mandalo de nuevo.'));
      }
      return { estado: 'duplicado', motivo: 'mensaje' };
    }
    if (this.cfg.limiteMensajesPorMinuto > 0 && this.d.almacen.mensajesRecientes) {
      // El mensaje actual ya cuenta (acaba de reclamarse): el limite es "mas de N por minuto".
      const n = await this.d.almacen.mensajesRecientes(msg.chat.id, 60);
      if (n > this.cfg.limiteMensajesPorMinuto) {
        await this.d.almacen.registrarEvento({ tipo: 'limite_frecuencia', miembro: autor.telegramUserId, detalle: 'chat_con_demasiados_mensajes' });
        await this.responder(autor, chats, P.textoSimple('Demasiados mensajes seguidos. Espera un minuto antes de seguir.'));
        return { estado: 'ignorado', motivo: 'limite_frecuencia' };
      }
    }

    // Comprobante de un socio (foto o archivo): se guarda SOLO su huella y su file_id como evidencia. El bot no lo descarga ni lo lee y la IA nunca lo ve.
    let conComprobante = false;
    if (msg.foto !== undefined && autor.rol === 'socio' && msg.forward_origin === undefined && !esEdicion) {
      try {
        await this.d.almacen.guardarEvidencia({ chatId: msg.chat.id, mensajeId: msg.message_id, telegramUserId: autor.telegramUserId, fileId: msg.foto.fileId, fileUniqueId: msg.foto.fileUniqueId });
        conComprobante = true;
      } catch {
        await this.d.almacen.registrarEvento({ tipo: 'validacion_fallida', miembro: autor.telegramUserId, detalle: 'comprobante_no_guardado' });
      }
    }

    const texto = sanitizar(msg.text ?? msg.caption ?? '');
    if (texto === '') {
      if (conComprobante) {
        await this.responder(autor, chats, P.comprobanteGuardado());
        return { estado: 'procesado', acciones: 0 };
      }
      if (msg.has_photo || msg.has_audio) {
        await this.responder(autor, chats, P.textoSimple('Recibi la foto o el audio, pero queda sin leer. Escribe el dato con /pago o /gasto.'));
        return { estado: 'procesado', acciones: 0 };
      }
      return { estado: 'ignorado', motivo: 'vacio' };
    }

    const base = { autor, chats, texto, updateId: update.update_id, messageId: msg.message_id, chatId: msg.chat.id };
    // Un mensaje reenviado es dato no confiable (puede ser texto ajeno pegado por alguien): sus /comandos no se ejecutan y, mas abajo, solo admite consultas.
    const reenviado = msg.forward_origin !== undefined;
    if (reenviado && texto.startsWith('/')) {
      await this.d.almacen.registrarEvento({ tipo: 'sospecha_inyeccion', miembro: autor.telegramUserId, detalle: 'reenviado_comando' });
      await this.responder(autor, chats, P.textoSimple('Los comandos no se ejecutan desde mensajes reenviados. Escribelo tu con tus palabras.'));
      return { estado: 'ignorado', motivo: 'reenviado_comando' };
    }
    // Pregunta abierta a este socio ("¿cuando pagas?"): su siguiente mensaje de texto la contesta. La fecha la interpreta el CODIGO, nunca la IA.
    if (autor.rol === 'socio' && !reenviado && !esEdicion && !texto.startsWith('/')) {
      const espera = await this.d.almacen.esperaTomar(msg.chat.id, autor.telegramUserId, this.d.reloj());
      if (espera) return this.responderEspera(espera, texto, autor, chats);
    }
    const cmd = parsearComando(texto);
    if (cmd) {
      if (!cmd.ok) {
        await this.responder(autor, chats, P.uso(cmd.uso));
        return { estado: 'procesado', acciones: 0 };
      }
      if (cmd.tipo === 'control') return this.control(autor, chats, cmd.control);
      return this.ejecutarAcciones([cmd.intencion], { ...base, fuente: 'comando', verificarCifras: false, sospecha: false });
    }

    if (!debeProcesarConIa(texto)) {
      await this.d.almacen.contarNoProcesado();
      return { estado: 'ignorado', motivo: 'prefiltro' };
    }

    const sin = await this.d.almacen.modoSinIa();
    if (sin.activo) {
      await this.avisarModoSinIa(chats);
      return { estado: 'sin_ia' };
    }
    return this.conIa({ ...base, fuente: reenviado ? 'reenviado' : 'texto', verificarCifras: true, sospecha: false });
  }

  /** Identidad por id de Telegram. Devuelve el miembro solo si el chat de origen es el que le corresponde. */
  private async autorizar(msg: TgMensaje, miembro: Miembro | null, chats: ChatsRegistrados): Promise<Miembro | null> {
    const esGrupo = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    if (msg.chat.id !== chats.grupoSocios && esGrupo) {
      // El bot abandona cualquier chat de grupo que no sea el registrado.
      await this.d.telegram.salirDelChat(msg.chat.id);
      await this.d.almacen.registrarEvento({ tipo: 'chat_ajeno', miembro: miembro?.telegramUserId ?? null, detalle: 'chat_de_grupo_no_registrado' });
      return null;
    }
    if (!miembro) {
      await this.d.almacen.registrarEvento({ tipo: 'mensaje_ignorado', miembro: null, detalle: 'no_es_miembro' });
      return null;
    }
    if (msg.chat.id === chats.grupoSocios) return miembro.rol === 'socio' ? miembro : null;
    if (msg.chat.type === 'private') {
      if (miembro.rol === 'socio') return miembro;
      if (miembro.rol === 'omar' && msg.chat.id === chats.privadoOmar) return miembro;
    }
    await this.d.almacen.registrarEvento({ tipo: 'chat_ajeno', miembro: miembro.telegramUserId, detalle: 'chat_no_corresponde' });
    return null;
  }

  private async control(autor: Miembro, chats: ChatsRegistrados, control: 'sinia' | 'conia'): Promise<ResultadoUpdate> {
    if (autor.rol !== 'socio') {
      await this.responder(autor, chats, P.omarFueraDeAlcance());
      return { estado: 'ignorado', motivo: 'control_solo_socios' };
    }
    if (control === 'sinia') {
      await this.d.almacen.fijarModoSinIa(true, 'manual');
      await this.avisarModoSinIa(chats);
      return { estado: 'sin_ia' };
    }
    await this.d.almacen.fijarModoSinIa(false, null);
    await this.com.aGrupo(chats, P.textoSimple('Modo con IA reactivado.'));
    return { estado: 'procesado', acciones: 0 };
  }

  private async avisarModoSinIa(chats: ChatsRegistrados): Promise<void> {
    const sin = await this.d.almacen.modoSinIa();
    if (sin.avisado) return;
    await this.com.aGrupo(chats, P.avisoModoSinIa());
    await this.d.almacen.marcarAvisoSinIa();
    await this.d.almacen.registrarEvento({ tipo: 'modo_sin_ia', miembro: null, detalle: sin.motivo ?? 'sin_motivo' });
  }

  // ------------------------------------------------------------------ IA

  private async conIa(ctx: ContextoMensaje): Promise<ResultadoUpdate> {
    const clave = `r1:${ctx.chatId}:${ctx.messageId}:${VERSION_PROMPT}`;
    const r = await this.extraer(clave, ctx);
    if (!r.ok) {
      if (r.motivo === 'presupuesto') {
        await this.d.almacen.fijarModoSinIa(true, 'tope_presupuesto');
        await this.avisarModoSinIa(ctx.chats);
        return { estado: 'sin_ia' };
      }
      await this.responder(ctx.autor, ctx.chats, P.avisoSinIaMensaje());
      return { estado: 'sin_ia' };
    }
    const sospecha = r.valor.sospecha_inyeccion || detectarInyeccion(ctx.texto).length > 0;
    if (sospecha || ctx.fuente === 'reenviado') {
      await this.d.almacen.registrarEvento({ tipo: 'sospecha_inyeccion', miembro: ctx.autor.telegramUserId, detalle: sospecha ? 'patron_o_modelo' : 'reenviado' });
    }
    if (r.valor.baja_certeza && r.valor.acciones.some((a) => esEscritura(a.tipo))) {
      await this.responder(ctx.autor, ctx.chats, P.avisoSinIaMensaje());
      return { estado: 'procesado', acciones: 0 };
    }
    return this.ejecutarAcciones(r.valor.acciones, { ...ctx, sospecha });
  }

  private async extraer(clave: string, ctx: ContextoMensaje): Promise<{ ok: true; valor: RespuestaExtractor } | { ok: false; motivo: 'presupuesto' | 'llm' | 'validacion' }> {
    const guardada = await this.d.almacen.corrida(clave);
    if (guardada !== null) {
      const v = validarRespuesta(guardada);
      if (v.ok) return v;
    }
    const [clientes, modelos] = await Promise.all([this.d.catalogo.clientes(), this.d.catalogo.modelos()]);
    const usuario = construirUsuarioR1({ autor: ctx.autor.persona, fuente: ctx.fuente, texto: ctx.texto, clientes, modelos });
    let errores: string[] = [];
    for (let intento = 0; intento < 2; intento++) {
      const u = intento === 0 ? usuario : `${usuario}\nerrores_de_validacion: ${JSON.stringify(errores)}`;
      const resp = await this.llamar(`${clave}:${intento}`, u, ctx.autor);
      if (resp === 'presupuesto' || resp === 'llm') return { ok: false, motivo: resp };
      const v = validarRespuesta(resp.contenido);
      if (v.ok) {
        await this.d.almacen.guardarCorrida(clave, resp.contenido);
        return v;
      }
      errores = v.errores;
      await this.d.almacen.registrarEvento({ tipo: 'validacion_fallida', miembro: ctx.autor.telegramUserId, detalle: `intento=${intento}` });
    }
    return { ok: false, motivo: 'validacion' };
  }

  /** Reserva el peor caso ANTES de llamar; liquida con el costo real; libera si la llamada falla. */
  private async llamar(claveReserva: string, usuario: string, autor: Miembro): Promise<RespuestaLlm | 'presupuesto' | 'llm'> {
    const cadena = cadenaParaRol('texto');
    const reserva = peorCasoTokens(cadena, estimarTokens(SISTEMA_R1, usuario), MAX_TOKENS_SALIDA_R1);
    const ahora = this.d.reloj();
    const dec = await this.d.presupuesto.reservar({ clave: claveReserva, rol: 'texto', microUsd: reserva, fechaNeg: fechaNeg(ahora) });
    if (!dec.ok) return 'presupuesto';
    await this.avisosPresupuesto(dec.avisos);
    let resp: RespuestaLlm;
    try {
      resp = await this.d.llm.extraer({
        rol: 'texto',
        modelos: cadena.map((m) => m.slug),
        sistema: SISTEMA_R1,
        usuario,
        maxTokensSalida: MAX_TOKENS_SALIDA_R1,
        esquemaJson: esquemaJsonDeRespuesta(),
      });
    } catch {
      await this.d.presupuesto.liberar(claveReserva);
      await this.d.almacen.registrarEvento({ tipo: 'error_llm', miembro: autor.telegramUserId, detalle: 'llamada_fallida' });
      return 'llm';
    }
    const liq = await this.d.presupuesto.liquidar(claveReserva, resp.costoMicroUsd);
    await this.avisosPresupuesto(liq.avisos);
    return resp;
  }

  private async avisosPresupuesto(avisos: readonly AvisoPresupuesto[]): Promise<void> {
    if (avisos.length === 0) return;
    const chats = await this.d.almacen.chats();
    for (const a of avisos) {
      if (a === 'alerta_dia' || a === 'alerta_mes') {
        await this.com.aGrupo(chats, P.alertaPresupuesto(a === 'alerta_dia' ? 'dia' : 'mes', Number(ALERTA_PORCENTAJE)));
      }
    }
  }

  // ------------------------------------------------------------------ acciones

  private async ejecutarAcciones(acciones: readonly Intencion[], ctx: ContextoMensaje): Promise<ResultadoUpdate> {
    let hechas = 0;
    for (let i = 0; i < acciones.length; i++) {
      const a = acciones[i]!;
      if (a.tipo === 'ninguna') continue;
      if (a.tipo === 'aclarar') {
        await this.responder(ctx.autor, ctx.chats, P.aclaracion(a.pregunta, ctx.texto));
        hechas++;
        continue;
      }

      const permiso = permisoParaIntencion(ctx.autor.rol, a);
      if (!permiso.permitido) {
        await this.d.almacen.registrarEvento({ tipo: 'omar_fuera_de_alcance', miembro: ctx.autor.telegramUserId, detalle: a.tipo });
        await this.responder(ctx.autor, ctx.chats, P.omarFueraDeAlcance());
        if (permiso.motivo === 'omar_no_registra') await this.com.aGrupo(ctx.chats, P.avisoOmarAlGrupo(a.tipo));
        continue;
      }

      if (ctx.fuente === 'reenviado' && esEscritura(a.tipo)) {
        await this.d.almacen.registrarEvento({ tipo: 'sospecha_inyeccion', miembro: ctx.autor.telegramUserId, detalle: 'reenviado_escritura' });
        await this.responder(ctx.autor, ctx.chats, P.rechazo('Ese mensaje esta reenviado: por seguridad no registro movimientos desde mensajes reenviados (las consultas si). Escribelo tu con tus palabras.'));
        continue;
      }

      if (ctx.sospecha && esEscritura(a.tipo)) {
        await this.responder(ctx.autor, ctx.chats, P.textoSimple('Marque ese mensaje como sospechoso y no ejecute nada. Reescribelo con tus palabras o usa el comando.'));
        continue;
      }

      // Menudeo: solo el socio de menudeo configurado (por omision Angelo). El autor ya viene verificado por su id de Telegram; la base lo vuelve a exigir.
      if (a.tipo === 'pedido_menudeo' || a.tipo === 'pago_pedido_menudeo') {
        const sm = await this.d.negocio.socioMenudeo();
        if (ctx.autor.persona !== sm) {
          await this.d.almacen.registrarEvento({ tipo: 'menudeo_otro_socio', miembro: ctx.autor.telegramUserId, detalle: a.tipo });
          await this.responder(ctx.autor, ctx.chats, P.soloSocioMenudeo(sm));
          continue;
        }
      }

      if (ctx.verificarCifras) {
        const faltan = [...cifrasSinProcedencia(ctx.texto, cifrasDeIntencion(a)), ...cifrasDePrecios(a, ctx.texto)];
        if (faltan.length > 0) {
          await this.d.almacen.registrarEvento({ tipo: 'cifra_sin_procedencia', miembro: ctx.autor.telegramUserId, detalle: faltan.join(',') });
          await this.responder(ctx.autor, ctx.chats, P.cifraSinProcedencia(ctx.texto.slice(0, 120), faltan));
          continue;
        }
        // BAJO-1: un monto que solo se explica con un formato ambiguo ("1.250") se pregunta en TODAS las intenciones con dinero, no solo en el precio de un pedido.
        const ambiguos = cifrasDeIntencion(a).filter((c) => c.esDinero === true && esMontoAmbiguo(ctx.texto, c.valor)).map((c) => c.campo);
        if (ambiguos.length > 0) {
          await this.d.almacen.registrarEvento({ tipo: 'validacion_fallida', miembro: ctx.autor.telegramUserId, detalle: `monto_ambiguo:${ambiguos.join(',')}`.slice(0, 280) });
          await this.responder(ctx.autor, ctx.chats, P.faltaDato(MENSAJE_MONTO_AMBIGUO));
          continue;
        }
      }

      if (a.tipo === 'lote_historico' && a.total_dictado_centavos !== null) {
        const suma = a.renglones.reduce((t, r) => t + BigInt(r.monto_centavos), 0n);
        if (suma !== BigInt(a.total_dictado_centavos)) {
          await this.responder(ctx.autor, ctx.chats, P.sumaNoCuadra(suma, BigInt(a.total_dictado_centavos)));
          continue;
        }
      }

      // El capital se declara con las palabras del socio: si el modelo lo marco pero el mensaje no lo dice, es reembolso (decision del dueno).
      let declarada = this.capitalSoloSiSeDeclaro(a, ctx);
      if (capitalAjeno(declarada, ctx.autor.persona)) {
        await this.d.almacen.registrarEvento({ tipo: 'validacion_fallida', miembro: ctx.autor.telegramUserId, detalle: 'capital_a_nombre_del_otro' });
        await this.responder(ctx.autor, ctx.chats, P.rechazo('El capital lo declara cada socio por si mismo: que lo registre quien lo pone o lo paga. Si fue un deposito comun, dilo sin declararlo como capital y queda como reembolso.'));
        continue;
      }
      // Las frases de fecha vienen del mensaje del socio (si el modelo las invento, se ignoran) y las interpreta el codigo.
      if (declarada.tipo === 'pedido_menudeo' && declarada.cuando_texto !== null && ctx.verificarCifras && !contieneTexto(ctx.texto, declarada.cuando_texto)) declarada = { ...declarada, cuando_texto: null };
      if (declarada.tipo === 'pago_pedido_menudeo' && declarada.fecha_texto !== null) {
        if (ctx.verificarCifras && !contieneTexto(ctx.texto, declarada.fecha_texto)) declarada = { ...declarada, fecha_texto: null };
        else {
          const f = interpretarFechaPago(declarada.fecha_texto, this.d.reloj(), { direccion: 'pasado' });
          if (f.tipo === 'ok') declarada = { ...declarada, fecha_pago: f.fecha };
          else if (f.tipo === 'ambiguo') declarada = { ...declarada, fecha_pago: f.opciones[0]!.fecha };
          else {
            await this.responder(ctx.autor, ctx.chats, P.fechaNoEntendida(f.tipo === 'futura' ? 'futura' : 'no_entendi'));
            continue;
          }
        }
      }
      const estado: EstadoAccion = {
        intencion: declarada,
        overrides: {},
        preguntasPrevias: 0,
        claveIdem: `tg:${ctx.updateId}:${i}`,
        origen: { updateId: ctx.updateId, chatId: ctx.chatId, messageId: ctx.messageId },
        autor: ctx.autor,
        confirmado: false,
        vistoBueno: false,
        confirmadoPor: null,
        refuerzo: false,
        efectoHash: null,
        tokenConfirmacion: null,
        cita: redactarContactos(ctx.texto).slice(0, 120),
      };
      await this.resolverYEjecutar(estado, ctx.chats);
      hechas++;
    }
    return { estado: 'procesado', acciones: hechas };
  }

  /**
   * El capital se declara con las palabras del socio (decision del dueno): si el modelo lo marco pero el mensaje no lo dice, es reembolso.
   * Aplica al pago a proveedor, a la aportacion y a CADA renglon de aportacion de un lote (la linea del mensaje que lleva su fecha, o el mensaje completo).
   */
  private capitalSoloSiSeDeclaro(a: Intencion, ctx: ContextoMensaje): Intencion {
    if (!ctx.verificarCifras) return a;
    if ((a.tipo === 'pago_proveedor' || a.tipo === 'aportacion') && a.intencion === 'capital' && !declaraCapitalExpreso(ctx.texto)) return { ...a, intencion: 'reembolso' } as Intencion;
    if (a.tipo === 'lote_historico') {
      const lineas = ctx.texto.split('\n');
      return { ...a, renglones: a.renglones.map((r) => {
        if (r.tipo !== 'aportacion' || r.intencion !== 'capital') return r;
        const propias = lineas.filter((l) => l.includes(r.fecha));
        return declaraCapitalExpreso(propias.length > 0 ? propias.join('\n') : ctx.texto) ? r : { ...r, intencion: null };
      }) };
    }
    return a;
  }

  private async resolverYEjecutar(estado: EstadoAccion, chats: ChatsRegistrados): Promise<void> {
    const salida = await resolverAccion(estado.intencion, estado.autor, this.d.catalogo, estado.overrides, this.cfg.exigirSabor);
    if (!salida.ok) {
      await this.preguntar(estado, salida.pregunta, chats);
      return;
    }
    const a = salida.resuelta;
    const intencion = a.intencion;

    // Pedido de menudeo: la fecha comprometida se resuelve ANTES del resumen (frase ya dicha, pregunta o aclaracion con botones), siempre con codigo: la IA no escribe fechas.
    if (intencion.tipo === 'pedido_menudeo' && !estado.vistoBueno) {
      const e2 = await this.completarFechaMenudeo(estado, chats);
      if (e2 === null) return;
      if (e2 !== estado) {
        await this.resolverYEjecutar(e2, chats);
        return;
      }
    }

    if (intencion.tipo === 'consulta') {
      if (intencion.consulta === 'ayuda') {
        await this.responder(estado.autor, chats, P.ayuda());
        return;
      }
      const resp = await this.d.negocio.consultar(intencion, a.resoluciones, estado.autor, this.d.reloj());
      await this.responder(estado.autor, chats, P.consulta(resp));
      return;
    }

    if (intencion.tipo === 'deshacer') {
      const objetivo = await this.d.negocio.localizarParaDeshacer(estado.autor, intencion.folio);
      if (!objetivo) {
        await this.responder(estado.autor, chats, P.textoSimple('No encontre que deshacer.'));
        return;
      }
      await this.iniciarDeshacer(estado.autor, chats, objetivo.folio, objetivo.ejecutadoEn, estado.claveIdem);
      return;
    }

    if (intencion.tipo === 'pedido' && datoFaltante(intencion) !== null) {
      await this.responder(estado.autor, chats, P.faltaDato(datoFaltante(intencion)!));
      return;
    }

    if (this.cfg.confirmarMovimientos && exigeConfirmacion(intencion.tipo) && !estado.vistoBueno) {
      await this.pedirConfirmacion(estado, a, chats);
      return;
    }
    if (this.cfg.confirmarMovimientos && exigeConfirmacion(intencion.tipo) && confirmacionDe(intencion.tipo) === 'reforzada' && !estado.refuerzo) {
      if (intencion.tipo === 'acta_firma' && estado.confirmadoPor !== estado.autor.persona) {
        await this.responder(estado.autor, chats, P.rechazo('La firma del acta es personal: la da quien la pide, desde su propio Telegram. No firme nada.'));
        return;
      }
      await this.pedirRefuerzo(estado, chats);
      return;
    }

    const r = await this.d.negocio.ejecutar(a, {
      autor: estado.autor,
      claveIdem: estado.claveIdem,
      origen: estado.origen,
      ahora: this.d.reloj(),
      confirmado: estado.confirmado,
      efectoHash: estado.efectoHash,
      tokenBoton: estado.tokenConfirmacion,
    });

    switch (r.tipo) {
      case 'ejecutado': {
        if (r.repetido) return; // misma clave: ya se aplico y ya se aviso; no se duplica nada
        const boton = await this.boton1('Deshacer', 'deshacer', ['socio'], chats.grupoSocios, this.mas(this.cfg.ventanaDeshacerMin * 60_000), null, {
          folio: r.folio,
          ejecutadoEn: r.ejecutadoEn.toISOString(),
          claveIdem: `${estado.claveIdem}:deshacer`,
        } satisfies PayloadDeshacer);
        await this.com.aGrupo(chats, P.ecoEjecutado(r, estado.autor, estado.confirmadoPor), { botones: [[boton]] });
        await this.despuesDeEjecutar(intencion, r, estado, chats);
        return;
      }
      case 'pregunta': {
        const si = await this.boton1('Si, continuar', 'confirmar_accion', ['socio'], chats.grupoSocios, this.mas(this.cfg.caducaPreguntaHoras * 3_600_000), `conf:${estado.claveIdem}`, { ...estado, confirmado: true } satisfies EstadoAccion);
        const no = await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, this.mas(this.cfg.caducaPreguntaHoras * 3_600_000), `conf:${estado.claveIdem}`, null);
        await this.com.aGrupo(chats, P.preguntaNegocio(r.texto, r.cifras), { botones: [[si, no]] });
        return;
      }
      case 'toma_pendiente':
        await this.publicarTomaPendiente(r, chats, estado.autor);
        return;
      case 'rechazado':
        await this.responder(estado.autor, chats, P.rechazo(r.texto));
        return;
    }
  }

  // ------------------------------------------------------------------ despues de registrar: igualacion y tarjetas de menudeo

  private async despuesDeEjecutar(intencion: Intencion, r: ResultadoEjecutado, estado: EstadoAccion, chats: ChatsRegistrados): Promise<void> {
    if (intencion.tipo === 'pago_pedido_menudeo' && r.datos !== undefined) {
      try {
        await this.publicarPagoReportado(r.datos, { folio: intencion.pedido_folio ?? r.folio, reportadoPor: estado.autor.persona, monto: intencion.monto_centavos === null ? null : BigInt(intencion.monto_centavos) }, chats);
      } catch {
        await this.d.almacen.registrarEvento({ tipo: 'recordatorio_error', miembro: estado.autor.telegramUserId, detalle: 'tarjeta_pago_reportado' });
      }
    }
    if (esMovimientoDeAportacion(intencion)) await this.comentarIgualacion(chats);
  }

  /**
   * Despues de CUALQUIER aportacion, pago de un socio a un proveedor con dinero propio, reembolso, cobro en cuenta de socio o retiro, el bot comenta en el grupo quien lleva mas
   * aportado y a quien le toca el siguiente pago ("Aportaciones igualadas" si lo estan). Todo sale de la base (agente.igualacion); si la lectura falla, el movimiento ya registrado no se afecta.
   */
  private async comentarIgualacion(chats: ChatsRegistrados): Promise<void> {
    try {
      await this.com.aGrupo(chats, P.comentarioIgualacion(await this.d.negocio.igualacion()));
    } catch {
      await this.d.almacen.registrarEvento({ tipo: 'recordatorio_error', miembro: null, detalle: 'igualacion_no_disponible' });
    }
  }

  /** Tarjeta para el OTRO socio: confirma recibido o rechaza el pago reportado (botones de un solo uso; nadie confirma lo suyo). */
  private async publicarPagoReportado(datos: Record<string, unknown>, e: { folio: string; reportadoPor: Persona; monto: bigint | null }, chats: ChatsRegistrados): Promise<void> {
    if (datos.reporte_id === undefined) return;
    const reporteId = Number(datos.reporte_id);
    const aplicado = datos.aplicado === true;
    const caduca = this.mas(this.cfg.caducaTomaHoras * 3_600_000);
    const exclusivo = `pago:${reporteId}`;
    const payload: PayloadPago = { reporteId, folio: e.folio, reportadoPor: e.reportadoPor, datos: { reporte_id: reporteId, aplicado, pendiente_cent: datos.pendiente_cent === undefined ? null : String(datos.pendiente_cent), comprobante_telegram: datos.comprobante_telegram === true }, monto: e.monto === null ? null : e.monto.toString() };
    const botones: BotonEnLinea[] = [];
    if (!aplicado) botones.push(await this.boton1('Confirmar recibido', 'confirmar_pago', ['socio'], chats.grupoSocios, caduca, exclusivo, payload));
    botones.push(await this.boton1('Rechazar', 'rechazar_pago', ['socio'], chats.grupoSocios, caduca, exclusivo, payload));
    await this.com.aGrupo(chats, P.tarjetaPagoReportado({ folio: e.folio, reportadoPor: e.reportadoPor, monto: e.monto, aplicado, pendiente: datos.pendiente_cent === undefined ? null : BigInt(datos.pendiente_cent as number | string), conComprobante: datos.comprobante_telegram === true }), { botones: [botones] });
  }

  // ------------------------------------------------------------------ menudeo: fecha comprometida (siempre con codigo)

  private async completarFechaMenudeo(estado: EstadoAccion, chats: ChatsRegistrados): Promise<EstadoAccion | null> {
    const i = estado.intencion as IPedidoMenudeo;
    if ((i.fecha_compromiso ?? null) !== null || i.sin_fecha === true) return estado;
    if (i.cuando_texto === null) {
      await this.abrirPregunta(estado.autor, 'fecha_pago', { estado, intentos: 0 }, chats, P.preguntaCuandoPagas());
      return null;
    }
    if (dijoSinFecha(i.cuando_texto)) return { ...estado, intencion: { ...i, sin_fecha: true } };
    return this.aplicarFechaPedido(estado, i.cuando_texto, 0, chats);
  }

  private async abrirPregunta(autor: Miembro, tipo: TipoEspera, payload: Record<string, unknown>, chats: ChatsRegistrados, mensaje: MensajeListo): Promise<void> {
    await this.com.aGrupo(chats, mensaje);
    await this.d.almacen.esperaAbrir({ chatId: chats.grupoSocios, telegramUserId: autor.telegramUserId, tipo, payload, caducaEn: this.mas(this.cfg.caducaEsperaMin * 60_000) });
  }

  /** Interpreta la frase con codigo. ok = sigue con la fecha; ambiguo = botones; pasada o ilegible = vuelve a preguntar (maximo `maxIntentosFecha` veces). */
  private async aplicarFechaPedido(estado: EstadoAccion, texto: string, intentos: number, chats: ChatsRegistrados): Promise<EstadoAccion | null> {
    const i = estado.intencion as IPedidoMenudeo;
    const r = interpretarFechaPago(texto, this.d.reloj());
    if (r.tipo === 'ok') return { ...estado, intencion: { ...i, fecha_compromiso: r.fecha, hora_compromiso: r.hora } };
    if (r.tipo === 'ambiguo') {
      const caduca = this.mas(this.cfg.caducaPreguntaHoras * 3_600_000);
      const exclusivo = `fec:${estado.claveIdem}:${intentos}`;
      const botones: BotonEnLinea[][] = [];
      for (const o of r.opciones) {
        botones.push([await this.boton1(P.textoOpcionFecha(o), 'fecha_opcion', ['socio'], chats.grupoSocios, caduca, exclusivo, { estado: { ...estado, intencion: { ...i, fecha_compromiso: o.fecha, hora_compromiso: o.hora } }, base: estado, texto, intentos } satisfies PayloadFecha)]);
      }
      botones.push([await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, caduca, exclusivo, null)]);
      await this.com.aGrupo(chats, P.fechaAmbigua(r.motivo), { botones });
      return null;
    }
    if (intentos + 1 >= this.cfg.maxIntentosFecha) {
      await this.responder(estado.autor, chats, P.rechazo('No pude entender la fecha de pago. No registre nada: cuando la tengas, mandalo de nuevo (por ejemplo /pedidomenudeo karen | modelo/sabor 24 | cuando el viernes).'));
      return null;
    }
    await this.abrirPregunta(estado.autor, 'fecha_pago', { estado: { ...estado, intencion: { ...i, cuando_texto: null } }, intentos: intentos + 1 }, chats, P.fechaNoEntendida(r.tipo === 'pasada' ? 'pasada' : 'no_entendi'));
    return null;
  }

  /** Respuesta de un socio a una pregunta abierta. */
  private async responderEspera(espera: { tipo: TipoEspera; payload: unknown }, texto: string, autor: Miembro, chats: ChatsRegistrados): Promise<ResultadoUpdate> {
    if (espera.tipo === 'fecha_pago') {
      const p = espera.payload as { estado?: EstadoAccion; intentos?: number };
      if (!p.estado) return { estado: 'ignorado', motivo: 'espera_invalida' };
      const i = p.estado.intencion as IPedidoMenudeo;
      const sig = dijoSinFecha(texto) ? { ...p.estado, intencion: { ...i, sin_fecha: true } } : await this.aplicarFechaPedido(p.estado, texto, p.intentos ?? 0, chats);
      if (sig) await this.resolverYEjecutar(sig, chats);
      return { estado: 'procesado', acciones: 1 };
    }
    const p = espera.payload as PayloadReprogramar;
    await this.proponerReprogramacion(autor, p, texto, chats);
    return { estado: 'procesado', acciones: 1 };
  }

  /** Reprogramar un compromiso de pago: la fecha la interpreta el codigo y se confirma con botones antes de tocar la base. */
  private async proponerReprogramacion(autor: Miembro, p: PayloadReprogramar, texto: string, chats: ChatsRegistrados): Promise<void> {
    const intentos = p.intentos ?? 0;
    const r = interpretarFechaPago(texto, this.d.reloj());
    const caduca = this.mas(this.cfg.caducaPreguntaHoras * 3_600_000);
    const exclusivo = `rep:${p.pedidoId}:${intentos}`;
    const pedirConfirmar = async (o: OpcionFecha, etiqueta: string): Promise<BotonEnLinea> =>
      this.boton1(etiqueta, 'confirmar_reprogramar', ['socio'], chats.grupoSocios, caduca, exclusivo, { pedidoId: p.pedidoId, folio: p.folio, fecha: o.fecha, hora: o.hora, autor, base: p, texto } satisfies PayloadReprogramarConfirma);
    const no = (): Promise<BotonEnLinea> => this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, caduca, exclusivo, null);
    if (r.tipo === 'ok') {
      await this.com.aGrupo(chats, P.confirmarReprogramacion(p.folio, r.fecha, r.hora), { botones: [[await pedirConfirmar(r, 'Sí, reprogramar'), await no()]] });
      return;
    }
    if (r.tipo === 'ambiguo') {
      const botones: BotonEnLinea[][] = [];
      for (const o of r.opciones) botones.push([await pedirConfirmar(o, P.textoOpcionFecha(o))]);
      botones.push([await no()]);
      await this.com.aGrupo(chats, P.fechaAmbigua(r.motivo), { botones });
      return;
    }
    if (intentos + 1 >= this.cfg.maxIntentosFecha) {
      await this.responder(autor, chats, P.rechazo('No pude entender la fecha. No reprograme nada: pulsa Reprogramar en el recordatorio cuando la tengas.'));
      return;
    }
    await this.abrirPregunta(autor, 'fecha_reprogramar', { ...p, intentos: intentos + 1 }, chats, P.fechaNoEntendida(r.tipo === 'pasada' ? 'pasada' : 'no_entendi'));
  }

  // ------------------------------------------------------------------ recordatorios de pago de menudeo (los manda el latido, solo al GRUPO de socios)

  /**
   * Tarea del latido. Con el interruptor `telegram_envio` APAGADO no envia ni reclama nada (los avisos siguen pendientes para cuando se encienda).
   * Cada aviso se reclama en la base ANTES de enviarse (idempotente por pedido y hora): dos latidos o un reintento no duplican. Solo se escribe al grupo de los dos socios.
   */
  async enviarRecordatoriosMenudeo(): Promise<{ estado: 'omitido' | 'ok'; enviados: number; motivo?: string }> {
    if (!(await this.d.negocio.envioActivo())) return { estado: 'omitido', enviados: 0, motivo: 'interruptor telegram_envio apagado' };
    const chats = await this.d.almacen.chats();
    if (chats.grupoSocios === 0) return { estado: 'omitido', enviados: 0, motivo: 'sin grupo de socios registrado' };
    const ahora = this.d.reloj();
    let enviados = 0;
    for (const f of await this.d.negocio.recordatoriosMenudeo(ahora)) {
      // Sin fecha: alerta de pantalla, no de chat. Con un pago ya reportado el socio ya hizo su parte: espera al otro.
      if (f.tipo === 'sin_fecha' || f.pagoReportado) continue;
      try {
        if (!(await this.d.negocio.reclamarRecordatorio(f.pedidoId, f.tipo, ahora))) continue;
        await this.publicarRecordatorio(f as FilaRecordatorio, chats);
        enviados++;
      } catch {
        await this.d.almacen.registrarEvento({ tipo: 'recordatorio_error', miembro: null, detalle: `pedido=${f.pedidoId} tipo=${f.tipo}`.slice(0, 280) });
      }
    }
    return { estado: 'ok', enviados };
  }

  private async publicarRecordatorio(f: FilaRecordatorio, chats: ChatsRegistrados): Promise<void> {
    let botones: BotonEnLinea[][] | undefined;
    if (f.tipo !== 'por_vencer') {
      const caduca = this.mas(this.cfg.caducaTomaHoras * 3_600_000);
      const exclusivo = `rec:${f.pedidoId}:${Math.floor(this.d.reloj().getTime() / 3_600_000)}`;
      const payload: PayloadRecordatorio = { fila: { ...f, pendienteCent: f.pendienteCent.toString() } };
      botones = [[await this.boton1('Pagado', 'recordatorio_pagado', ['socio'], chats.grupoSocios, caduca, exclusivo, payload), await this.boton1('Reprogramar', 'recordatorio_reprogramar', ['socio'], chats.grupoSocios, caduca, exclusivo, payload)]];
    }
    await this.com.aGrupo(chats, P.recordatorioPago(f), botones ? { botones } : {});
  }

  // ------------------------------------------------------------------ resumen y confirmacion explicita

  /** Muestra el resumen del movimiento y espera el Confirmar de un socio. Nada se registra antes. Si falta un dato, pregunta. */
  private async pedirConfirmacion(estado: EstadoAccion, a: AccionResuelta, chats: ChatsRegistrados): Promise<void> {
    const falta = datoFaltante(a.intencion);
    if (falta !== null) {
      const opciones = opcionesFaltante(a.intencion);
      if (opciones === null) {
        await this.responder(estado.autor, chats, P.faltaDato(falta));
        return;
      }
      // Estado de conversacion: las opciones viajan en tokens de un solo uso con expiracion; al elegir una se completa la accion y sigue el resumen.
      const caduca = this.mas(this.cfg.caducaPreguntaHoras * 3_600_000);
      const exclusivo = `falta:${estado.claveIdem}`;
      const botones: BotonEnLinea[][] = [];
      for (const o of opciones) {
        botones.push([await this.boton1(o.texto, 'completar', ['socio'], chats.grupoSocios, caduca, exclusivo, { ...estado, intencion: o.parche(a.intencion) } satisfies EstadoAccion)]);
      }
      botones.push([await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, caduca, exclusivo, null)]);
      await this.com.aGrupo(chats, P.faltaDatoConOpciones(falta), { botones });
      return;
    }
    if (a.intencion.tipo === 'acta_firma' && estado.confirmadoPor !== null && estado.confirmadoPor !== estado.autor.persona) {
      await this.responder(estado.autor, chats, P.rechazo('La firma del acta es personal: la da quien la pide, desde su propio Telegram. No firme nada.'));
      return;
    }
    const ctx: ContextoEjecucion = { autor: estado.autor, claveIdem: estado.claveIdem, origen: estado.origen, ahora: this.d.reloj(), confirmado: estado.confirmado };
    let efecto: Extract<ResultadoSimulacion, { tipo: 'simulado' }> | null = null;
    if (this.d.negocio.simular) {
      const sim = await this.d.negocio.simular(a, ctx);
      if (sim.tipo === 'rechazado') {
        await this.responder(estado.autor, chats, P.rechazo(sim.texto));
        return;
      }
      if (sim.tipo === 'pregunta') {
        const si = await this.boton1('Si, continuar', 'confirmar_accion', ['socio'], chats.grupoSocios, this.mas(this.cfg.caducaPreguntaHoras * 3_600_000), `conf:${estado.claveIdem}`, { ...estado, confirmado: true } satisfies EstadoAccion);
        const no = await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, this.mas(this.cfg.caducaPreguntaHoras * 3_600_000), `conf:${estado.claveIdem}`, null);
        await this.com.aGrupo(chats, P.preguntaNegocio(sim.texto, sim.cifras), { botones: [[si, no]] });
        return;
      }
      efecto = sim;
    }
    const [clientes, modelos] = await Promise.all([this.d.catalogo.clientes(), this.d.catalogo.modelos()]);
    const nombreDe = (lista: readonly { id: string; nombre: string }[], id: string | null): string | null => (id === null ? null : (lista.find((x) => x.id === id)?.nombre ?? null));
    const lineas = a.resoluciones.lineas.map((l) => nombreDe(modelos, l.modeloId) ?? 'modelo');
    const horas = this.cfg.caducaPreguntaHoras;
    const caduca = this.mas(horas * 3_600_000);
    const exclusivo = `res:${estado.claveIdem}`;
    // El hash del efecto que se le muestra viaja en el boton: si al ejecutar el efecto real es otro, la base aborta.
    const si = await this.boton1('Confirmar', 'confirmar_resumen', ['socio'], chats.grupoSocios, caduca, exclusivo, { ...estado, vistoBueno: true, efectoHash: efecto?.efectoHash ?? null } satisfies EstadoAccion);
    const no = await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, caduca, exclusivo, null);
    const clientesLote = a.resoluciones.clientesLote;
    await this.com.aGrupo(
      chats,
      P.resumenConfirmacion(a.intencion, {
        autor: estado.autor,
        cliente: nombreDe(clientes, a.resoluciones.clienteId),
        proveedor: a.resoluciones.proveedorId,
        lineas,
        horas,
        efecto,
        reversa: CATALOGO_INTENCIONES[a.intencion.tipo].reversa,
        reforzada: confirmacionDe(a.intencion.tipo) === 'reforzada',
        modelo: nombreDe(modelos, a.resoluciones.modeloId),
        clientesLote: clientesLote === undefined ? null : Object.fromEntries(Object.entries(clientesLote).map(([k, v]) => [k, nombreDe(clientes, v) ?? 'cliente'])),
      }),
      { botones: [[si, no]] },
    );
  }

  /** Segundo paso de las acciones que no se deshacen por Telegram: dice con todas sus letras que es irreversible y pide otro si. */
  private async pedirRefuerzo(estado: EstadoAccion, chats: ChatsRegistrados): Promise<void> {
    const reversa = CATALOGO_INTENCIONES[estado.intencion.tipo].reversa;
    const caduca = this.mas(this.cfg.caducaPreguntaHoras * 3_600_000);
    const exclusivo = `ref:${estado.claveIdem}`;
    const si = await this.boton1('Si, estoy seguro', 'confirmar_refuerzo', ['socio'], chats.grupoSocios, caduca, exclusivo, { ...estado, refuerzo: true } satisfies EstadoAccion);
    const no = await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, caduca, exclusivo, null);
    await this.com.aGrupo(chats, P.refuerzo(estado.intencion.tipo, reversa), { botones: [[si, no]] });
  }

  // ------------------------------------------------------------------ preguntas de aclaracion

  private async preguntar(estado: EstadoAccion, p: PreguntaAbierta, chats: ChatsRegistrados): Promise<void> {
    if (estado.preguntasPrevias >= this.cfg.maxPreguntas) {
      await this.responder(estado.autor, chats, P.textoSimple('Ya hice demasiadas preguntas seguidas. Empieza de nuevo con un comando.'));
      return;
    }
    const candidatos: Candidato[] = (p.tipo === 'elegir' ? p.candidatos : p.sugerencias).slice(0, this.cfg.maxOpciones);
    const mensaje =
      p.tipo === 'elegir'
        ? P.preguntaResolucion({ campo: p.campo, textoUsuario: p.textoUsuario, cita: estado.cita })
        : P.preguntaNoEncontrado({ campo: p.campo, textoUsuario: p.textoUsuario, cita: estado.cita, sugerencias: candidatos.map((c) => c.nombre) });
    const chatId = estado.autor.rol === 'omar' ? chats.privadoOmar : chats.grupoSocios;
    const roles = [estado.autor.rol] as const;
    const caduca = this.mas(this.cfg.caducaPreguntaHoras * 3_600_000);
    const exclusivo = `q:${estado.claveIdem}:${p.clave}:${estado.preguntasPrevias}`;
    const botones: BotonEnLinea[][] = [];
    for (const c of candidatos) {
      const payload: PayloadAclarar = {
        estado: { ...estado, preguntasPrevias: estado.preguntasPrevias + 1 },
        clave: p.clave,
        opcionId: c.id,
        opcionNombre: c.nombre,
      };
      botones.push([await this.boton1(c.nombre, 'aclarar', roles, chatId, caduca, exclusivo, payload)]);
    }
    botones.push([
      await this.boton1('Otro', 'otro', roles, chatId, caduca, exclusivo, null),
      await this.boton1('Cancelar', 'cancelar', roles, chatId, caduca, exclusivo, null),
    ]);
    if (estado.autor.rol === 'omar') {
      await this.enviarConBotonesAOmar(chats, mensaje, botones);
    } else {
      await this.com.aGrupo(chats, mensaje, { botones });
    }
  }

  private async enviarConBotonesAOmar(chats: ChatsRegistrados, m: MensajeListo, botones: BotonEnLinea[][]): Promise<void> {
    // Los botones de Omar solo los puede pulsar Omar (token con rol omar). El texto pasa por la lista negra.
    try {
      const texto = verificarMensajeOmar(m);
      await this.d.telegram.enviar({ chatId: chats.privadoOmar, texto, botones });
    } catch {
      await this.d.almacen.registrarEvento({ tipo: 'respuesta_bloqueada', miembro: null, detalle: 'pregunta_a_omar' });
      await this.com.aOmar(chats, P.omarFueraDeAlcance());
    }
  }

  // ------------------------------------------------------------------ botones

  private async boton(cb: TgCallback): Promise<ResultadoUpdate> {
    const miembro = await this.d.almacen.miembroPorTelegramId(cb.from.id);
    if (!miembro || cb.data === undefined || cb.message === undefined) {
      await this.d.telegram.responderCallback(cb.id, 'No autorizado.', true);
      await this.d.almacen.registrarEvento({ tipo: 'boton_no_autorizado', miembro: miembro?.telegramUserId ?? null, detalle: 'sin_miembro_o_datos' });
      return { estado: 'boton', resultado: 'no_autorizado' };
    }
    const chatId = cb.message.chat.id;
    const messageId = cb.message.message_id;
    const chats = await this.d.almacen.chats();
    const res = await this.d.tokens.consumir({ token: cb.data, rol: miembro.rol, chatId, ahora: this.d.reloj(), usuarioId: miembro.telegramUserId });

    if (res.estado !== 'ok') {
      const textos: Record<typeof res.estado, string> = {
        no_autorizado: 'Esta tarjeta es de los socios.',
        chat_distinto: 'Esta tarjeta no es de este chat.',
        caducado: 'Esta tarjeta caduco.',
        usado: 'Esta tarjeta ya se uso.',
        invalido: 'Tarjeta invalida.',
      };
      await this.d.telegram.responderCallback(cb.id, textos[res.estado], true);
      if (res.estado === 'no_autorizado') {
        await this.d.almacen.registrarEvento({ tipo: 'boton_no_autorizado', miembro: miembro.telegramUserId, detalle: 'rol_sin_permiso' });
      }
      return { estado: 'boton', resultado: res.estado };
    }

    await this.d.telegram.responderCallback(cb.id, 'Listo.', false);
    await this.accionDeBoton(res.accion, res.payload, { miembro, chats, chatId, messageId, callbackId: cb.id, token: cb.data });
    return { estado: 'boton', resultado: res.accion };
  }

  private async accionDeBoton(
    accion: AccionBoton,
    payload: unknown,
    ctx: { miembro: Miembro; chats: ChatsRegistrados; chatId: number; messageId: number; callbackId: string; token: string },
  ): Promise<void> {
    const { miembro, chats } = ctx;
    switch (accion) {
      case 'cancelar':
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Cancelado.'));
        return;
      case 'otro':
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Escribe el nombre completo en un mensaje nuevo.'));
        return;
      case 'aclarar': {
        const p = payload as PayloadAclarar;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.rechazo(`Elegido: ${p.opcionNombre}`));
        await this.resolverYEjecutar({ ...p.estado, overrides: { ...p.estado.overrides, [p.clave]: p.opcionId } }, chats);
        return;
      }
      case 'confirmar_resumen': {
        const e = payload as EstadoAccion;
        if (!(await this.confirmaQuienDebe(e, miembro, chats, ctx, 'resumen'))) return;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple(`Confirmado por ${P.nombrePersona(miembro.persona)}. Registrando.`));
        await this.resolverYEjecutar({ ...e, vistoBueno: true, confirmadoPor: miembro.persona }, chats);
        return;
      }
      case 'confirmar_refuerzo': {
        const e = payload as EstadoAccion;
        if (!(await this.confirmaQuienDebe(e, miembro, chats, ctx, 'refuerzo'))) return;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple(`Confirmado de nuevo por ${P.nombrePersona(miembro.persona)}. Registrando.`));
        await this.resolverYEjecutar({ ...e, refuerzo: true, confirmadoPor: miembro.persona, tokenConfirmacion: ctx.token }, chats);
        return;
      }
      case 'completar': {
        const e = payload as EstadoAccion;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Dato completado.'));
        await this.resolverYEjecutar(e, chats);
        return;
      }
      case 'confirmar_accion': {
        const e = payload as EstadoAccion;
        if (!(await this.confirmaQuienDebe(e, miembro, chats, ctx, 'pregunta'))) return;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Confirmado.'));
        await this.resolverYEjecutar({ ...e, confirmado: true }, chats);
        return;
      }
      case 'deshacer': {
        const p = payload as PayloadDeshacer;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.rechazo(`Deshacer solicitado para ${p.folio}`));
        await this.iniciarDeshacer(miembro, chats, p.folio, new Date(p.ejecutadoEn), `tg:cb:${ctx.callbackId}`);
        return;
      }
      case 'deshacer_expreso': {
        const p = payload as PayloadDeshacer;
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.rechazo(`Deshacer expreso de ${p.folio}`));
        await this.aplicarDeshacer(miembro, chats, p.folio, p.claveIdem);
        return;
      }
      case 'fecha_opcion': {
        const p = payload as PayloadFecha;
        // La fecha de un pedido la elige quien lo pidio; si pulsa el otro socio no se registra nada y se vuelven a mostrar las opciones.
        if (miembro.persona !== p.estado.autor.persona) {
          await this.d.almacen.registrarEvento({ tipo: 'boton_no_autorizado', miembro: miembro.telegramUserId, detalle: 'fecha_la_elige_el_autor' });
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Esa tarjeta no la puede contestar quien la pulso.'));
          await this.responder(miembro, chats, P.rechazo(`Lo pidio ${P.nombrePersona(p.estado.autor.persona)}: el elige la fecha. Te muestro las opciones otra vez.`));
          await this.aplicarFechaPedido(p.base, p.texto, p.intentos, chats);
          return;
        }
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Fecha elegida.'));
        await this.resolverYEjecutar(p.estado, chats);
        return;
      }
      case 'confirmar_reprogramar': {
        const p = payload as PayloadReprogramarConfirma;
        const sm = await this.d.negocio.socioMenudeo();
        if (miembro.persona !== p.autor.persona || miembro.persona !== sm) {
          await this.d.almacen.registrarEvento({ tipo: 'menudeo_otro_socio', miembro: miembro.telegramUserId, detalle: 'reprogramar' });
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Esa tarjeta no la puede contestar quien la pulso.'));
          await this.responder(miembro, chats, P.soloSocioMenudeo(sm));
          await this.proponerReprogramacion(p.autor, p.base, p.texto, chats);
          return;
        }
        const r = await this.d.negocio.responderRecordatorio({ autor: miembro, claveIdem: `tg:cb:${ctx.callbackId}`, pedidoId: p.pedidoId, accion: 'posponer', fecha: p.fecha, hora: p.hora, motivo: 'Reprogramado desde Telegram a peticion del socio de menudeo' });
        await this.com.editar(chats, ctx.chatId, ctx.messageId, r.tipo === 'ejecutado' ? P.ecoRespuestaRecordatorio({ folio: p.folio, accion: 'posponer', fecha: p.fecha, hora: p.hora }) : P.rechazo(r.tipo === 'rechazado' ? r.texto : 'No pude reprogramar.'));
        return;
      }
      case 'recordatorio_pagado':
      case 'recordatorio_reprogramar': {
        const f = (payload as PayloadRecordatorio).fila;
        const fila: FilaRecordatorio = { ...f, pendienteCent: BigInt(f.pendienteCent) };
        const sm = await this.d.negocio.socioMenudeo();
        if (miembro.persona !== sm) {
          // Solo el socio de menudeo responde por sus pedidos; si pulsa el otro, la tarjeta vuelve.
          await this.d.almacen.registrarEvento({ tipo: 'menudeo_otro_socio', miembro: miembro.telegramUserId, detalle: accion });
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Esa tarjeta no la puede contestar quien la pulso.'));
          await this.responder(miembro, chats, P.soloSocioMenudeo(sm));
          await this.publicarRecordatorio(fila, chats);
          return;
        }
        if (accion === 'recordatorio_reprogramar') {
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Reprogramar: dime la nueva fecha.'));
          await this.abrirPregunta(miembro, 'fecha_reprogramar', { pedidoId: fila.pedidoId, folio: fila.folio, intentos: 0 } satisfies PayloadReprogramar, chats, P.preguntaCuandoReprogramas(fila.folio));
          return;
        }
        const r = await this.d.negocio.responderRecordatorio({ autor: miembro, claveIdem: `tg:cb:${ctx.callbackId}`, pedidoId: fila.pedidoId, accion: 'pagado' });
        if (r.tipo !== 'ejecutado') {
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.rechazo(r.tipo === 'rechazado' ? r.texto : 'No pude registrar el aviso de pago.'));
          return;
        }
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.ecoRespuestaRecordatorio({ folio: fila.folio, accion: 'pagado' }));
        if (!r.repetido && r.datos !== undefined) await this.publicarPagoReportado(r.datos, { folio: fila.folio, reportadoPor: miembro.persona, monto: null }, chats);
        return;
      }
      case 'confirmar_pago':
      case 'rechazar_pago': {
        const p = payload as PayloadPago;
        // Lo confirma o rechaza el OTRO socio: quien lo reporto no se confirma a si mismo (la base tambien lo exige). Si pulsa el, la tarjeta vuelve.
        if (miembro.persona === p.reportadoPor) {
          await this.d.almacen.registrarEvento({ tipo: 'boton_no_autorizado', miembro: miembro.telegramUserId, detalle: 'pago_lo_decide_el_otro_socio' });
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Esa tarjeta no la puede contestar quien la pulso.'));
          await this.responder(miembro, chats, P.rechazo('Lo reportaste tu: lo confirma o rechaza el otro socio. Le mando la tarjeta otra vez.'));
          await this.publicarPagoReportado(p.datos, { folio: p.folio, reportadoPor: p.reportadoPor, monto: p.monto === null ? null : BigInt(p.monto) }, chats);
          return;
        }
        const confirmar = accion === 'confirmar_pago';
        const r = await this.d.negocio.decidirPagoMenudeo({ autor: miembro, claveIdem: `tg:cb:${ctx.callbackId}`, reporteId: p.reporteId, decision: confirmar ? 'confirmado' : 'rechazado', ...(confirmar ? {} : { motivo: 'Rechazado desde Telegram por el otro socio (sin motivo detallado)' }) });
        if (r.tipo !== 'ejecutado') {
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.rechazo(r.tipo === 'rechazado' ? r.texto : 'No pude registrar la decision.'));
          return;
        }
        const pendiente = r.datos?.pendiente_cent === undefined ? null : BigInt(r.datos.pendiente_cent as number | string);
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.ecoDecisionPago({ folio: p.folio, decision: confirmar ? 'confirmado' : 'rechazado', por: miembro.persona, pendiente }));
        return;
      }
      case 'autorizar_toma':
      case 'rechazar_toma': {
        const { folio } = payload as { folio: string };
        const autorizar = accion === 'autorizar_toma';
        const r = await this.d.negocio.autorizarToma({ folio, socio: miembro, autorizar, claveIdem: `tg:cb:${ctx.callbackId}` });
        if (r.tipo === 'no_encontrada') {
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('No encontre esa toma.'));
          return;
        }
        if (r.tipo === 'ya_resuelta') {
          await this.com.editar(chats, ctx.chatId, ctx.messageId, P.rechazo(`La toma ${r.folio} ya estaba ${r.estado}.`));
          return;
        }
        await this.com.editar(chats, ctx.chatId, ctx.messageId, P.tarjetaTomaResuelta(r.folio, r.estado, miembro));
        if (!r.repetido) {
          await this.com.aOmar(chats, r.estado === 'autorizada' ? P.omarAutorizado(r.folio, r.saldoSemanal) : P.omarRechazado(r.folio));
        }
        return;
      }
    }
  }

  /**
   * Aplica SEGUNDO_SOCIO_OBLIGATORIO y "el autor confirma lo suyo". Si quien pulso no es quien debe, no se registra nada y se vuelve a mostrar la tarjeta
   * del mismo paso (el boton pulsado ya se gasto), asi que el socio correcto puede confirmar con una tarjeta nueva.
   */
  private async confirmaQuienDebe(
    e: EstadoAccion,
    miembro: Miembro,
    chats: ChatsRegistrados,
    ctx: { chatId: number; messageId: number },
    paso: 'resumen' | 'refuerzo' | 'pregunta',
  ): Promise<boolean> {
    if (e.autor.rol !== 'socio') return true;
    const otroSocio = paso === 'refuerzo' && SEGUNDO_SOCIO_OBLIGATORIO.has(e.intencion.tipo);
    const esAutor = miembro.persona === e.autor.persona;
    if (otroSocio ? !esAutor : esAutor) return true;
    await this.d.almacen.registrarEvento({ tipo: 'boton_no_autorizado', miembro: miembro.telegramUserId, detalle: otroSocio ? 'refuerzo_requiere_otro_socio' : 'confirma_el_autor' });
    await this.com.editar(chats, ctx.chatId, ctx.messageId, P.textoSimple('Esa tarjeta no la puede confirmar quien la pulso.'));
    await this.responder(
      miembro,
      chats,
      P.rechazo(otroSocio ? `Este movimiento lo debe confirmar el otro socio, no ${P.nombrePersona(e.autor.persona)}.` : `Lo pidio ${P.nombrePersona(e.autor.persona)}: lo confirma el. Te mando la tarjeta otra vez.`),
    );
    // Se reinicia el paso: la tarjeta nueva la confirma quien corresponde.
    if (paso === 'resumen') await this.resolverYEjecutar({ ...e, vistoBueno: false, efectoHash: null }, chats);
    else if (paso === 'refuerzo') await this.resolverYEjecutar({ ...e, refuerzo: false }, chats);
    else await this.resolverYEjecutar({ ...e, confirmado: false }, chats);
    return false;
  }

  // ------------------------------------------------------------------ deshacer

  private async iniciarDeshacer(autor: Miembro, chats: ChatsRegistrados, folio: string, ejecutadoEn: Date, claveIdem: string): Promise<void> {
    const deps = await this.d.negocio.dependenciasDe(folio);
    const dec = evaluarDeshacer({ ejecutadoEn, ahora: this.d.reloj(), dependencias: deps.cantidad });
    if (dec.modo === 'un_toque') {
      await this.aplicarDeshacer(autor, chats, folio, claveIdem);
      return;
    }
    const motivo = dec.motivo === 'dependencias' ? `El folio ${folio} tiene dependencias:` : `Pasaron mas de ${VENTANA_DESHACER_MIN} minutos desde ${folio}.`;
    const si = await this.boton1('Deshacer de todos modos', 'deshacer_expreso', ['socio'], chats.grupoSocios, this.mas(this.cfg.ventanaDeshacerMin * 60_000), `dx:${folio}`, {
      folio,
      ejecutadoEn: ejecutadoEn.toISOString(),
      claveIdem: `${claveIdem}:expreso`,
    } satisfies PayloadDeshacer);
    const no = await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, this.mas(this.cfg.ventanaDeshacerMin * 60_000), `dx:${folio}`, null);
    await this.com.aGrupo(chats, P.preguntaNegocio(motivo, deps.descripcion), { botones: [[si, no]] });
  }

  private async aplicarDeshacer(autor: Miembro, chats: ChatsRegistrados, folio: string, claveIdem: string): Promise<void> {
    const r = await this.d.negocio.deshacer({ folio, autor, claveIdem });
    if (r.tipo === 'rechazado') {
      await this.com.aGrupo(chats, P.rechazo(r.texto));
      return;
    }
    if (r.repetido) return;
    await this.com.aGrupo(chats, P.ecoDeshecho(r.titulo, r.folioContra, r.lineas));
  }

  // ------------------------------------------------------------------ utilidades

  private mas(ms: number): Date {
    return new Date(this.d.reloj().getTime() + ms);
  }

  private async boton1(
    texto: string,
    accion: AccionBoton,
    roles: readonly ('socio' | 'omar')[],
    chatId: number,
    caducaEn: Date,
    grupoExclusivo: string | null,
    payload: unknown,
  ): Promise<BotonEnLinea> {
    const callbackData = await this.d.tokens.emitir({ accion, rolesPermitidos: roles, chatId, caducaEn, grupoExclusivo, payload });
    return { texto, callbackData };
  }

  /** Socios: siempre al grupo. Omar: solo a su chat privado, con la lista blanca. */
  private async responder(autor: Miembro, chats: ChatsRegistrados, m: MensajeListo): Promise<void> {
    if (autor.rol === 'omar') await this.com.aOmar(chats, m);
    else await this.com.aGrupo(chats, m);
  }
}
