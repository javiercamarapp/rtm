// Modulo de COBRANZA del bot (carril bot/cobranza). Codigo nuevo y aislado: el orquestador (agente.ts) solo lo invoca en dos puntos.
//   1. interceptar: atajos del servidor ("silenciar Cliente X 7 dias", "deshacer COB-0012", "solo recordatorio", "extender plazo") y la respuesta a la pregunta que el SERVIDOR dejo abierta en el chat
//      (cuenta, cifra, fecha, dias, motivo...). Sin IA.
//   2. manejarIntencion: `cobranza_respuesta`, lo que el interprete extrae de "ya pago B", "dice que paga el jueves", "se atrasa una semana"...
// Reglas del dueno: SIN topes ni tarjeta de confirmacion (el bot pregunta lo que falte y escribe cuando tiene todo); el modelo de IA nunca calcula dinero ni fechas (el monto se lee del texto del socio,
// la fecha la resuelve el codigo y el saldo, el reparto, el recargo y la suma de fechas los pone SQL); el bot solo habla al grupo de los socios; un monto con k o mil se repite y se pregunta.
import { ACCIONES_COBRANZA, interpretarCuenta, interpretarDuracionDias, PREGUNTAS_FALTANTES, reconocerAtajoCobranza, type AccionCobranza } from '@/dominio/agente/cobranza';
import { valoresDeTexto } from '@/dominio/agente/cifras';
import { interpretarFechaPago } from '@/dominio/agente/fecha_pago';
import type { Intencion } from '@/dominio/agente/intenciones';
import { interpretarMonto, respuestaSiNo } from '@/dominio/agente/monto_conversacion';
import { resolverCliente, type EntradaCatalogo } from '@/dominio/agente/resolutor';
import type { Miembro } from '@/dominio/agente/tipos';
import { formatearMoneda } from '@/dominio/formato';

export type RespCobranza = { estado?: string; texto?: string; aviso_grupo?: string | null; folio?: string; falta?: string; siguiente?: string | null; promesa_fecha?: string | null; [k: string]: unknown };

/** La base rechazo con un mensaje claro (solo lectura, ventana de 10 minutos, identidad, validacion): se le dice tal cual al socio. */
export class RechazoCobranza extends Error {
  constructor(mensaje: string, readonly codigo: string) {
    super(mensaje);
    this.name = 'RechazoCobranza';
  }
}

/** Lo que el servidor recuerda de la pregunta abierta en un chat: que falta y los datos ya reunidos. El modelo nunca pone ni lee estos ids. */
export interface EsperaCobranza {
  clienteId: string;
  accion: AccionCobranza;
  falta: string;
  datos: Record<string, unknown>;
}

export interface PuertoCobranza {
  /** agente.cobranza_responder: verifica al socio por su id de Telegram; escribe solo con el interruptor de escritura encendido. */
  responder(clave: string, autor: Miembro, args: Record<string, unknown>): Promise<RespCobranza>;
  /** agente.cobranza_deshacer: ventana de 10 minutos, contra-registro. */
  deshacer(clave: string, autor: Miembro, folio: string): Promise<RespCobranza>;
  esperaVigente(chatId: number): Promise<EsperaCobranza | null>;
  esperaGuardar(chatId: number, autor: Miembro, e: EsperaCobranza): Promise<void>;
  esperaCerrar(chatId: number): Promise<void>;
}

export interface EntradaCobranza {
  chatId: number;
  autor: Miembro;
  texto: string;
  /** Clave base (`tg:<update_id>`): de ella salen las claves de idempotencia. */
  clave: string;
}

/** Mensajes que el bot publica en el grupo de los socios (el unico destino: nunca a clientes, proveedores ni Omar). */
export type SalidaCobranza = { textos: string[] };
const sal = (...t: Array<string | null | undefined>): SalidaCobranza => ({ textos: t.filter((x): x is string => typeof x === 'string' && x !== '') });

const palabras = (t: string): number => t.trim().split(/\s+/).length;
const pesos = (centavos: number): string => formatearMoneda(BigInt(centavos));

export class ModuloCobranza {
  constructor(
    private readonly p: PuertoCobranza,
    private readonly clientes: () => Promise<EntradaCatalogo[]> = async () => [],
    private readonly ahora: () => Date,
  ) {}

  maneja(tipo: string): boolean {
    return tipo === 'cobranza_respuesta';
  }

  private async seguro<T extends SalidaCobranza | null>(f: () => Promise<T>): Promise<T | SalidaCobranza> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof RechazoCobranza) return sal(e.message);
      throw e;
    }
  }

  // ------------------------------------------------------------------ 1. texto del socio sin IA

  async interceptar(e: EntradaCobranza): Promise<SalidaCobranza | null> {
    const espera = await this.p.esperaVigente(e.chatId);
    const atajo = reconocerAtajoCobranza(e.texto, espera?.falta === 'extender');
    if (atajo !== null) {
      return this.seguro(async () => {
        switch (atajo.tipo) {
          case 'deshacer': {
            const r = await this.p.deshacer(`${e.clave}:cd`, e.autor, atajo.folio);
            return sal(r.aviso_grupo, r.texto);
          }
          case 'silenciar':
          case 'reanudar': {
            const cli = await this.cliente(atajo.cliente_texto, e.autor);
            if (typeof cli === 'string') return sal(cli);
            if (atajo.tipo === 'reanudar') return this.ejecutar(e, cli.id, 'reanudar', {}, 'rn');
            return atajo.dias === null
              ? this.ejecutar(e, cli.id, 'pausa', {}, 'si') // sin dias claros: el servidor pregunta cuantos
              : this.ejecutar(e, cli.id, 'pausa', { dias: atajo.dias }, 'si');
          }
          case 'solo_recordatorio': {
            await this.p.esperaCerrar(e.chatId);
            return sal('Listo: queda solo como recordatorio. El plazo y el recargo no cambian.');
          }
          case 'extender_plazo': {
            const fecha = typeof espera?.datos.promesa_fecha === 'string' ? espera.datos.promesa_fecha : null;
            if (espera === null || fecha === null) return sal(PREGUNTAS_FALTANTES.fecha!);
            return this.ejecutar(e, espera.clienteId, 'extender_plazo', { fecha }, 'ex');
          }
        }
      });
    }
    if (espera === null) return null;
    return this.seguro(() => this.responderEspera(espera, e));
  }

  private async responderEspera(espera: EsperaCobranza, e: EntradaCobranza): Promise<SalidaCobranza | null> {
    const t = e.texto;
    const repetir = (): SalidaCobranza | null => (palabras(t) <= 3 && espera.falta !== 'extender' ? sal(PREGUNTAS_FALTANTES[espera.falta] ?? PREGUNTAS_FALTANTES.fecha!) : null);
    const seguir = (extra: Record<string, unknown>, accion: AccionCobranza = espera.accion) => this.ejecutar(e, espera.clienteId, accion, { ...espera.datos, ...extra }, 'es');
    switch (espera.falta) {
      case 'cuenta': {
        const c = interpretarCuenta(t);
        return c === null ? repetir() : seguir({ cuenta: c });
      }
      case 'monto': {
        const r = this.leerMonto(t, t);
        if (r.tipo === 'nada') return repetir();
        return r.tipo === 'listo' ? seguir({ monto_cent: r.centavos }) : this.confirmarMonto(e, espera, r);
      }
      case 'confirmar_monto': {
        const sn = respuestaSiNo(t);
        if (sn === 'si') return seguir({});
        if (sn === 'no') {
          const { monto_cent: _quitado, ...resto } = espera.datos;
          await this.p.esperaGuardar(e.chatId, e.autor, { ...espera, falta: 'monto', datos: resto });
          return sal('No registré nada. ¿Cuánto fue? Escribe la cifra completa.');
        }
        return repetir();
      }
      case 'fecha':
      case 'fecha_resto': {
        const f = this.leerFecha(t);
        if (f.tipo === 'ok') return seguir({ fecha: f.fecha }, espera.falta === 'fecha_resto' ? 'prometio' : espera.accion);
        return palabras(t) <= 6 ? sal(f.texto) : null;
      }
      case 'fecha_pago': {
        const f = interpretarFechaPago(t, this.ahora(), { direccion: 'pasado' });
        return f.tipo === 'ok' ? seguir({ fecha_pago: f.fecha }) : repetir();
      }
      case 'dias': {
        const d = interpretarDuracionDias(t, true);
        return d === null ? repetir() : seguir({ dias: d });
      }
      case 'motivo': {
        const m = t.trim();
        return m.length >= 3 && palabras(t) <= 40 ? seguir({ motivo: m.slice(0, 300) }) : repetir();
      }
      case 'confirmar_duplicado': {
        const sn = respuestaSiNo(t);
        if (sn === 'si') return seguir({ confirmo_duplicado: true });
        if (sn === 'no') {
          await this.p.esperaCerrar(e.chatId);
          return sal('De acuerdo, no registré otro pago.');
        }
        return repetir();
      }
      default:
        return repetir();
    }
  }

  // ------------------------------------------------------------------ 2. intencion del interprete

  async manejarIntencion(i: Intencion, e: EntradaCobranza): Promise<SalidaCobranza> {
    return this.seguro(async () => {
      if (i.tipo !== 'cobranza_respuesta' || !ACCIONES_COBRANZA.includes(i.accion)) return sal();
      const cli = await this.cliente(i.cliente_texto, e.autor);
      if (typeof cli === 'string') return sal(cli);
      const args: Record<string, unknown> = { cita: e.texto.slice(0, 200) };
      if (i.pedidos_texto.length > 0) args.pedidos = i.pedidos_texto;
      if (i.cuenta !== null) args.cuenta = i.cuenta;
      if (i.motivo !== null && i.accion === 'disputa') args.motivo = i.motivo;
      const esPago = i.accion === 'pago_total' || i.accion === 'pago_parcial';
      if (i.duracion_texto !== null) {
        const d = interpretarDuracionDias(i.duracion_texto, true);
        if (d !== null) args.dias = d;
      }
      if (i.cuando_texto !== null) {
        if (esPago) {
          const f = interpretarFechaPago(i.cuando_texto, this.ahora(), { direccion: 'pasado' });
          if (f.tipo === 'ok') args.fecha_pago = f.fecha;
        } else if (args.dias === undefined) {
          const f = this.leerFecha(i.cuando_texto);
          if (f.tipo === 'ok') args.fecha = f.fecha;
          else if (i.accion === 'prometio' || i.accion === 'extender_plazo') {
            await this.p.esperaGuardar(e.chatId, e.autor, { clienteId: cli.id, accion: i.accion, falta: 'fecha', datos: args });
            return sal(f.texto);
          }
        }
      }
      if (i.monto_texto !== null && i.accion === 'pago_parcial') {
        const r = this.leerMonto(i.monto_texto, e.texto);
        if (r.tipo === 'listo') args.monto_cent = r.centavos;
        else if (r.tipo === 'confirmar' || r.tipo === 'ambiguo') {
          const espera: EsperaCobranza = { clienteId: cli.id, accion: i.accion, falta: r.tipo === 'confirmar' ? 'confirmar_monto' : 'monto', datos: r.tipo === 'confirmar' ? { ...args, monto_cent: r.centavos } : args };
          await this.p.esperaGuardar(e.chatId, e.autor, espera);
          return sal(r.tipo === 'confirmar' ? `¿Son ${pesos(r.centavos)}? Responde sí o no antes de registrarlo.` : 'No me quedó clara la cifra. Escríbela completa, por ejemplo 1,250.');
        }
        // sin cifra en el mensaje: no se pasa nada y el servidor pregunta cuanto fue
      }
      return this.ejecutar(e, cli.id, i.accion, args, 'cr');
    });
  }

  // ------------------------------------------------------------------ comunes

  private async cliente(texto: string, autor: Miembro): Promise<{ id: string; nombre: string } | string> {
    const r = resolverCliente(texto, await this.clientes(), autor);
    if (r.estado === 'unico') return { id: r.id, nombre: r.nombre };
    if (r.estado === 'varios') return `¿De cuál cliente hablas? Puede ser ${r.candidatos.map((c) => c.nombre).join(' o ')}.`;
    return r.estado === 'vacio' ? '¿De qué cliente hablas?' : `No encontré al cliente "${texto}". Dime el nombre como está en el catálogo.`;
  }

  /** El monto sale del TEXTO del socio (nunca de una cuenta del modelo): debe aparecer en el mensaje; con k, mil o palabras se repite y se pregunta. */
  private leerMonto(frase: string, mensaje: string): { tipo: 'listo'; centavos: number } | { tipo: 'confirmar'; centavos: number } | { tipo: 'ambiguo' } | { tipo: 'nada' } {
    const m = interpretarMonto(frase);
    if (m.tipo === 'ambiguo') return { tipo: 'ambiguo' };
    if (m.tipo === 'sin_cifra') return { tipo: 'nada' };
    if (!valoresDeTexto(mensaje).has(BigInt(m.centavos))) return { tipo: 'nada' };
    return m.tipo === 'ok' ? { tipo: 'listo', centavos: m.centavos } : { tipo: 'confirmar', centavos: m.centavos };
  }

  private confirmarMonto(e: EntradaCobranza, espera: EsperaCobranza, r: { tipo: 'confirmar'; centavos: number } | { tipo: 'ambiguo' }): Promise<SalidaCobranza> {
    const nueva: EsperaCobranza = r.tipo === 'confirmar' ? { ...espera, falta: 'confirmar_monto', datos: { ...espera.datos, monto_cent: r.centavos } } : { ...espera, falta: 'monto' };
    return this.p.esperaGuardar(e.chatId, e.autor, nueva).then(() => sal(r.tipo === 'confirmar' ? `¿Son ${pesos(r.centavos)}? Responde sí o no antes de registrarlo.` : 'No me quedó clara la cifra. Escríbela completa, por ejemplo 1,250.'));
  }

  private leerFecha(texto: string): { tipo: 'ok'; fecha: string } | { tipo: 'no'; texto: string } {
    const f = interpretarFechaPago(texto, this.ahora(), { direccion: 'futuro' });
    if (f.tipo === 'ok') return { tipo: 'ok', fecha: f.fecha };
    if (f.tipo === 'pasada') return { tipo: 'no', texto: 'Esa fecha ya pasó. ¿Para qué fecha?' };
    if (f.tipo === 'ambiguo') return { tipo: 'no', texto: 'No me quedó claro el día. ¿Qué fecha exacta? Por ejemplo, "el jueves 26".' };
    return { tipo: 'no', texto: PREGUNTAS_FALTANTES.fecha! };
  }

  /** Llama a la puerta SQL y convierte su respuesta en lo que se dice al grupo; lo que falte lo deja abierto en el servidor. */
  private async ejecutar(e: EntradaCobranza, clienteId: string, accion: AccionCobranza, args: Record<string, unknown>, sufijo: string): Promise<SalidaCobranza> {
    const r = await this.p.responder(`${e.clave}:${sufijo}`, e.autor, { ...args, cliente_id: Number(clienteId), accion });
    if (r.estado === 'ok') {
      if (r.siguiente === 'extender') {
        await this.p.esperaGuardar(e.chatId, e.autor, { clienteId, accion, falta: 'extender', datos: { promesa_fecha: r.promesa_fecha ?? null } });
      } else if (r.siguiente === 'fecha_resto') {
        await this.p.esperaGuardar(e.chatId, e.autor, { clienteId, accion: 'prometio', falta: 'fecha_resto', datos: {} });
      } else {
        await this.p.esperaCerrar(e.chatId);
      }
      return sal(r.aviso_grupo);
    }
    if (r.estado === 'pregunta' || r.estado === 'duplicado') {
      await this.p.esperaGuardar(e.chatId, e.autor, { clienteId, accion, falta: String(r.falta ?? 'fecha'), datos: args });
      return sal(r.texto);
    }
    // conflicto, solo_duenio, sin_saldo: la base ya explico por que no se aplico.
    await this.p.esperaCerrar(e.chatId);
    return sal(r.texto);
  }
}
