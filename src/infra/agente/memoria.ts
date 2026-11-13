// Implementaciones EN MEMORIA de los puertos del agente (pruebas, simulador local). Los equivalentes de produccion viven en Postgres
// (ver docs/lanes/agente-telegram-necesita-db.md); cumplen el mismo contrato.
import { randomBytes } from 'node:crypto';
import {
  aplicarLiberacion,
  aplicarLiquidacion,
  estadoInicial,
  evaluarReserva,
  type EstadoPresupuesto,
  type RolPresupuesto,
} from '@/dominio/agente/presupuesto';
import type { EntradaCatalogo } from '@/dominio/agente/resolutor';
import type { ChatsRegistrados, Miembro, RolMiembro } from '@/dominio/agente/tipos';
import type {
  AlmacenAgente,
  AlmacenPresupuesto,
  AlmacenTokens,
  BotonEnLinea,
  CatalogoAgente,
  EnviadorTelegram,
  EstadoModoSinIa,
  EventoAgente,
  MensajeSalida,
  NuevoToken,
  ResultadoConsumo,
  ResultadoReserva,
  SolicitudReserva,
} from '@/aplicacion/agente/puertos';

export class AlmacenAgenteMemoria implements AlmacenAgente {
  readonly eventos: EventoAgente[] = [];
  noProcesados = 0;
  private readonly updates = new Set<number>();
  private readonly mensajes = new Set<string>();
  private readonly corridas = new Map<string, unknown>();
  private sinIa: EstadoModoSinIa = { activo: false, motivo: null, avisado: false };

  constructor(
    private readonly miembros: readonly Miembro[],
    private readonly chatsRegistrados: ChatsRegistrados,
  ) {}

  async reclamarUpdate(updateId: number): Promise<boolean> {
    if (this.updates.has(updateId)) return false;
    this.updates.add(updateId);
    return true;
  }

  /** Doble de pruebas: la memoria no lleva reloj de frecuencia; las pruebas lo reemplazan. */
  mensajesRecientes?: (chatId: number, segundos: number) => Promise<number>;

  async reclamarMensaje(chatId: number, messageId: number): Promise<boolean> {
    const k = `${chatId}:${messageId}`;
    if (this.mensajes.has(k)) return false;
    this.mensajes.add(k);
    return true;
  }

  async miembroPorTelegramId(id: number): Promise<Miembro | null> {
    return this.miembros.find((m) => m.telegramUserId === id) ?? null;
  }

  async chats(): Promise<ChatsRegistrados> {
    return this.chatsRegistrados;
  }

  async modoSinIa(): Promise<EstadoModoSinIa> {
    return { ...this.sinIa };
  }

  async fijarModoSinIa(activo: boolean, motivo: string | null): Promise<boolean> {
    const cambio = this.sinIa.activo !== activo;
    this.sinIa = activo ? { activo, motivo, avisado: cambio ? false : this.sinIa.avisado } : { activo: false, motivo: null, avisado: false };
    return cambio;
  }

  async marcarAvisoSinIa(): Promise<void> {
    this.sinIa = { ...this.sinIa, avisado: true };
  }

  async corrida(clave: string): Promise<unknown | null> {
    return this.corridas.get(clave) ?? null;
  }

  async guardarCorrida(clave: string, resultado: unknown): Promise<void> {
    this.corridas.set(clave, resultado);
  }

  async contarNoProcesado(): Promise<void> {
    this.noProcesados++;
  }

  async registrarEvento(evento: EventoAgente): Promise<void> {
    this.eventos.push(evento);
  }
}

interface Reserva {
  rol: RolPresupuesto;
  microUsd: bigint;
  estado: 'reservada' | 'liquidada' | 'liberada';
}

export class AlmacenPresupuestoMemoria implements AlmacenPresupuesto {
  private estado: EstadoPresupuesto | null = null;
  private readonly reservas = new Map<string, Reserva>();

  constructor(inicial?: EstadoPresupuesto) {
    this.estado = inicial ?? null;
  }

  snapshot(): EstadoPresupuesto | null {
    return this.estado;
  }

  async reservar(s: SolicitudReserva): Promise<ResultadoReserva> {
    if (this.reservas.has(s.clave)) return { ok: true, avisos: [] }; // idempotente
    const actual = this.estado ?? estadoInicial(s.fechaNeg);
    const d = evaluarReserva(actual, s.rol, s.microUsd, s.fechaNeg);
    if (!d.ok) return { ok: false, motivo: d.motivo };
    this.estado = d.estado;
    this.reservas.set(s.clave, { rol: s.rol, microUsd: s.microUsd, estado: 'reservada' });
    return { ok: true, avisos: d.avisos };
  }

  async liquidar(clave: string, costoRealMicroUsd: bigint): Promise<{ avisos: ReturnType<typeof aplicarLiquidacion>['avisos'] }> {
    const r = this.reservas.get(clave);
    if (!r || r.estado !== 'reservada' || !this.estado) return { avisos: [] };
    const { estado, avisos } = aplicarLiquidacion(this.estado, r.rol, r.microUsd, costoRealMicroUsd);
    this.estado = estado;
    r.estado = 'liquidada';
    return { avisos };
  }

  async liberar(clave: string): Promise<void> {
    const r = this.reservas.get(clave);
    if (!r || r.estado !== 'reservada' || !this.estado) return;
    this.estado = aplicarLiberacion(this.estado, r.rol, r.microUsd);
    r.estado = 'liberada';
  }
}

interface TokenGuardado extends NuevoToken {
  usado: boolean;
}

export class AlmacenTokensMemoria implements AlmacenTokens {
  private readonly tokens = new Map<string, TokenGuardado>();

  constructor(private readonly generar: () => string = () => `b${randomBytes(12).toString('hex')}`) {}

  async emitir(t: NuevoToken): Promise<string> {
    const id = this.generar();
    if (Buffer.byteLength(id) > 64) throw new RangeError('callback_data excede 64 bytes');
    this.tokens.set(id, { ...t, usado: false });
    return id;
  }

  async consumir(e: { token: string; rol: RolMiembro; chatId: number; ahora: Date }): Promise<ResultadoConsumo> {
    const t = this.tokens.get(e.token);
    if (!t) return { estado: 'invalido' };
    if (!t.rolesPermitidos.includes(e.rol)) return { estado: 'no_autorizado' }; // no consume
    if (t.chatId !== e.chatId) return { estado: 'chat_distinto' };
    if (e.ahora.getTime() >= t.caducaEn.getTime()) return { estado: 'caducado' };
    if (t.usado) return { estado: 'usado' };
    t.usado = true;
    if (t.grupoExclusivo !== null) {
      for (const otro of this.tokens.values()) if (otro.grupoExclusivo === t.grupoExclusivo) otro.usado = true;
    }
    return { estado: 'ok', accion: t.accion, payload: t.payload };
  }
}

export interface Enviado extends MensajeSalida {
  messageId: number;
}

export interface Edicion {
  chatId: number;
  messageId: number;
  texto: string;
  botones: BotonEnLinea[][] | undefined;
}

export interface RespuestaCallback {
  callbackId: string;
  texto: string | null;
  alerta: boolean;
}

/** Doble de Telegram: registra todo lo que se enviaria; fallas programables. */
export class EnviadorTelegramMemoria implements EnviadorTelegram {
  readonly enviados: Enviado[] = [];
  readonly ediciones: Edicion[] = [];
  readonly callbacks: RespuestaCallback[] = [];
  readonly salidas: number[] = [];
  private siguiente = 1000;
  fallarProximos = 0;

  async enviar(m: MensajeSalida): Promise<{ messageId: number }> {
    if (this.fallarProximos > 0) {
      this.fallarProximos--;
      throw new Error('telegram caido (simulado)');
    }
    const messageId = this.siguiente++;
    this.enviados.push({ ...m, messageId });
    return { messageId };
  }

  async editar(chatId: number, messageId: number, texto: string, botones?: BotonEnLinea[][]): Promise<void> {
    this.ediciones.push({ chatId, messageId, texto, botones });
  }

  async responderCallback(callbackId: string, texto: string | null, alerta: boolean): Promise<void> {
    this.callbacks.push({ callbackId, texto, alerta });
  }

  async salirDelChat(chatId: number): Promise<void> {
    this.salidas.push(chatId);
  }

  aChat(chatId: number): Enviado[] {
    return this.enviados.filter((e) => e.chatId === chatId);
  }
}

export class CatalogoMemoria implements CatalogoAgente {
  constructor(
    private readonly c: { clientes: EntradaCatalogo[]; modelos: EntradaCatalogo[]; sabores: Record<string, EntradaCatalogo[]> },
  ) {}

  async clientes(): Promise<EntradaCatalogo[]> {
    return this.c.clientes;
  }

  async modelos(): Promise<EntradaCatalogo[]> {
    return this.c.modelos;
  }

  async saboresEnExistencia(modeloId: string): Promise<EntradaCatalogo[]> {
    return this.c.sabores[modeloId] ?? [];
  }
}
