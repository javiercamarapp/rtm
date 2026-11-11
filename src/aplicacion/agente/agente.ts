// Nucleo del agente de Telegram. El modelo propone (JSON de intencion, sin herramientas, sin dinero); el codigo resuelve, calcula,
// ejecuta con clave de idempotencia y responde con eco, comprobacion y Deshacer. Nada llega a una respuesta si no lo entrego el servidor.
//
// Orden de cada update:
//   1. reclamo unico por update_id (antes de gastar IA)   2. identidad por id de Telegram y chat registrado
//   3. reclamo por (chat, mensaje)                        4. comandos (sin IA) o prefiltro + modo sin IA
//   5. reserva de presupuesto -> modelo -> liquidacion    6. esquema estricto + guardia de cifras de entrada
//   7. permisos por rol, resolucion de alias (pregunta ante duda), ejecucion idempotente, eco.
import { cifrasDeMonto, cifrasDePiezas, cifrasSinProcedencia, valoresDeTexto, type CifraExtraida } from '@/dominio/agente/cifras';
import { parsearComando } from '@/dominio/agente/comandos';
import { VENTANA_DESHACER_MIN, evaluarDeshacer } from '@/dominio/agente/deshacer';
import { debeProcesarConIa, detectarInyeccion, sanitizar } from '@/dominio/agente/entrada';
import { esEscritura, type Intencion, type RespuestaExtractor } from '@/dominio/agente/intenciones';
import { cadenaParaRol, peorCasoTokens } from '@/dominio/agente/modelos';
import { permisoParaIntencion } from '@/dominio/agente/permisos';
import { ALERTA_PORCENTAJE, type AvisoPresupuesto } from '@/dominio/agente/presupuesto';
import type { Candidato } from '@/dominio/agente/resolutor';
import type { ChatsRegistrados, FuenteMensaje, Miembro } from '@/dominio/agente/tipos';
import { fechaNeg } from '@/dominio/calendario';
import { Comunicador, verificarMensajeOmar } from './comunicador';
import { esquemaJsonDeRespuesta, validarRespuesta } from './esquemas';
import * as P from './plantillas';
import type { MensajeListo } from './plantillas';
import { MAX_TOKENS_SALIDA_R1, SISTEMA_R1, VERSION_PROMPT, construirUsuarioR1, estimarTokens } from './prompt';
import type {
  AccionBoton,
  AlmacenAgente,
  AlmacenPresupuesto,
  AlmacenTokens,
  BotonEnLinea,
  CatalogoAgente,
  ClienteLlm,
  EnviadorTelegram,
  NegocioAgente,
  RespuestaLlm,
} from './puertos';
import { resolverAccion, type PreguntaAbierta } from './resolucion';
import type { TgCallback, TgMensaje, UpdateTelegram } from './telegram';

export interface ConfigAgente {
  maxPreguntas: number;
  caducaPreguntaHoras: number;
  caducaTomaHoras: number;
  ventanaDeshacerMin: number;
  maxOpciones: number;
}

export const CONFIG_POR_OMISION: ConfigAgente = {
  maxPreguntas: 3,
  caducaPreguntaHoras: 24,
  caducaTomaHoras: 72,
  ventanaDeshacerMin: VENTANA_DESHACER_MIN,
  maxOpciones: 4,
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
  cita: string;
}

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
      salida.push(cifrasDeMonto('monto', a.monto_centavos));
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
      const chats = await this.d.almacen.chats();
      await this.com.aGrupo(chats, P.textoSimple(MSG_ERROR));
      return { estado: 'error' };
    }
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

    if (!(await this.d.almacen.reclamarMensaje(msg.chat.id, msg.message_id))) {
      await this.d.almacen.registrarEvento({ tipo: 'mensaje_duplicado', miembro: autor.telegramUserId, detalle: esEdicion ? 'edicion' : 'reenvio' });
      if (esEdicion) {
        await this.responder(autor, chats, P.textoSimple('Ese mensaje ya se proceso y no se vuelve a ejecutar. Si hay un error, usa /deshacer y mandalo de nuevo.'));
      }
      return { estado: 'duplicado', motivo: 'mensaje' };
    }

    const texto = sanitizar(msg.text ?? msg.caption ?? '');
    if (texto === '') {
      if (msg.has_photo || msg.has_audio) {
        await this.responder(autor, chats, P.textoSimple('Recibi la foto o el audio, pero queda sin leer. Escribe el dato con /pago o /gasto.'));
        return { estado: 'procesado', acciones: 0 };
      }
      return { estado: 'ignorado', motivo: 'vacio' };
    }

    const base = { autor, chats, texto, updateId: update.update_id, messageId: msg.message_id, chatId: msg.chat.id };
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
    return this.conIa({ ...base, fuente: msg.forward_origin === undefined ? 'texto' : 'reenviado', verificarCifras: true, sospecha: false });
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

      if (ctx.sospecha && esEscritura(a.tipo)) {
        await this.responder(ctx.autor, ctx.chats, P.textoSimple('Marque ese mensaje como sospechoso y no ejecute nada. Reescribelo con tus palabras o usa el comando.'));
        continue;
      }

      if (ctx.verificarCifras) {
        const faltan = [...cifrasSinProcedencia(ctx.texto, cifrasDeIntencion(a)), ...cifrasDePrecios(a, ctx.texto)];
        if (faltan.length > 0) {
          await this.d.almacen.registrarEvento({ tipo: 'cifra_sin_procedencia', miembro: ctx.autor.telegramUserId, detalle: faltan.join(',') });
          await this.responder(ctx.autor, ctx.chats, P.cifraSinProcedencia(ctx.texto.slice(0, 120), faltan));
          continue;
        }
      }

      const estado: EstadoAccion = {
        intencion: a,
        overrides: {},
        preguntasPrevias: 0,
        claveIdem: `tg:${ctx.updateId}:${i}`,
        origen: { updateId: ctx.updateId, chatId: ctx.chatId, messageId: ctx.messageId },
        autor: ctx.autor,
        confirmado: false,
        cita: ctx.texto.slice(0, 120),
      };
      await this.resolverYEjecutar(estado, ctx.chats);
      hechas++;
    }
    return { estado: 'procesado', acciones: hechas };
  }

  private async resolverYEjecutar(estado: EstadoAccion, chats: ChatsRegistrados): Promise<void> {
    const salida = await resolverAccion(estado.intencion, estado.autor, this.d.catalogo, estado.overrides);
    if (!salida.ok) {
      await this.preguntar(estado, salida.pregunta, chats);
      return;
    }
    const a = salida.resuelta;
    const intencion = a.intencion;

    if (intencion.tipo === 'consulta') {
      if (intencion.consulta === 'ayuda') {
        await this.responder(estado.autor, chats, P.ayuda());
        return;
      }
      const resp = await this.d.negocio.consultar(intencion, a.resoluciones, estado.autor);
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

    const r = await this.d.negocio.ejecutar(a, {
      autor: estado.autor,
      claveIdem: estado.claveIdem,
      origen: estado.origen,
      ahora: this.d.reloj(),
      confirmado: estado.confirmado,
    });

    switch (r.tipo) {
      case 'ejecutado': {
        if (r.repetido) return; // misma clave: ya se aplico y ya se aviso; no se duplica nada
        const boton = await this.boton1('Deshacer', 'deshacer', ['socio'], chats.grupoSocios, this.mas(this.cfg.ventanaDeshacerMin * 60_000), null, {
          folio: r.folio,
          ejecutadoEn: r.ejecutadoEn.toISOString(),
          claveIdem: `${estado.claveIdem}:deshacer`,
        } satisfies PayloadDeshacer);
        await this.com.aGrupo(chats, P.ecoEjecutado(r, estado.autor), { botones: [[boton]] });
        return;
      }
      case 'pregunta': {
        const si = await this.boton1('Si, continuar', 'confirmar_accion', ['socio'], chats.grupoSocios, this.mas(this.cfg.caducaPreguntaHoras * 3_600_000), `conf:${estado.claveIdem}`, { ...estado, confirmado: true } satisfies EstadoAccion);
        const no = await this.boton1('Cancelar', 'cancelar', ['socio'], chats.grupoSocios, this.mas(this.cfg.caducaPreguntaHoras * 3_600_000), `conf:${estado.claveIdem}`, null);
        await this.com.aGrupo(chats, P.preguntaNegocio(r.texto, r.cifras), { botones: [[si, no]] });
        return;
      }
      case 'toma_pendiente': {
        const exclusivo = `toma:${r.folio}`;
        const caduca = this.mas(this.cfg.caducaTomaHoras * 3_600_000);
        const aut = await this.boton1('Autorizar', 'autorizar_toma', ['socio'], chats.grupoSocios, caduca, exclusivo, { folio: r.folio });
        const rec = await this.boton1('Rechazar', 'rechazar_toma', ['socio'], chats.grupoSocios, caduca, exclusivo, { folio: r.folio });
        await this.com.aGrupo(chats, P.tarjetaToma(r.folio, r.titulo, r.lineas, r.resumen, estado.autor), { botones: [[aut, rec]] });
        await this.com.aOmar(chats, P.omarRecibido(r.folio, r.lineas));
        return;
      }
      case 'rechazado':
        await this.responder(estado.autor, chats, P.rechazo(r.texto));
        return;
    }
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
    const res = await this.d.tokens.consumir({ token: cb.data, rol: miembro.rol, chatId, ahora: this.d.reloj() });

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
    await this.accionDeBoton(res.accion, res.payload, { miembro, chats, chatId, messageId, callbackId: cb.id });
    return { estado: 'boton', resultado: res.accion };
  }

  private async accionDeBoton(
    accion: AccionBoton,
    payload: unknown,
    ctx: { miembro: Miembro; chats: ChatsRegistrados; chatId: number; messageId: number; callbackId: string },
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
      case 'confirmar_accion': {
        const e = payload as EstadoAccion;
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
