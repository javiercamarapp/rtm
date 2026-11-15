// Avisos de inventario, compras, proveedores, clientes y pedidos (carril AVISOS-INVENTARIO). Dos piezas:
//   1. ejecutarRelojAvisos: lo que el reloj llama cada pasada. Arma cada ventana en SQL (techo de mensajes, silencio nocturno, inmediatos limitados), redacta con plantillas y manda UN mensaje
//      por ventana al grupo de los socios por el transporte recibido (en pruebas, falso). Si el envio falla, lo pendiente se queda en la cola. El interruptor general nace APAGADO.
//   2. ModuloInventarioBot: los comandos /vende, /reponer, /minimo y /avisos y la respuesta a la pregunta abierta de /minimo. Solo socios; solo texto de plantillas con cifras de SQL.
// El modelo de IA no interviene y nada aqui calcula dinero. El bot nunca escribe a clientes, proveedores ni Omar.
import { redactarMensaje, ventanasDelMomento, type DigestArmado, type VentanaAviso } from '@/dominio/agente/avisos_inventario';
import type { Miembro } from '@/dominio/agente/tipos';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { SalidaAprendizaje } from './aprendizaje';

export type LineaConsulta = { etiqueta: string; piezas?: number; centavos?: number; texto?: string };
export type RespInventario = { estado?: string; texto?: string; aviso_grupo?: string | null; [k: string]: unknown };

/** La base rechazo con un mensaje claro (identidad, solo lectura, validacion): se le dice tal cual al socio. */
export class RechazoInventario extends Error {
  constructor(mensaje: string, readonly codigo: string) {
    super(mensaje);
  }
}

export interface PuertoAvisosInventario {
  /** `fusion`: el reporte del reloj de esa hora (pendientes 09:00, resumen 20:00) pide las lineas para llevarlas en SU mensaje. */
  armar(ventana: VentanaAviso, ahora: Date, fusion?: boolean): Promise<DigestArmado>;
  confirmar(ventana: VentanaAviso, ids: number[], ahora: Date, fusion?: boolean): Promise<number | null>;
  consulta(tipo: 'mas_vendido' | 'reponer'): Promise<{ titulo: string; lineas: LineaConsulta[] }>;
  hayPregunta(chatId: number, autor: Miembro): Promise<boolean>;
  minimoPaso(clave: string, autor: Miembro, chatId: number, texto: string): Promise<RespInventario>;
  fijarAvisos(clave: string, autor: Miembro, activo: boolean, regla: string | null): Promise<RespInventario>;
}

/** Transporte al grupo de los socios (el unico destino). Devuelve true si el mensaje salio. */
export interface TransporteGrupo {
  aGrupo(texto: string): Promise<boolean>;
}

export interface ResultadoReloj {
  /** Mensajes enviados en esta pasada, por ventana. */
  enviados: Array<{ ventana: VentanaAviso; items: number; texto: string }>;
  apagado: boolean;
}

export async function ejecutarRelojAvisos(p: PuertoAvisosInventario, t: TransporteGrupo, ahora: Date): Promise<ResultadoReloj> {
  const out: ResultadoReloj = { enviados: [], apagado: false };
  for (const ventana of ventanasDelMomento(ahora)) {
    const d = await p.armar(ventana, ahora);
    if (d.estado === 'apagado') {
      out.apagado = true;
      return out;
    }
    // 'fusionado': esa ventana viaja dentro del reporte del reloj (un solo digest); aqui no se manda mensaje propio.
    if (d.estado !== 'ok') continue;
    const texto = redactarMensaje(ventana, d.items, d.restantes);
    if (texto === null) continue;
    // Se confirma SOLO si salio: un fallo de envio deja los avisos pendientes para la siguiente pasada.
    const salio = await t.aGrupo(texto);
    if (!salio) continue;
    await p.confirmar(ventana, d.items.map((i) => i.id), ahora);
    out.enviados.push({ ventana, items: d.items.length, texto });
  }
  return out;
}

// ---------------------------------------------------------------- comandos del bot

const sal = (...textos: Array<string | null | undefined>): SalidaAprendizaje => ({ textos: textos.filter((t): t is string => typeof t === 'string' && t !== '') });

const AYUDA_AVISOS = 'Uso: /avisos encender | /avisos apagar | /avisos regla CODIGO encender|apagar. Los avisos de inventario nacen apagados.';

function formatearConsulta(titulo: string, lineas: LineaConsulta[]): string {
  const cuerpo = lineas.map((l) => `- ${l.etiqueta}: ${l.piezas !== undefined ? `${l.piezas} pz` : l.centavos !== undefined ? String(l.centavos) : (l.texto ?? '')}`).join('\n');
  return `${titulo}\n${cuerpo}`;
}

const FRASES_VENDE = ['que se vende', 'que vendemos', 'que es lo que mas se vende', 'lo mas vendido', 'mas vendidos'];
const FRASES_REPONER = ['que reponer', 'que debo reponer', 'que hay que reponer', 'que repongo', 'que falta reponer'];

export class ModuloInventarioBot {
  constructor(private readonly p: PuertoAvisosInventario) {}

  private async seguro(f: () => Promise<SalidaAprendizaje>): Promise<SalidaAprendizaje> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof RechazoInventario) return sal(e.message);
      throw e;
    }
  }

  /** Devuelve null cuando el mensaje no es de este modulo (el agente sigue su camino normal). Solo para socios: el llamador ya lo verifica y la base lo vuelve a verificar. */
  async interceptar(e: { chatId: number; autor: Miembro; texto: string; clave: string }): Promise<SalidaAprendizaje | null> {
    const crudo = e.texto.trim();
    const n = normalizar(crudo.replace(/[¿?!¡]/g, ''));
    if (/^\/vende(\s|$)/.test(crudo.toLowerCase()) || FRASES_VENDE.includes(n)) {
      return this.seguro(async () => {
        const r = await this.p.consulta('mas_vendido');
        return sal(formatearConsulta(r.titulo, r.lineas));
      });
    }
    if (/^\/reponer(\s|$)/.test(crudo.toLowerCase()) || FRASES_REPONER.includes(n)) {
      return this.seguro(async () => {
        const r = await this.p.consulta('reponer');
        return sal(formatearConsulta(r.titulo, r.lineas));
      });
    }
    const mAvisos = /^\/avisos(?:\s+(.*))?$/i.exec(crudo);
    if (mAvisos) {
      return this.seguro(async () => {
        const partes = (mAvisos[1] ?? '').toLowerCase().trim().split(/\s+/).filter((x) => x !== '');
        const on = (w: string | undefined): boolean | null => (w === 'encender' || w === 'on' || w === 'activar' ? true : w === 'apagar' || w === 'off' || w === 'desactivar' ? false : null);
        if (partes.length === 1 && on(partes[0]) !== null) {
          const r = await this.p.fijarAvisos(`${e.clave}:av`, e.autor, on(partes[0])!, null);
          return sal(r.activo === true ? 'Avisos de inventario ENCENDIDOS. Cada regla se enciende por separado con /avisos regla CODIGO encender.' : 'Avisos de inventario APAGADOS.');
        }
        if (partes.length === 3 && partes[0] === 'regla' && on(partes[2]) !== null) {
          const r = await this.p.fijarAvisos(`${e.clave}:av`, e.autor, on(partes[2])!, partes[1]!.replace(/-/g, '_'));
          return sal(`Regla ${String(r.regla ?? partes[1])} ${r.activo === true ? 'ENCENDIDA' : 'APAGADA'}.`);
        }
        return sal(AYUDA_AVISOS);
      });
    }
    const mMin = /^\/minimo(?:\s+(.*))?$/i.exec(crudo);
    // La respuesta a la pregunta abierta es corta (modelo, sabor o cifra): un mensaje largo es otra cosa y sigue su camino.
    const corto = crudo.split(/\s+/).length <= 4;
    const pendiente = mMin || crudo.startsWith('/') || !corto ? false : await this.p.hayPregunta(e.chatId, e.autor);
    if (mMin || pendiente) {
      return this.seguro(async () => {
        const r = await this.p.minimoPaso(`${e.clave}:min`, e.autor, e.chatId, mMin ? (mMin[1] ?? '') : crudo);
        return sal(r.texto, r.aviso_grupo);
      });
    }
    return null;
  }
}
