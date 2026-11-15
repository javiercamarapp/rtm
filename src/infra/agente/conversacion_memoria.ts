// Almacen de conversaciones en memoria: misma semantica que agente.conversacion_* (idempotencia por clave, una conversacion viva por chat y autor, caducidad perezosa de 30 minutos).
// Sirve a las pruebas de conversacion simulada y al modo sin base. La base real es la fuente de verdad (ver conversacion_postgres.ts).
import { slotsFaltantes, type OperacionConv } from '@/dominio/agente/slots';
import type { AlmacenConversacion, BotonConv, ContextoConv, ConversacionVista, ResultadoAbrir } from '@/aplicacion/agente/conversacion';

interface Fila extends ConversacionVista {
  clave: string;
  actualizada: Date;
  espera: number;
  motivoCierre: string | null;
  folio: string | null;
  reemplazoCrudo: ConversacionVista['reemplazo'];
}

export class AlmacenConversacionMemoria implements AlmacenConversacion {
  readonly filas: Fila[] = [];
  private readonly vistos = new Map<string, unknown>();
  private sig = 1;
  /** Reloj inyectable (las pruebas lo adelantan para simular los 30 minutos de silencio). */
  constructor(public ahora: () => Date = () => new Date(), private readonly esperaMin = 30) {}

  private vivas(chatId: number, autor: string): Fila | undefined {
    const f = this.filas.find((x) => x.chatId === chatId && x.autor === autor && (x.estado === 'abierta' || x.estado === 'completa'));
    if (f && f.expiraAt.getTime() <= this.ahora().getTime()) {
      f.estado = 'expirada';
      f.motivoCierre = `sin respuesta en ${f.espera} minutos`;
      return undefined;
    }
    return f;
  }

  private vista(f: Fila): ConversacionVista {
    return { id: f.id, chatId: f.chatId, autor: f.autor, operacion: f.operacion, estado: f.estado, slots: structuredClone(f.slots), faltantes: [...f.faltantes], contexto: structuredClone(f.contexto), pregunta: f.pregunta ? { ...f.pregunta } : null, reemplazo: f.reemplazoCrudo, expiraAt: f.expiraAt };
  }

  private una<T>(clave: string, fn: () => T): T {
    if (this.vistos.has(clave)) return this.vistos.get(clave) as T;
    const r = fn();
    this.vistos.set(clave, r);
    return r;
  }

  private porId(id: number): Fila {
    const f = this.filas.find((x) => x.id === id);
    if (!f) throw new Error('conversacion desconocida');
    return f;
  }

  private tocar(f: Fila): void {
    f.actualizada = this.ahora();
    f.expiraAt = new Date(f.actualizada.getTime() + f.espera * 60_000);
  }

  async obtener(chatId: number, autor: string): Promise<ConversacionVista | null> {
    const f = this.vivas(chatId, autor);
    return f ? this.vista(f) : null;
  }

  async abrir(a: Parameters<AlmacenConversacion['abrir']>[0]): Promise<ResultadoAbrir> {
    return this.una(a.clave, () => {
      const viva = this.vivas(a.chatId, a.autor);
      if (viva) {
        viva.reemplazoCrudo = { operacion: a.operacion, slots: a.slots, contexto: a.contexto as Record<string, unknown>, mensaje: a.mensaje };
        return { estado: 'conflicto', abierta: this.vista(viva) } as ResultadoAbrir;
      }
      const falt = slotsFaltantes(a.operacion, a.slots);
      const ahora = this.ahora();
      const f: Fila = {
        id: this.sig++, chatId: a.chatId, autor: a.autor, operacion: a.operacion, estado: falt.length === 0 ? 'completa' : 'abierta', slots: structuredClone(a.slots), faltantes: falt,
        contexto: structuredClone(a.contexto), pregunta: null, reemplazo: null, expiraAt: new Date(ahora.getTime() + this.esperaMin * 60_000), clave: a.clave, actualizada: ahora, espera: this.esperaMin,
        motivoCierre: null, folio: null, reemplazoCrudo: null,
      };
      this.filas.push(f);
      return { estado: 'abierta', conversacion: this.vista(f) } as ResultadoAbrir;
    });
  }

  async reemplazar(a: { clave: string; chatId: number; autor: string }): Promise<ConversacionVista> {
    return this.una(a.clave, () => {
      const viva = this.vivas(a.chatId, a.autor);
      if (!viva || !viva.reemplazoCrudo) throw new Error('no hay una instruccion nueva guardada');
      const r = viva.reemplazoCrudo;
      viva.estado = 'cancelada';
      viva.motivoCierre = 'reemplazada por una instruccion nueva';
      const ahora = this.ahora();
      const slots = r.slots;
      const falt = slotsFaltantes(r.operacion as OperacionConv, slots);
      const f: Fila = {
        id: this.sig++, chatId: a.chatId, autor: a.autor, operacion: r.operacion as OperacionConv, estado: falt.length === 0 ? 'completa' : 'abierta', slots: structuredClone(slots), faltantes: falt,
        contexto: structuredClone(r.contexto) as ContextoConv, pregunta: null, reemplazo: null, expiraAt: new Date(ahora.getTime() + this.esperaMin * 60_000), clave: a.clave, actualizada: ahora, espera: this.esperaMin,
        motivoCierre: null, folio: null, reemplazoCrudo: null,
      };
      this.filas.push(f);
      return this.vista(f);
    });
  }

  async completarSlot(a: Parameters<AlmacenConversacion['completarSlot']>[0]) {
    return this.una(a.clave, () => {
      const f = this.porId(a.id);
      if ((f.estado === 'abierta' || f.estado === 'completa') && f.expiraAt.getTime() <= this.ahora().getTime()) {
        f.estado = 'expirada';
        f.motivoCierre = `sin respuesta en ${f.espera} minutos`;
      }
      if (f.estado !== 'abierta' && f.estado !== 'completa') return { estado: f.estado, conversacion: this.vista(f) };
      if (a.valor === null || a.valor === undefined) delete f.slots[a.slot];
      else f.slots[a.slot] = structuredClone(a.valor);
      f.faltantes = slotsFaltantes(f.operacion, f.slots);
      f.estado = f.faltantes.length === 0 ? 'completa' : 'abierta';
      if (a.contexto) f.contexto = structuredClone(a.contexto);
      if (f.pregunta?.slot === a.slot) f.pregunta = null;
      f.reemplazoCrudo = null;
      this.tocar(f);
      return { estado: f.estado, conversacion: this.vista(f) };
    });
  }

  async fijarPregunta(a: Parameters<AlmacenConversacion['fijarPregunta']>[0]): Promise<ConversacionVista> {
    return this.una(a.clave, () => {
      const f = this.porId(a.id);
      if (f.estado === 'abierta' || f.estado === 'completa') {
        f.pregunta = { slot: a.slot, texto: a.texto, opciones: a.opciones as BotonConv[] | null, mensajeId: a.mensajeId ?? null };
        f.contexto = structuredClone(a.contexto);
      }
      return this.vista(f);
    });
  }

  async cancelar(a: { clave: string; id: number; motivo: string }): Promise<void> {
    this.una(a.clave, () => {
      const f = this.porId(a.id);
      if (f.estado === 'abierta' || f.estado === 'completa') {
        f.estado = 'cancelada';
        f.motivoCierre = a.motivo;
        f.reemplazoCrudo = null;
      }
      return true;
    });
  }

  async registrada(a: { clave: string; id: number; folio: string }): Promise<void> {
    this.una(a.clave, () => {
      const f = this.porId(a.id);
      if (f.estado !== 'completa') throw new Error(`solo se registra una conversacion completa (estado: ${f.estado})`);
      f.estado = 'registrada';
      f.folio = a.folio;
      return true;
    });
  }
}
