// Maquina de conversacion del bot (decision del dueno, 14-nov): sin tarjeta de confirmacion y sin topes; el bot PREGUNTA todo lo que falte (cliente, contado o credito, plazo, cuanto,
// quien pago, a que cuenta, modelo, sabor, cantidad, fecha...) y solo registra cuando tiene TODOS los datos obligatorios de la operacion (src/dominio/agente/slots.ts).
//
// Esta pieza es una INTERFAZ PROPIA que el integrador conecta al carril de frenos:
//   * entra por `MotorConversacion.procesar` (una instruccion ya extraida, un texto suelto o un boton);
//   * sale por `EjecutorOperacion.ejecutarOperacionCompleta` (el punto del carril de frenos: interruptor de escritura, antiduplicado, aviso al grupo, deshacer 10 minutos);
//   * el mensaje final de un pedido se arma con `ResumenPedidos` (agente.resumen_pedido_registrado, cifras de SQL).
// El modelo de IA nunca calcula dinero: los montos se leen del texto del socio (monto_conversacion.ts) y todo lo demas lo calcula SQL.
import { normalizar } from '@/dominio/catalogo/normalizar';
import { RegistroCifras } from '@/dominio/agente/cifras';
import { detectarCorreccion, type Correccion } from '@/dominio/agente/correcciones';
import { elegirCandidato, textoListaNumerada, type CandidatoConSaldo } from '@/dominio/agente/desambiguacion';
import { debeProcesarConIa } from '@/dominio/agente/entrada';
import { dijoSinFecha, formatearFechaPago, interpretarFechaPago } from '@/dominio/agente/fecha_pago';
import { interpretarMonto, montoDeExtraccion, respuestaSiNo, type MontoInterpretado } from '@/dominio/agente/monto_conversacion';
import { interpretarPlazo } from '@/dominio/agente/plazo_pedido';
import { emparejarGuias, parsearFolios, parsearGuiasTexto, textoDudasGuias, normalizarFolio, type PedidoCandidato, type RenglonGuia } from '@/dominio/agente/guias';
import { resolverCliente, resolverModelo, resolverProveedor, resolverSabor, type Candidato, type EntradaCatalogo, type Resolucion } from '@/dominio/agente/resolutor';
import { OPERACIONES, defSlot, slotsFaltantes, type DefSlot, type OperacionConv, type OpcionSlot } from '@/dominio/agente/slots';
import type { Miembro } from '@/dominio/agente/tipos';
import { formatearMoneda } from '@/dominio/formato';
import type { CatalogoAgente } from './puertos';
import { mensajePedidoRegistrado, type ResumenPedidoSql } from './mensaje_pedido';
import type { MensajeListo } from './plantillas';

// ---------------------------------------------------------------- tipos publicos

export interface BotonConv {
  texto: string;
  /** Valor compacto que el integrador guarda en el token del boton y devuelve en `{ tipo: 'boton', valor }`: `op:<valor>`, `elegir:<n>`, `si`, `no`, `cancelar`, `reemplazar`, `seguir`. */
  valor: string;
}

export interface LineaResuelta {
  modeloId: string;
  modelo: string;
  saborId: string | null;
  sabor: string | null;
  piezas: number;
}

export interface ConversacionVista {
  id: number;
  chatId: number;
  autor: string;
  operacion: OperacionConv;
  estado: 'abierta' | 'completa' | 'registrada' | 'cancelada' | 'expirada';
  slots: Record<string, unknown>;
  faltantes: string[];
  contexto: ContextoConv;
  pregunta: { slot: string | null; texto: string | null; opciones: unknown; mensajeId: number | null } | null;
  reemplazo: { operacion: string; slots: Record<string, unknown>; contexto: Record<string, unknown>; mensaje: string | null } | null;
  expiraAt: Date;
}

export type ResultadoAbrir = { estado: 'abierta'; conversacion: ConversacionVista } | { estado: 'conflicto'; abierta: ConversacionVista };

export interface AlmacenConversacion {
  /** La conversacion viva de ese chat y autor; null si no hay o si ya caduco (30 minutos de silencio). */
  obtener(chatId: number, autor: string): Promise<ConversacionVista | null>;
  abrir(a: { clave: string; chatId: number; autor: string; operacion: OperacionConv; slots: Record<string, unknown>; contexto: ContextoConv; mensaje: string | null; mensajeId: number | null }): Promise<ResultadoAbrir>;
  reemplazar(a: { clave: string; chatId: number; autor: string }): Promise<ConversacionVista>;
  completarSlot(a: { clave: string; id: number; slot: string; valor: unknown | null; mensaje?: string | null; mensajeId?: number | null; contexto?: ContextoConv }): Promise<{ estado: ConversacionVista['estado']; conversacion: ConversacionVista }>;
  fijarPregunta(a: { clave: string; id: number; slot: string | null; texto: string; opciones: readonly BotonConv[] | null; contexto: ContextoConv; mensajeId?: number | null }): Promise<ConversacionVista>;
  cancelar(a: { clave: string; id: number; motivo: string }): Promise<void>;
  registrada(a: { clave: string; id: number; folio: string }): Promise<void>;
}

/** Datos de solo lectura que la base entrega para preguntar mejor (saldos, pedidos abiertos). Todos opcionales: sin ellos solo se omite la pregunta o el aviso. */
export interface EntornoConversacion {
  catalogo: CatalogoAgente;
  saldoCliente?(clienteId: string): Promise<bigint | null>;
  pedidosAbiertos?(clienteId: string): Promise<Array<{ folio: string; saldoCent: bigint }>>;
  destinosDe?(clienteId: string): Promise<string[]>;
  /** Pedidos confirmados que todavia no salen (para validar los folios de un envio en lote). */
  pedidosPorEnviar?(): Promise<PedidoCandidato[]>;
  /** Pedidos enviados que esperan su guia (para emparejar las guias que llegan despues). */
  pedidosSinGuia?(): Promise<PedidoCandidato[]>;
}

/** Pregunta del carril de frenos que el socio contesta con "si": duplicado, cobro mayor a lo que debe, o cualquier otra pregunta del negocio (precio, existencia...). */
export type ConfirmacionFrenos = 'duplicado' | 'exceso' | 'confirmado';

export interface OperacionCompleta {
  operacion: OperacionConv;
  /** Slots ya resueltos (ids de catalogo, centavos, dias, lineas por modelo y sabor). Nunca texto crudo del modelo. */
  slots: Record<string, unknown>;
  conversacionId: number;
  /** Idempotencia: la misma clave aplica una sola vez. */
  claveIdem: string;
  autor: Miembro;
  chatId: number;
  /** Texto original del socio (se guarda como cita en el evento de negocio). */
  cita: string;
  /** El socio contesto "si, es otro" a la pregunta de antiduplicado. */
  permitirDuplicado: boolean;
  /** Lo que el socio ya confirmo ("si") a las preguntas del carril de frenos en esta operacion: un duplicado, un cobro mayor a lo que debe el cliente. */
  confirmaciones?: ReadonlyArray<ConfirmacionFrenos>;
}

export type ResultadoRegistro =
  | { tipo: 'registrado'; folio: string; pedidoId?: number; mensaje?: MensajeListo }
  /** El carril de frenos pregunta antes de registrar (por ejemplo posible duplicado): la conversacion queda completa y espera la respuesta. */
  | { tipo: 'pregunta'; motivo: 'duplicado' | 'otro'; texto: string; /** Que bandera se manda si el socio dice que si (por omision, la de duplicado). */ clave?: ConfirmacionFrenos }
  | { tipo: 'rechazado'; texto: string };

export interface EjecutorOperacion {
  ejecutarOperacionCompleta(op: OperacionCompleta): Promise<ResultadoRegistro>;
}

export interface ResumenPedidos {
  resumen(pedidoId: number): Promise<ResumenPedidoSql>;
}

export interface EntradaProceso {
  chatId: number;
  autor: Miembro;
  ahora: Date;
  /** Clave base (p. ej. update_id): de ella se derivan las claves de idempotencia de cada paso. */
  clave: string;
  mensajeId?: number | null;
  /** Si Telegram trae reply_to_message: el mensaje del bot al que contesta. Si no coincide con la pregunta pendiente, no se toma como respuesta. */
  respondeA?: number | null;
}

/** Datos crudos que dejo el extractor o un comando: textos tal como los dijo el socio. */
export type Candidatos = Record<string, unknown>;

export type Evento =
  | { tipo: 'instruccion'; operacion: OperacionConv; candidatos: Candidatos; cita: string }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'boton'; valor: string };

export type Salida =
  | { tipo: 'pregunta'; texto: string; botones: BotonConv[]; registro: RegistroCifras; conversacionId: number; slot: string | null }
  | { tipo: 'registrado'; mensaje: MensajeListo; folio: string; conversacionId: number }
  | { tipo: 'cancelada'; texto: string; registro: RegistroCifras }
  | { tipo: 'expirada'; texto: string; registro: RegistroCifras }
  /** El socio acepto cancelar la pregunta anterior: el integrador vuelve a procesar `texto` como instruccion nueva. */
  | { tipo: 'reprocesar'; texto: string }
  | { tipo: 'sin_conversacion' }
  | { tipo: 'rechazado'; texto: string; registro: RegistroCifras; conversacionId: number };

// ---------------------------------------------------------------- estado de trabajo (se persiste en agente.conversacion.contexto)

export interface LineaBorrador {
  modeloTexto: string;
  saborTexto: string | null;
  piezas: number | null;
  modelo?: { id: string; nombre: string };
  sabor?: { id: string; nombre: string };
}

export type PendienteConv =
  | { tipo: 'slot'; slot: string }
  | { tipo: 'desamb'; slot: string; candidatos: Array<{ id: string; nombre: string; saldoCent: string | null }>; linea?: { indice: number; campo: 'modelo' | 'sabor' } }
  | { tipo: 'linea'; indice: number; campo: 'modelo' | 'sabor' | 'piezas' }
  | { tipo: 'monto_confirm'; slot: string; centavos: number }
  | { tipo: 'fecha_confirm'; slot: string; opciones: Array<{ fecha: string; hora: string | null }> }
  | { tipo: 'cancelar_previa'; texto: string }
  | { tipo: 'duplicado'; clave?: ConfirmacionFrenos };

export interface ContextoConv {
  cita?: string;
  pendiente?: PendienteConv | null;
  /** Datos crudos todavia sin resolver, por clave de slot. */
  crudos?: Record<string, unknown>;
  borrador?: LineaBorrador[];
  ultimoSlot?: string | null;
  /** Reloj de la entrada en curso (la hora de Merida la interpreta el codigo, nunca el modelo). */
  ahoraIso?: string;
  /** Slots resueltos en este paso que todavia no se persisten (se guardan en `avanzar`). */
  pendientesDeGuardar?: Array<{ slot: string; valor: unknown }>;
  /** Pedidos abiertos del cliente (de la base) para preguntar a cual se aplica un cobro. */
  abiertos?: Array<{ folio: string; saldoCent: string }>;
  saldoExceso?: string;
  destinos?: string[];
  /** La pregunta que estaba abierta cuando llego una instruccion nueva: se restaura si el socio decide seguir con la anterior. */
  previa?: { pendiente: PendienteConv | null; slot: string | null; texto: string | null; botones: BotonConv[] };
  /** Preguntas del carril de frenos que el socio ya contesto con "si". */
  confirmadas?: Array<ConfirmacionFrenos>;
  /** Guias ya emparejadas mientras se aclaran las dudosas (captura de guias en lote). */
  guiasOk?: Array<{ folio: string; guia: string }>;
  /** Lo que el socio dijo tal cual para cada dato de catalogo que se resolvio (para aprender de una correccion). */
  dichos?: Record<string, string>;
}

// ---------------------------------------------------------------- utilidades

const MAX_CITA = 80;

function cortar(t: string, n = MAX_CITA): string {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function botonesDe(opciones: readonly OpcionSlot[] | undefined): BotonConv[] {
  return (opciones ?? []).map((o) => ({ texto: o.texto, valor: `op:${o.valor}` }));
}

function esVacio(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

function pareceInstruccionNueva(texto: string): boolean {
  const t = texto.trim();
  if (t.startsWith('/')) return true;
  return t.split(/\s+/).length >= 4 && debeProcesarConIa(t);
}

const CATALOGO_COMPLETO: ReadonlySet<OperacionConv> = new Set<OperacionConv>(['conteo', 'recepcion_compra', 'compra', 'devolucion']);

type Paso =
  /** El slot quedo resuelto (o se aplico un efecto sobre los slots). */
  | { estado: 'ok' }
  /** Hay que preguntar algo antes de seguir; `pendiente` queda guardado. */
  | { estado: 'pregunta'; texto: string; botones: BotonConv[]; pendiente: PendienteConv }
  /** El texto no sirvio como respuesta. */
  | { estado: 'no_entendi'; texto: string; botones: BotonConv[] };

// ---------------------------------------------------------------- motor

export class MotorConversacion {
  constructor(
    private readonly almacen: AlmacenConversacion,
    private readonly entorno: EntornoConversacion,
    private readonly ejecutor: EjecutorOperacion,
    private readonly resumenes?: ResumenPedidos,
    /** Carril de aprendizaje: una correccion de cliente ("no, era Memo Lopez") alimenta el diccionario (lo dicho -> lo correcto). Nunca guarda un alias sola. */
    private readonly alCorregir?: (c: { clave: string; autor: Miembro; chatId: number; clase: 'cliente'; dicho: string; correcto: string }) => Promise<void>,
  ) {}

  async procesar(entrada: EntradaProceso, evento: Evento): Promise<Salida> {
    const conv = await this.almacen.obtener(entrada.chatId, entrada.autor.persona);
    if (evento.tipo === 'instruccion') return this.instruccion(entrada, conv, evento);
    if (conv === null) return { tipo: 'sin_conversacion' };
    // Con reply_to_message distinto de la pregunta pendiente, el texto NO es respuesta: se trata como mensaje nuevo (se pregunta si cancela la anterior).
    const texto = evento.tipo === 'boton' ? this.botonATexto(evento.valor, conv) : evento.texto;
    if (texto === null) return { tipo: 'sin_conversacion' };
    return this.respuesta(entrada, conv, texto, evento.tipo === 'boton' ? evento.valor : null);
  }

  // ------------------------------------------------------------ apertura

  private async instruccion(e: EntradaProceso, viva: ConversacionVista | null, ev: Extract<Evento, { tipo: 'instruccion' }>): Promise<Salida> {
    const ctx: ContextoConv = { cita: ev.cita, crudos: { ...ev.candidatos }, pendiente: null, ultimoSlot: null };
    const abierta = await this.almacen.abrir({ clave: `${e.clave}:abrir`, chatId: e.chatId, autor: e.autor.persona, operacion: ev.operacion, slots: {}, contexto: ctx, mensaje: ev.cita, mensajeId: e.mensajeId ?? null });
    if (abierta.estado === 'conflicto') {
      const r = new RegistroCifras();
      const previa = abierta.abierta;
      const texto = r.servidor(`Tienes pendiente "${OPERACIONES[previa.operacion].titulo}"${previa.pregunta?.texto ? `: ${previa.pregunta.texto}` : ''}\n¿Cancelo lo anterior y empiezo con "${OPERACIONES[ev.operacion].titulo}"?`);
      return this.preguntar(previa, { ...(previa.contexto ?? {}), previa: this.previaDe(previa, previa.contexto ?? {}), pendiente: { tipo: 'cancelar_previa', texto: ev.cita } }, null, texto, [{ texto: 'Sí, cancela la anterior', valor: 'reemplazar' }, { texto: 'No, sigo con la anterior', valor: 'seguir' }], e, r);
    }
    return this.avanzar(e, abierta.conversacion, null);
  }

  // ------------------------------------------------------------ respuestas

  private botonATexto(valor: string, conv: ConversacionVista): string | null {
    if (valor === 'si') return 'si';
    if (valor === 'no') return 'no';
    if (valor === 'cancelar') return 'cancela';
    if (valor === 'reemplazar') return '__reemplazar__';
    if (valor === 'seguir') return '__seguir__';
    if (valor.startsWith('elegir:')) return valor.slice('elegir:'.length);
    if (valor.startsWith('op:')) return `__op__${valor.slice(3)}`;
    void conv;
    return null;
  }

  private async respuesta(e: EntradaProceso, conv: ConversacionVista, texto: string, _boton: string | null): Promise<Salida> {
    void _boton;
    const ctx = { ...(conv.contexto ?? {}), ahoraIso: e.ahora.toISOString() } as ContextoConv;
    const pend = ctx.pendiente ?? null;
    const r = new RegistroCifras();

    // Reply a otro mensaje: no es respuesta a la pregunta pendiente (solo si Telegram lo informa).
    if (e.respondeA != null && conv.pregunta?.mensajeId != null && e.respondeA !== conv.pregunta.mensajeId && !texto.startsWith('__')) {
      return this.preguntarSiCancela(e, conv, ctx, texto, r);
    }

    if (pend?.tipo === 'cancelar_previa') return this.respuestaCancelarPrevia(e, conv, ctx, pend, texto, r);
    if (pend?.tipo === 'duplicado') {
      const sn = respuestaSiNo(texto);
      if (sn === 'si') return this.ejecutar(e, conv, [...(ctx.confirmadas ?? []), pend.clave ?? 'duplicado']);
      if (sn === 'no') return this.cancelar(e, conv, 'era un duplicado', r);
    }

    const op = texto.startsWith('__op__') ? texto.slice('__op__'.length) : null;
    const libre = op === null ? texto : '';

    if (op === null) {
      const corr = detectarCorreccion(libre, OPERACIONES[conv.operacion].slots);
      if (corr !== null && corr.tipo === 'ultimo' && pend !== null && pend !== undefined) {
        // "no, era 8 dias" con una pregunta abierta: primero se toma como la respuesta correcta a esa pregunta; si no sirve, corrige el ultimo dato.
        const intento = await this.responderPendiente(conv, ctx, pend, corr.texto, false, r);
        if (intento.estado === 'ok') return this.avanzar(e, conv, { ...ctx, pendiente: null });
        if (intento.estado === 'pregunta') return this.preguntar(conv, { ...ctx, pendiente: intento.pendiente }, this.slotDe(intento.pendiente), intento.texto, intento.botones, e, r);
        return this.corregir(e, conv, ctx, corr, r);
      }
      if (corr !== null) return this.corregir(e, conv, ctx, corr, r);
    }

    // Respuesta a la pregunta pendiente.
    if (pend === null || pend === undefined) {
      // Una operacion completa que el servidor rechazo espera una correccion, no cualquier mensaje.
      if (conv.estado === 'completa') return this.preguntar(conv, ctx, null, r.servidor('Dime qué dato corrijo (por ejemplo: «cambia el monto a 5,000») o escribe «cancela».'), [{ texto: 'Cancelar', valor: 'cancelar' }], e, r);
      return this.avanzar(e, conv, ctx);
    }
    const paso = await this.responderPendiente(conv, ctx, pend, op ?? libre, op !== null, r);
    if (paso.estado === 'no_entendi') {
      if (op === null && pareceInstruccionNueva(libre)) return this.preguntarSiCancela(e, conv, ctx, libre, r);
      return this.preguntar(conv, ctx, conv.pregunta?.slot ?? null, paso.texto, paso.botones, e, r);
    }
    if (paso.estado === 'pregunta') {
      const g = await this.guardarPendientes(e, conv, ctx);
      return this.preguntar(g.vista, { ...ctx, pendiente: paso.pendiente }, this.slotDe(paso.pendiente), paso.texto, paso.botones, e, r);
    }
    return this.avanzar(e, conv, { ...ctx, pendiente: null });
  }

  /** Persiste los slots que dejo el paso actual (uno por llamada: idempotente y auditado). */
  private async guardarPendientes(e: EntradaProceso, conv: ConversacionVista, ctx: ContextoConv, extra: Array<{ slot: string; valor: unknown }> = []): Promise<{ vista: ConversacionVista; expirada: boolean }> {
    const lista = [...(ctx.pendientesDeGuardar ?? []), ...extra];
    ctx.pendientesDeGuardar = [];
    let vista = conv;
    let n = 0;
    for (const g of lista) {
      n += 1;
      const res = await this.almacen.completarSlot({ clave: `${e.clave}:s${n}:${g.slot}`, id: conv.id, slot: g.slot, valor: g.valor, mensaje: n === 1 ? ctx.cita ?? null : null, mensajeId: n === 1 ? e.mensajeId ?? null : null, contexto: ctx });
      vista = res.conversacion;
      if (res.estado === 'expirada') return { vista, expirada: true };
    }
    return { vista, expirada: false };
  }

  private previaDe(conv: ConversacionVista, ctx: ContextoConv): NonNullable<ContextoConv['previa']> {
    return { pendiente: ctx.pendiente ?? null, slot: conv.pregunta?.slot ?? null, texto: conv.pregunta?.texto ?? null, botones: (conv.pregunta?.opciones as BotonConv[] | null) ?? [] };
  }

  private slotDe(p: PendienteConv): string | null {
    return p.tipo === 'slot' || p.tipo === 'desamb' || p.tipo === 'monto_confirm' || p.tipo === 'fecha_confirm' ? p.slot : p.tipo === 'linea' ? 'lineas' : null;
  }

  private async preguntarSiCancela(e: EntradaProceso, conv: ConversacionVista, ctx: ContextoConv, texto: string, r: RegistroCifras): Promise<Salida> {
    const t = r.servidor(`Tienes pendiente "${OPERACIONES[conv.operacion].titulo}"${conv.pregunta?.texto ? `: ${conv.pregunta.texto}` : ''}\n¿Cancelo lo anterior y empiezo con lo nuevo?`);
    return this.preguntar(conv, { ...ctx, previa: this.previaDe(conv, ctx), pendiente: { tipo: 'cancelar_previa', texto } }, null, t, [{ texto: 'Sí, cancela la anterior', valor: 'reemplazar' }, { texto: 'No, sigo con la anterior', valor: 'seguir' }], e, r);
  }

  private async respuestaCancelarPrevia(e: EntradaProceso, conv: ConversacionVista, ctx: ContextoConv, pend: Extract<PendienteConv, { tipo: 'cancelar_previa' }>, texto: string, r: RegistroCifras): Promise<Salida> {
    const sn = texto === '__reemplazar__' ? 'si' : texto === '__seguir__' ? 'no' : respuestaSiNo(texto);
    if (sn === 'si') {
      if (conv.reemplazo !== null) {
        const nueva = await this.almacen.reemplazar({ clave: `${e.clave}:reemplazar`, chatId: e.chatId, autor: e.autor.persona });
        return this.avanzar(e, nueva, null);
      }
      await this.almacen.cancelar({ clave: `${e.clave}:cancelar`, id: conv.id, motivo: 'reemplazada por una instruccion nueva' });
      return { tipo: 'reprocesar', texto: pend.texto };
    }
    if (sn === 'no') {
      const previa = ctx.previa;
      const resto: ContextoConv = { ...ctx, pendiente: previa?.pendiente ?? null };
      delete resto.previa;
      if (previa?.texto) return this.preguntar(conv, resto, previa.slot, previa.texto, previa.botones, e, r, 'Seguimos con lo anterior.\n');
      return this.avanzar(e, conv, resto, 'Seguimos con lo anterior.\n');
    }
    return this.preguntar(conv, ctx, null, r.servidor('Responde sí para cancelar lo anterior y empezar lo nuevo, o no para seguir con lo anterior.'), [{ texto: 'Sí, cancela la anterior', valor: 'reemplazar' }, { texto: 'No, sigo con la anterior', valor: 'seguir' }], e, r);
  }

  // ------------------------------------------------------------ correcciones

  private async corregir(e: EntradaProceso, conv: ConversacionVista, ctx: ContextoConv, corr: Correccion, r: RegistroCifras): Promise<Salida> {
    if (corr.tipo === 'cancelar') return this.cancelar(e, conv, 'cancelada por el socio', r);
    const slots = { ...conv.slots };
    const crudos = { ...(ctx.crudos ?? {}) };
    let slot: string | null;
    let texto: string;
    if (corr.tipo === 'modalidad') {
      slot = 'modalidad';
      texto = corr.valor;
    } else if (corr.tipo === 'slot') {
      slot = corr.slot;
      texto = corr.texto;
    } else {
      slot = ctx.ultimoSlot ?? null;
      texto = corr.texto;
    }
    if (slot === null || defSlot(conv.operacion, slot) === undefined) {
      return this.preguntar(conv, ctx, conv.pregunta?.slot ?? null, r.servidor('¿Qué dato quieres corregir? Dime, por ejemplo: «cambia el monto a 5,000».'), [], e, r);
    }
    // Reescribe SOLO ese dato (y lo que depende de el); el resto de la operacion sigue intacto.
    const quitar = this.dependientes(slot);
    for (const k of quitar) delete slots[k];
    for (const k of quitar) delete crudos[k];
    if (slot === 'lineas') delete ctx.borrador;
    crudos[slot] = texto;
    // Aprendizaje: lo que dijo el socio al principio no era ese cliente; lo correcto es lo que dice ahora (el SQL decide si lo ignora, lo cuenta o sugiere un alias).
    const dicho = ctx.dichos?.[slot];
    if (slot === 'cliente' && this.alCorregir !== undefined && dicho !== undefined && normalizar(dicho) !== normalizar(texto)) {
      try {
        await this.alCorregir({ clave: `${e.clave}:aprende`, autor: e.autor, chatId: e.chatId, clase: 'cliente', dicho, correcto: texto });
      } catch {
        // Aprender es opcional.
      }
    }
    const base = await this.almacen.completarSlot({ clave: `${e.clave}:corr:${slot}`, id: conv.id, slot, valor: null, mensaje: texto, mensajeId: e.mensajeId ?? null, contexto: { ...ctx, crudos, pendiente: null } });
    let actual = base.conversacion;
    for (const k of quitar.filter((x) => x !== slot && actual.slots[x] !== undefined)) {
      actual = (await this.almacen.completarSlot({ clave: `${e.clave}:corr:${slot}:${k}`, id: conv.id, slot: k, valor: null })).conversacion;
    }
    return this.avanzar(e, actual, { ...ctx, crudos, pendiente: null });
  }

  /** Slots que dejan de ser validos al cambiar `slot`. */
  private dependientes(slot: string): string[] {
    switch (slot) {
      case 'cliente': return ['cliente', 'pedido', 'pedido_varios', 'exceso', 'confirma_exceso', 'destino', 'destino_varios'];
      case 'monto': return ['monto', 'exceso', 'confirma_exceso'];
      case 'modalidad': return ['modalidad', 'plazo'];
      case 'plazo': return ['plazo'];
      default: return [slot];
    }
  }

  private async cancelar(e: EntradaProceso, conv: ConversacionVista, motivo: string, r: RegistroCifras): Promise<Salida> {
    await this.almacen.cancelar({ clave: `${e.clave}:cancelar`, id: conv.id, motivo });
    return { tipo: 'cancelada', texto: r.servidor(`Listo, cancelé "${OPERACIONES[conv.operacion].titulo}". No registré nada.`), registro: r };
  }

  // ------------------------------------------------------------ pregunta pendiente

  private async responderPendiente(conv: ConversacionVista, ctx: ContextoConv, pend: PendienteConv, texto: string, esBoton: boolean, r: RegistroCifras): Promise<Paso> {
    switch (pend.tipo) {
      case 'slot': {
        const def = defSlot(conv.operacion, pend.slot);
        if (def === undefined) return { estado: 'no_entendi', texto: 'No entendí.', botones: [] };
        return this.aplicar(conv, ctx, def, esBoton ? { __boton: texto } : texto, r, true);
      }
      case 'desamb': {
        const cands = pend.candidatos.map((c) => ({ id: c.id, nombre: c.nombre }));
        const elegido = esBoton ? cands[Number(texto) - 1] ?? null : elegirCandidato(texto, cands);
        if (elegido === null || elegido === undefined) {
          return { estado: 'no_entendi', texto: textoListaNumerada('No entendí cuál. Elige una opción:', pend.candidatos.map((c) => ({ ...c, saldoCent: c.saldoCent === null ? null : BigInt(c.saldoCent) }))), botones: this.botonesLista(pend.candidatos) };
        }
        if (pend.linea) {
          const b = [...(ctx.borrador ?? [])];
          const l = { ...b[pend.linea.indice]! };
          if (pend.linea.campo === 'modelo') l.modelo = elegido;
          else l.sabor = elegido;
          b[pend.linea.indice] = l;
          ctx.borrador = b;
          ctx.pendiente = null;
          return { estado: 'ok' };
        }
        await this.fijar(conv, pend.slot, { id: elegido.id, nombre: elegido.nombre }, ctx);
        return { estado: 'ok' };
      }
      case 'linea': {
        const b = [...(ctx.borrador ?? [])];
        const l = { ...b[pend.indice]! };
        if (pend.campo === 'piezas') {
          const n = /^\s*(\d{1,6})\s*$/.exec(texto.replace(/^__op__/, ''));
          if (n === null || Number(n[1]) < 1) return { estado: 'no_entendi', texto: this.textoPiezas(l), botones: [] };
          l.piezas = Number(n[1]);
        } else if (pend.campo === 'modelo') l.modeloTexto = texto;
        else l.saborTexto = texto;
        b[pend.indice] = l;
        ctx.borrador = b;
        ctx.pendiente = null;
        return { estado: 'ok' };
      }
      case 'monto_confirm': {
        const sn = respuestaSiNo(texto);
        if (sn === 'si' || (esBoton && texto === '__op__si')) {
          await this.fijar(conv, pend.slot, pend.centavos, ctx, true);
          return { estado: 'ok' };
        }
        const def = defSlot(conv.operacion, pend.slot)!;
        if (sn === 'no') return { estado: 'pregunta', texto: r.servidor(def.pregunta), botones: botonesDe(def.opciones), pendiente: { tipo: 'slot', slot: pend.slot } };
        return this.aplicar(conv, ctx, def, texto, r, true);
      }
      case 'fecha_confirm': {
        const n = Number(texto);
        const o = Number.isInteger(n) ? pend.opciones[n - 1] : undefined;
        if (o === undefined) return { estado: 'no_entendi', texto: 'Elige una de las opciones.', botones: this.botonesFecha(pend.opciones) };
        await this.fijar(conv, pend.slot, { fecha: o.fecha, hora: o.hora, sinFecha: false }, ctx, true);
        return { estado: 'ok' };
      }
      case 'cancelar_previa':
      case 'duplicado':
        return { estado: 'ok' };
    }
  }

  // ------------------------------------------------------------ aplicar un dato crudo a un slot

  private async aplicar(conv: ConversacionVista, ctx: ContextoConv, def: DefSlot, crudo: unknown, r: RegistroCifras, esRespuesta: boolean): Promise<Paso> {
    const op = conv.operacion;
    const cita = ctx.cita ?? '';
    const fallo = (texto: string, botones: BotonConv[] = botonesDe(def.opciones)): Paso => (esRespuesta ? { estado: 'no_entendi', texto, botones } : { estado: 'pregunta', texto, botones, pendiente: { tipo: 'slot', slot: def.clave } });
    const boton = typeof crudo === 'object' && crudo !== null && '__boton' in crudo ? String((crudo as { __boton: string }).__boton) : null;
    const texto = boton ?? (typeof crudo === 'string' ? crudo.trim() : null);

    switch (def.tipo) {
      case 'opcion': {
        if (texto === null) return fallo(r.servidor(def.pregunta));
        const ok = this.elegirOpcion(def, texto);
        if (ok === null) return fallo(r.servidor(`No entendí. ${def.pregunta}`));
        if (def.clave === 'modalidad') await this.fijarModalidad(conv, ok, ctx);
        else if (def.clave === 'confirma_exceso' && ok === 'corregir') {
          for (const k of ['monto', 'exceso', 'confirma_exceso']) await this.fijar(conv, k, null, ctx);
          ctx.crudos = { ...(ctx.crudos ?? {}) };
          delete ctx.crudos.monto;
          return { estado: 'pregunta', texto: r.servidor(defSlot(op, 'monto')!.pregunta), botones: [], pendiente: { tipo: 'slot', slot: 'monto' } };
        } else await this.fijar(conv, def.clave, ok, ctx, true);
        return { estado: 'ok' };
      }
      case 'texto':
      case 'folio': {
        if (texto === null || texto === '') return fallo(r.servidor(def.pregunta));
        let v = texto;
        if (def.tipo === 'folio') {
          if (!/^[a-zA-Z]{1,3}-?\d{1,6}$/.test(texto)) return fallo(r.servidor(`No reconozco ese folio. ${def.pregunta}`));
          v = texto.toUpperCase().replace(/^([A-Z]{1,3})(\d)/, '$1-$2');
        }
        await this.fijar(conv, def.clave, v.slice(0, 200), ctx, true);
        return { estado: 'ok' };
      }
      case 'monto': {
        const permitirCero = def.opciones?.some((o) => o.valor === '0') === true;
        let m: MontoInterpretado;
        if (boton !== null && /^\d+$/.test(boton)) m = { tipo: 'ok', centavos: Number(boton) };
        else if (crudo === 0 && permitirCero) m = { tipo: 'ok', centavos: 0 };
        else if (typeof crudo === 'number') m = montoDeExtraccion(cita, crudo);
        else if (crudo !== null && typeof crudo === 'object' && 'centavos' in crudo) m = montoDeExtraccion(String((crudo as { fuente?: string }).fuente ?? cita), Number((crudo as { centavos: number }).centavos));
        else if (texto !== null) m = interpretarMonto(texto, { permitirCero });
        else m = { tipo: 'sin_cifra' };
        if (m.tipo === 'ok') {
          await this.fijar(conv, def.clave, m.centavos, ctx, true);
          return { estado: 'ok' };
        }
        if (m.tipo === 'confirmar') {
          const t = r.servidor(`Entendí ${r.pesos(BigInt(m.centavos))}. ¿Son ${r.pesos(BigInt(m.centavos))}? Responde sí, o escribe la cifra completa (por ejemplo 12,500).`);
          return { estado: 'pregunta', texto: t, botones: [{ texto: `Sí, son ${formatearMoneda(BigInt(m.centavos))}`, valor: 'si' }, { texto: 'No, la escribo', valor: 'no' }], pendiente: { tipo: 'monto_confirm', slot: def.clave, centavos: m.centavos } };
        }
        if (m.tipo === 'ambiguo') return fallo(r.servidor('Falta un dato antes de registrar: el monto sin ambigüedad: con coma para los miles y punto para los centavos (un punto seguido de tres cifras puede leerse de dos maneras).'), []);
        return fallo(r.servidor(def.pregunta), botonesDe(def.opciones));
      }
      case 'plazo': {
        if (texto === null) return fallo(r.servidor(def.pregunta), []);
        const p = interpretarPlazo(texto, new Date(ctx.ahoraIso!));
        if (p.tipo === 'no_entendi') return fallo(r.servidor(`No entendí el plazo. ${def.pregunta}`), []);
        if (p.dias === 0) {
          await this.fijarModalidad(conv, 'contado', ctx);
          return { estado: 'ok' };
        }
        await this.fijar(conv, 'modalidad', 'credito', ctx);
        await this.fijar(conv, 'plazo', p.dias, ctx, true);
        return { estado: 'ok' };
      }
      case 'fecha_pago': {
        if (texto === null) return fallo(r.servidor(def.pregunta), []);
        if (dijoSinFecha(texto)) {
          await this.fijar(conv, def.clave, { fecha: null, hora: null, sinFecha: true }, ctx, true);
          return { estado: 'ok' };
        }
        const f = interpretarFechaPago(texto, new Date(ctx.ahoraIso!), { direccion: def.clave === 'fecha' ? 'pasado' : 'futuro' });
        if (f.tipo === 'ok') {
          await this.fijar(conv, def.clave, { fecha: f.fecha, hora: f.hora, sinFecha: false }, ctx, true);
          return { estado: 'ok' };
        }
        if (f.tipo === 'ambiguo') {
          const opciones = f.opciones.map((o) => ({ fecha: o.fecha, hora: o.hora }));
          return { estado: 'pregunta', texto: r.servidor('¿Cuál de estas fechas es? ' + opciones.map((o, i) => `${i + 1}. ${formatearFechaPago(o.fecha, o.hora)}`).join(' ')), botones: this.botonesFecha(opciones), pendiente: { tipo: 'fecha_confirm', slot: def.clave, opciones } };
        }
        return fallo(r.servidor(f.tipo === 'pasada' ? `Esa fecha ya pasó. ${def.pregunta}` : `No entendí la fecha. ${def.pregunta}`), []);
      }
      case 'cliente': {
        if (texto === null || texto === '') return fallo(r.servidor(def.pregunta), []);
        return this.resolverUnico(conv, ctx, def, texto, await this.entorno.catalogo.clientes(), 'cliente', r, esRespuesta);
      }
      case 'proveedor': {
        if (texto === null || texto === '') return fallo(r.servidor(def.pregunta), botonesDe(def.opciones));
        const p = boton !== null ? resolverProveedor(boton) : resolverProveedor(texto);
        if (p.estado === 'unico') {
          await this.fijar(conv, def.clave, { id: p.id, nombre: p.nombre }, ctx, true);
          return { estado: 'ok' };
        }
        return fallo(r.servidor(p.estado === 'varios' ? `En "${cortar(cita)}", ¿cual proveedor es "${cortar(texto, 40)}"?` : `En "${cortar(cita)}", no encontre proveedor "${cortar(texto, 40)}". ¿Es Isaac o Karen (Vapemate)?`), botonesDe(def.opciones));
      }
      case 'lineas': {
        const borrador = ctx.borrador ?? this.borradorDe(crudo, await this.entorno.catalogo.modelos());
        if (borrador === null) return fallo(r.servidor(def.pregunta), []);
        ctx.borrador = borrador;
        return this.resolverLineas(conv, ctx, def, r);
      }
      case 'folios':
        return this.aplicarFolios(conv, ctx, def, crudo, texto, r, fallo);
      case 'guias':
        return this.aplicarGuias(conv, ctx, def, crudo, texto, r);
      case 'bandera':
        return { estado: 'ok' };
    }
  }

  /** Folios de los pedidos que salen: lista libre o arreglo del interprete. Si la base informa cuales esperan salir, un folio desconocido se pregunta. */
  private async aplicarFolios(conv: ConversacionVista, ctx: ContextoConv, def: DefSlot, crudo: unknown, texto: string | null, r: RegistroCifras, fallo: (t: string, b?: BotonConv[]) => Paso): Promise<Paso> {
    const pend = this.entorno.pedidosPorEnviar ? await this.entorno.pedidosPorEnviar() : null;
    let folios: string[] = [];
    if (Array.isArray(crudo)) folios = crudo.flatMap((x) => parsearFolios(String(x)));
    else if (texto !== null && /^\s*(todos|todo)\b/i.test(texto) && pend !== null) folios = pend.map((p) => normalizarFolio(p.folio));
    else if (texto !== null) folios = parsearFolios(texto);
    folios = [...new Set(folios)];
    if (folios.length === 0) return fallo(r.servidor(def.pregunta), []);
    if (pend !== null) {
      const conocidos = new Set(pend.map((p) => normalizarFolio(p.folio)));
      const faltan = folios.filter((f) => !conocidos.has(f));
      if (faltan.length > 0) {
        const lista = pend.slice(0, 10).map((p) => `${p.folio} ${p.cliente}`).join('; ');
        return fallo(r.servidor(`No encuentro como pedido por enviar: ${faltan.join(', ')}.${lista ? ` Esperan salir: ${lista}.` : ' No hay pedidos confirmados por enviar.'} Escribe los folios de nuevo.`), []);
      }
    }
    await this.fijar(conv, def.clave, folios, ctx, true);
    return { estado: 'ok' };
  }

  /** Guias que llegan despues: se emparejan por folio, folio del proveedor o cliente; si hay duda se pregunta (nunca se adivina) y lo ya emparejado se conserva. */
  private async aplicarGuias(conv: ConversacionVista, ctx: ContextoConv, def: DefSlot, crudo: unknown, texto: string | null, r: RegistroCifras): Promise<Paso> {
    let renglones: RenglonGuia[] = [];
    if (Array.isArray(crudo)) {
      renglones = crudo.map((x) => {
        const o = x as { pedido_folio?: string | null; cliente_texto?: string | null; guia_texto?: string; guia?: string };
        return { pedidoFolio: o.pedido_folio ? normalizarFolio(String(o.pedido_folio)) : null, clienteTexto: o.cliente_texto ? String(o.cliente_texto) : null, guia: String(o.guia_texto ?? o.guia ?? '').trim() };
      }).filter((x) => x.guia !== '');
    } else if (texto !== null) renglones = parsearGuiasTexto(texto);
    const previas = ctx.guiasOk ?? [];
    const preguntar = (t: string): Paso => ({ estado: 'pregunta', texto: r.servidor(t), botones: [], pendiente: { tipo: 'slot', slot: def.clave } });
    if (renglones.length === 0) return preguntar(def.pregunta);
    const pendientes = this.entorno.pedidosSinGuia ? (await this.entorno.pedidosSinGuia()).filter((p) => !previas.some((g) => normalizarFolio(g.folio) === normalizarFolio(p.folio))) : null;
    if (pendientes === null) {
      // Sin lista de la base solo se aceptan renglones con folio explicito.
      const sinFolio = renglones.filter((x) => x.pedidoFolio === null);
      if (sinFolio.length > 0) return preguntar('Dime a qué pedido va cada guía: escríbelas como «FOLIO GUÍA», por ejemplo MG-001 5551234.');
      await this.fijar(conv, def.clave, [...previas, ...renglones.map((x) => ({ folio: x.pedidoFolio!, guia: x.guia }))], ctx, true);
      return { estado: 'ok' };
    }
    const res = emparejarGuias(renglones, pendientes);
    const todas = [...previas, ...res.emparejadas];
    if (res.dudas.length > 0) {
      ctx.guiasOk = todas;
      return preguntar(textoDudasGuias(res.dudas, todas));
    }
    delete ctx.guiasOk;
    await this.fijar(conv, def.clave, todas, ctx, true);
    return { estado: 'ok' };
  }

  private elegirOpcion(def: DefSlot, texto: string): string | null {
    const t = normalizar(texto.replace(/^__op__/, ''));
    const raw = texto.replace(/^__op__/, '');
    const op = def.opciones ?? [];
    const exacto = op.find((o) => o.valor === raw);
    if (exacto) return exacto.valor;
    const porTexto = op.filter((o) => normalizar(o.texto) === t || normalizar(o.valor.replace(/_/g, ' ')) === t);
    if (porTexto.length === 1) return porTexto[0]!.valor;
    const sinonimos: Readonly<Record<string, string>> = { credito: 'credito', 'a credito': 'credito', fiado: 'credito', fiada: 'credito', contado: 'contado', 'de contado': 'contado', efectivo: 'efectivo', transferencia: 'transferencia', transfer: 'transferencia', spei: 'transferencia', total: 'total', parcial: 'parcial', completo: 'total', todo: 'total', capital: 'capital', reembolso: 'reembolso', anticipo: 'anticipo', corregir: 'corregir', 'sin envio': '0' };
    const s = sinonimos[t];
    if (s !== undefined) { const o = op.find((x) => x.valor === s); if (o) return o.valor; }
    const parciales = op.filter((o) => t.length >= 3 && t.split(' ').length <= 3 && (normalizar(o.texto).includes(t) || t.includes(normalizar(o.valor.replace(/_/g, ' ')))));
    return parciales.length === 1 ? parciales[0]!.valor : null;
  }

  private async fijarModalidad(conv: ConversacionVista, valor: string, ctx: ContextoConv): Promise<void> {
    await this.fijar(conv, 'modalidad', valor, ctx, true);
    if (valor === 'contado') await this.fijar(conv, 'plazo', 0, ctx);
    else if (conv.slots.plazo === 0) await this.fijar(conv, 'plazo', null, ctx);
  }

  /** Guarda el slot en la copia local; la persistencia se hace en `avanzar` (un paso a la vez) via el almacen. */
  private async fijar(conv: ConversacionVista, slot: string, valor: unknown | null, ctx: ContextoConv, esDato = false): Promise<void> {
    if (valor === null) delete conv.slots[slot];
    else conv.slots[slot] = valor;
    ctx.pendientesDeGuardar = [...(ctx.pendientesDeGuardar ?? []), { slot, valor }];
    if (esDato) ctx.ultimoSlot = slot;
  }

  // ------------------------------------------------------------ resolucion de un unico (cliente)

  private async resolverUnico(conv: ConversacionVista, ctx: ContextoConv, def: DefSlot, texto: string, catalogo: EntradaCatalogo[], campo: string, r: RegistroCifras, esRespuesta: boolean): Promise<Paso> {
    const cita = cortar(ctx.cita ?? texto);
    const res: Resolucion = resolverCliente(texto, catalogo, { rol: 'socio' }) as Resolucion;
    if (res.estado === 'unico') {
      await this.fijar(conv, def.clave, { id: res.id, nombre: res.nombre }, ctx, true);
      ctx.dichos = { ...(ctx.dichos ?? {}), [def.clave]: texto };
      return { estado: 'ok' };
    }
    if (res.estado === 'varios') {
      const cands = await this.conSaldo(res.candidatos);
      const t = textoListaNumerada(`En "${cita}", ¿cual ${campo} es "${cortar(texto, 40)}"?`, cands);
      return { estado: 'pregunta', texto: r.servidor(t), botones: this.botonesLista(cands.map((c) => ({ id: c.id, nombre: c.nombre, saldoCent: c.saldoCent === null ? null : String(c.saldoCent) }))), pendiente: { tipo: 'desamb', slot: def.clave, candidatos: cands.map((c) => ({ id: c.id, nombre: c.nombre, saldoCent: c.saldoCent === null ? null : String(c.saldoCent) })) } };
    }
    const sug = res.estado === 'ninguno' ? res.sugerencias.map((s) => s.nombre) : [];
    const t = sug.length > 0
      ? `En "${cita}", no encontre ${campo} "${cortar(texto, 40)}". ¿Quisiste decir ${sug.slice(0, 3).join(' o ')}?`
      : `En "${cita}", no encontre ${campo} "${cortar(texto, 40)}". Escribe el nombre completo.`;
    const paso: Paso = esRespuesta ? { estado: 'no_entendi', texto: r.servidor(t), botones: [] } : { estado: 'pregunta', texto: r.servidor(t), botones: [], pendiente: { tipo: 'slot', slot: def.clave } };
    return paso;
  }

  private async conSaldo(cands: readonly Candidato[]): Promise<CandidatoConSaldo[]> {
    const out: CandidatoConSaldo[] = [];
    for (const c of cands.slice(0, 8)) out.push({ ...c, saldoCent: this.entorno.saldoCliente ? await this.entorno.saldoCliente(c.id) : null });
    return out;
  }

  private botonesLista(cands: ReadonlyArray<{ nombre: string }>): BotonConv[] {
    return cands.slice(0, 8).map((c, i) => ({ texto: `${i + 1}. ${c.nombre}`, valor: `elegir:${i + 1}` }));
  }

  private botonesFecha(ops: ReadonlyArray<{ fecha: string; hora: string | null }>): BotonConv[] {
    return ops.map((o, i) => ({ texto: formatearFechaPago(o.fecha, o.hora), valor: `elegir:${i + 1}` }));
  }

  // ------------------------------------------------------------ renglones (modelo, sabor y piezas)

  private borradorDe(crudo: unknown, modelos: EntradaCatalogo[]): LineaBorrador[] | null {
    if (Array.isArray(crudo)) {
      const l = crudo.map((x) => {
        const o = x as { modelo?: string; modelo_texto?: string; sabor?: string | null; sabor_texto?: string | null; piezas?: number | null };
        return { modeloTexto: String(o.modelo ?? o.modelo_texto ?? '').trim(), saborTexto: (o.sabor ?? o.sabor_texto ?? null) === null ? null : String(o.sabor ?? o.sabor_texto).trim(), piezas: o.piezas ?? null };
      }).filter((x) => x.modeloTexto !== '');
      return l.length > 0 ? l : null;
    }
    if (typeof crudo !== 'string' || crudo.trim() === '') return null;
    const segmentos = crudo.split(/\n|,|;|\by\b(?=\s+\w+\s+\w+\s+\d)/i).map((s) => s.trim()).filter(Boolean);
    const l: LineaBorrador[] = [];
    for (const seg of segmentos) {
      const m = /(\d{1,6})\s*(?:pzs?|piezas?|pz)?\s*$/i.exec(seg) ?? /^(\d{1,6})\s*(?:pzs?|piezas?|pz)?\s+/i.exec(seg);
      const piezas = m ? Number(m[1]) : null;
      const resto = (m ? seg.replace(m[0], ' ') : seg).replace(/\s+/g, ' ').trim();
      if (resto === '') continue;
      const toks = resto.split(' ');
      let modeloTexto = resto;
      let saborTexto: string | null = null;
      for (let k = toks.length - 1; k >= 1; k--) {
        const r1 = resolverModelo(toks.slice(0, k).join(' '), modelos);
        if (r1.estado === 'unico' || r1.estado === 'varios') { modeloTexto = toks.slice(0, k).join(' '); saborTexto = toks.slice(k).join(' '); break; }
      }
      l.push({ modeloTexto, saborTexto, piezas });
    }
    return l.length > 0 ? l : null;
  }

  private textoPiezas(l: LineaBorrador): string {
    return `¿Cuántas piezas de ${[l.modelo?.nombre ?? l.modeloTexto, l.sabor?.nombre ?? l.saborTexto].filter(Boolean).join(' ').toUpperCase()}? Escribe solo el número.`;
  }

  private async resolverLineas(conv: ConversacionVista, ctx: ContextoConv, def: DefSlot, r: RegistroCifras): Promise<Paso> {
    const cita = cortar(ctx.cita ?? '');
    const modelos = await this.entorno.catalogo.modelos();
    const b = ctx.borrador!;
    for (let i = 0; i < b.length; i++) {
      const l = b[i]!;
      if (l.modelo === undefined) {
        const res = resolverModelo(l.modeloTexto, modelos);
        if (res.estado === 'unico') l.modelo = { id: res.id, nombre: res.nombre };
        else if (res.estado === 'varios') {
          const cands = res.candidatos.map((c) => ({ id: c.id, nombre: c.nombre, saldoCent: null as string | null }));
          return { estado: 'pregunta', texto: r.servidor(textoListaNumerada(`En "${cita}", ¿cual modelo es "${cortar(l.modeloTexto, 40)}"?`, cands.map((c) => ({ ...c, saldoCent: null })))), botones: this.botonesLista(cands), pendiente: { tipo: 'desamb', slot: 'lineas', candidatos: cands, linea: { indice: i, campo: 'modelo' } } };
        } else {
          const sug = res.estado === 'ninguno' ? res.sugerencias.map((s) => s.nombre) : [];
          return { estado: 'pregunta', texto: r.servidor(sug.length > 0 ? `En "${cita}", no encontre modelo "${cortar(l.modeloTexto, 40)}". ¿Quisiste decir ${sug.slice(0, 3).join(' o ')}?` : `En "${cita}", no encontre modelo "${cortar(l.modeloTexto, 40)}". Escribe el nombre del modelo.`), botones: [], pendiente: { tipo: 'linea', indice: i, campo: 'modelo' } };
        }
      }
      if (l.sabor === undefined && def.saborObligatorio !== false) {
        const sabores = CATALOGO_COMPLETO.has(conv.operacion) && this.entorno.catalogo.saboresDe ? await this.entorno.catalogo.saboresDe(l.modelo!.id) : await this.entorno.catalogo.saboresEnExistencia(l.modelo!.id);
        if (l.saborTexto === null || l.saborTexto === '') {
          return { estado: 'pregunta', texto: r.servidor(`¿Qué sabor de ${l.modelo!.nombre.toUpperCase()}?${sabores.length ? ` Hay: ${sabores.slice(0, 8).map((s) => s.nombre.toUpperCase()).join(', ')}.` : ''}`), botones: sabores.slice(0, 8).map((s) => ({ texto: s.nombre.toUpperCase(), valor: `op:${s.nombre}` })), pendiente: { tipo: 'linea', indice: i, campo: 'sabor' } };
        }
        const res = resolverSabor(l.saborTexto, sabores);
        if (res.estado === 'unico') l.sabor = { id: res.id, nombre: res.nombre };
        else if (res.estado === 'varios') {
          const cands = res.candidatos.map((c) => ({ id: c.id, nombre: c.nombre, saldoCent: null as string | null }));
          return { estado: 'pregunta', texto: r.servidor(textoListaNumerada(`En "${cita}", ¿cual sabor es "${cortar(l.saborTexto, 40)}"?`, cands.map((c) => ({ ...c, saldoCent: null })))), botones: this.botonesLista(cands), pendiente: { tipo: 'desamb', slot: 'lineas', candidatos: cands, linea: { indice: i, campo: 'sabor' } } };
        } else {
          const sug = res.estado === 'ninguno' ? res.sugerencias.map((s) => s.nombre) : [];
          return { estado: 'pregunta', texto: r.servidor(sug.length > 0 ? `En "${cita}", no encontre sabor "${cortar(l.saborTexto, 40)}". ¿Quisiste decir ${sug.slice(0, 3).join(' o ')}?` : `En "${cita}", no encontre sabor "${cortar(l.saborTexto, 40)}" de ${l.modelo!.nombre.toUpperCase()}.`), botones: sabores.slice(0, 8).map((s) => ({ texto: s.nombre.toUpperCase(), valor: `op:${s.nombre}` })), pendiente: { tipo: 'linea', indice: i, campo: 'sabor' } };
        }
      }
      if (l.piezas === null || l.piezas < 1) {
        return { estado: 'pregunta', texto: r.servidor(this.textoPiezas(l)), botones: [], pendiente: { tipo: 'linea', indice: i, campo: 'piezas' } };
      }
    }
    const resueltas: LineaResuelta[] = b.map((l) => ({ modeloId: l.modelo!.id, modelo: l.modelo!.nombre, saborId: l.sabor?.id ?? null, sabor: l.sabor?.nombre ?? null, piezas: l.piezas! }));
    await this.fijar(conv, 'lineas', resueltas, ctx, true);
    delete ctx.borrador;
    return { estado: 'ok' };
  }

  // ------------------------------------------------------------ avance: persistir, completar, preguntar, registrar

  /**
   * Procesa los datos crudos que queden, calcula las banderas que dependen del servidor (varios pedidos abiertos, exceso, varios destinos), persiste los slots
   * y pregunta lo primero que falte; si ya no falta nada, registra.
   */
  private async avanzar(e: EntradaProceso, conv0: ConversacionVista, ctx0: ContextoConv | null, prefijo = ''): Promise<Salida> {
    const conv = conv0;
    const ctx: ContextoConv = { ...(ctx0 ?? conv.contexto ?? {}), ahoraIso: e.ahora.toISOString(), pendiente: null } as ContextoConv;
    const r = new RegistroCifras();
    const op = OPERACIONES[conv.operacion];
    let pregunta: Extract<Paso, { estado: 'pregunta' }> | null = null;

    // 1) Pendientes de guardar que dejo la respuesta anterior (se aplican a la copia local; se persisten al final).
    const guardar: Array<{ slot: string; valor: unknown }> = [...(ctx.pendientesDeGuardar ?? [])];
    ctx.pendientesDeGuardar = [];

    // 2) Datos crudos pendientes, en el orden de los slots. Si uno exige pregunta, se detiene ahi.
    const crudos = { ...(ctx.crudos ?? {}) };
    for (const def of op.slots) {
      if (pregunta !== null) break;
      const crudo = crudos[def.clave];
      if (crudo === undefined || crudo === null) continue;
      if (!esVacio(conv.slots[def.clave]) && def.tipo !== 'lineas') { delete crudos[def.clave]; continue; }
      if (def.tipo === 'lineas' && Array.isArray(conv.slots.lineas) && conv.slots.lineas.length > 0) { delete crudos[def.clave]; continue; }
      ctx.crudos = crudos;
      const paso = await this.aplicar(conv, ctx, def, crudo, r, false);
      guardar.push(...(ctx.pendientesDeGuardar ?? []));
      ctx.pendientesDeGuardar = [];
      if (paso.estado === 'ok') delete crudos[def.clave];
      else if (paso.estado === 'pregunta') {
        pregunta = paso;
        if (def.tipo !== 'lineas') delete crudos[def.clave];
      } else { pregunta = { estado: 'pregunta', texto: paso.texto, botones: paso.botones, pendiente: { tipo: 'slot', slot: def.clave } }; delete crudos[def.clave]; }
    }
    ctx.crudos = crudos;

    // 3) Lineas con borrador a medias (respuesta a una pregunta de renglon).
    if (pregunta === null && ctx.borrador !== undefined && conv.slots.lineas === undefined) {
      const def = op.slots.find((s) => s.tipo === 'lineas')!;
      const paso = await this.resolverLineas(conv, ctx, def, r);
      guardar.push(...(ctx.pendientesDeGuardar ?? []));
      ctx.pendientesDeGuardar = [];
      if (paso.estado === 'pregunta') pregunta = paso;
    }

    // 4) Banderas que dependen de la base.
    if (pregunta === null) pregunta = await this.banderas(conv, ctx, r, guardar);

    // 5) Persistir los slots llenados.
    const g = await this.guardarPendientes(e, conv, ctx, guardar);
    if (g.expirada) return { tipo: 'expirada', texto: r.servidor('Esa operación caducó por falta de respuesta. Escríbela de nuevo.'), registro: r };
    let vista = g.vista;
    vista = { ...vista, slots: { ...vista.slots }, contexto: ctx };

    // 6) Siguiente pregunta o registro.
    if (pregunta !== null) return this.preguntar(vista, { ...ctx, pendiente: pregunta.pendiente }, this.slotDe(pregunta.pendiente), pregunta.texto, pregunta.botones, e, r, prefijo);
    const falta = slotsFaltantes(conv.operacion, vista.slots);
    if (falta.length > 0) {
      const def = defSlot(conv.operacion, falta[0]!)!;
      const extra = await this.preguntaDinamica(conv.operacion, def, vista, r);
      const texto = extra?.texto ?? r.servidor(def.pregunta);
      const botones = extra?.botones ?? botonesDe(def.opciones);
      return this.preguntar(vista, { ...ctx, pendiente: { tipo: 'slot', slot: def.clave } }, def.clave, texto, botones, e, r, prefijo);
    }
    return this.ejecutar(e, vista, []);
  }

  private async banderas(conv: ConversacionVista, ctx: ContextoConv, r: RegistroCifras, guardar: Array<{ slot: string; valor: unknown }>): Promise<Extract<Paso, { estado: 'pregunta' }> | null> {
    const cli = conv.slots.cliente as { id: string } | undefined;
    if (cli === undefined) return null;
    const poner = (slot: string, valor: unknown) => { conv.slots[slot] = valor; guardar.push({ slot, valor }); };
    if ((conv.operacion === 'cobro_cliente' || conv.operacion === 'pago_redirigido') && conv.slots.pedido_varios === undefined && this.entorno.pedidosAbiertos) {
      const abiertos = await this.entorno.pedidosAbiertos(cli.id);
      poner('pedido_varios', abiertos.length > 1);
      if (abiertos.length === 1) poner('pedido', abiertos[0]!.folio);
      ctx.crudos = { ...(ctx.crudos ?? {}) };
      (ctx as ContextoConv & { abiertos?: unknown }).abiertos = abiertos.map((a) => ({ folio: a.folio, saldoCent: String(a.saldoCent) }));
    }
    if (conv.operacion === 'cobro_cliente' && typeof conv.slots.monto === 'number' && conv.slots.exceso === undefined && this.entorno.saldoCliente) {
      const saldo = await this.entorno.saldoCliente(cli.id);
      poner('exceso', saldo !== null && BigInt(conv.slots.monto) > (saldo > 0n ? saldo : 0n));
      if (conv.slots.exceso === true) ctx.saldoExceso = String(saldo ?? 0n);
    }
    if (conv.operacion === 'pedido_bodega' && conv.slots.destino_varios === undefined && this.entorno.destinosDe) {
      const d = await this.entorno.destinosDe(cli.id);
      poner('destino_varios', d.length > 1);
      ctx.destinos = d;
    }
    void r;
    return null;
  }

  /** Preguntas cuyo texto o botones dependen de datos del servidor. */
  private async preguntaDinamica(op: OperacionConv, def: DefSlot, conv: ConversacionVista, r: RegistroCifras): Promise<{ texto: string; botones: BotonConv[] } | null> {
    const ctx = conv.contexto as ContextoConv & { abiertos?: Array<{ folio: string; saldoCent: string }>; saldoExceso?: string; destinos?: string[] };
    if (def.clave === 'pedido' && ctx.abiertos && ctx.abiertos.length > 1) {
      const cli = conv.slots.cliente as { nombre: string };
      const total = ctx.abiertos.reduce((a, x) => a + BigInt(x.saldoCent), 0n);
      return {
        texto: r.servidor(`${cli.nombre} debe ${r.pesos(total)} en ${r.config(ctx.abiertos.length)} pedidos (${ctx.abiertos.map((x) => r.folio(x.folio)).join(', ')}). ¿Lo aplico al más antiguo o a otro?`),
        botones: [{ texto: 'Al más antiguo', valor: `op:${ctx.abiertos[0]!.folio}` }, ...ctx.abiertos.slice(1, 6).map((x) => ({ texto: x.folio, valor: `op:${x.folio}` }))],
      };
    }
    if (def.clave === 'confirma_exceso' && op === 'cobro_cliente') {
      const debe = BigInt(ctx.saldoExceso ?? '0');
      return { texto: r.servidor(`El monto es mayor que lo que debe el cliente (${r.pesos(debe)}). ¿Es un anticipo o corrijo el monto?`), botones: botonesDe(def.opciones) };
    }
    if (def.clave === 'destino' && op === 'pedido_bodega' && ctx.destinos) {
      return { texto: r.servidor(`¿A cuál destino va: ${ctx.destinos.join(' o ')}?`), botones: ctx.destinos.slice(0, 6).map((d) => ({ texto: d, valor: `op:${d}` })) };
    }
    return null;
  }

  private async preguntar(conv: ConversacionVista, ctx: ContextoConv, slot: string | null, texto: string, botones: BotonConv[], e: EntradaProceso, r: RegistroCifras, prefijo = ''): Promise<Salida> {
    const limpio: ContextoConv = { ...ctx };
    delete (limpio as { pendientesDeGuardar?: unknown }).pendientesDeGuardar;
    const final = prefijo + texto;
    r.servidor(prefijo);
    await this.almacen.fijarPregunta({ clave: `${e.clave}:q`, id: conv.id, slot, texto: final, opciones: botones.length > 0 ? botones : null, contexto: limpio, mensajeId: null });
    return { tipo: 'pregunta', texto: final, botones, registro: r, conversacionId: conv.id, slot };
  }

  // ------------------------------------------------------------ registro

  private async ejecutar(e: EntradaProceso, conv: ConversacionVista, confirmadas: Array<ConfirmacionFrenos>): Promise<Salida> {
    const r = new RegistroCifras();
    const op: OperacionCompleta = {
      operacion: conv.operacion, slots: { ...conv.slots }, conversacionId: conv.id, claveIdem: `conv:${conv.id}:registro`, autor: e.autor, chatId: e.chatId,
      cita: (conv.contexto as ContextoConv).cita ?? '', permitirDuplicado: confirmadas.includes('duplicado'), confirmaciones: confirmadas,
    };
    const res = await this.ejecutor.ejecutarOperacionCompleta(op);
    if (res.tipo === 'rechazado') {
      await this.almacen.fijarPregunta({ clave: `${e.clave}:rech`, id: conv.id, slot: null, texto: res.texto, opciones: null, contexto: { ...(conv.contexto as ContextoConv), pendiente: null } });
      return { tipo: 'rechazado', texto: r.servidor(`${res.texto} No registré nada. Dime qué corrijo o escribe «cancela».`), registro: r, conversacionId: conv.id };
    }
    if (res.tipo === 'pregunta') {
      const t = r.servidor(res.texto);
      const botonesPregunta: BotonConv[] = [{ texto: res.clave === 'exceso' ? 'Sí, es anticipo' : res.clave === 'confirmado' ? 'Sí, continuar' : 'Sí, es otro', valor: 'si' }, { texto: 'No, cancela', valor: 'no' }];
      await this.almacen.fijarPregunta({ clave: `${e.clave}:dup`, id: conv.id, slot: null, texto: t, opciones: botonesPregunta, contexto: { ...(conv.contexto as ContextoConv), pendiente: { tipo: 'duplicado', ...(res.clave ? { clave: res.clave } : {}) }, confirmadas } });
      return { tipo: 'pregunta', texto: t, botones: botonesPregunta, registro: r, conversacionId: conv.id, slot: null };
    }
    await this.almacen.registrada({ clave: `${e.clave}:reg`, id: conv.id, folio: res.folio });
    let mensaje = res.mensaje;
    if (mensaje === undefined) {
      if (res.pedidoId !== undefined && this.resumenes) mensaje = mensajePedidoRegistrado(await this.resumenes.resumen(res.pedidoId), e.autor.persona, OPERACIONES[conv.operacion].avisoFinal);
      else mensaje = { texto: r.servidor(`Registrado ${r.folio(res.folio)}: ${OPERACIONES[conv.operacion].titulo}.`), registro: r };
    }
    return { tipo: 'registrado', mensaje, folio: res.folio, conversacionId: conv.id };
  }
}
