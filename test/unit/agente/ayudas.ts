// Ayudas de las pruebas del agente: escenario en memoria con LLM guionado, y constructores de acciones validas.
import { crearAgenteEnMemoria, type AgenteEnMemoria, type OpcionesAgenteEnMemoria } from '@/composicion/agente';
import type { Intencion, RespuestaExtractor } from '@/dominio/agente/intenciones';
import { LlmGuionado, respuesta, type SalidaGuionada } from '@/infra/agente/llm_simulado';
import type { Enviado } from '@/infra/agente/memoria';
import { updateBoton, updateTexto, IDS_SIMULADOS } from '@/infra/agente/updates';
import type { ResultadoUpdate } from '@/aplicacion/agente/agente';

export const IDS = IDS_SIMULADOS;

export interface Escenario extends AgenteEnMemoria {
  llmGuionado: LlmGuionado;
  /** Un socio escribe en el grupo. */
  socio(quien: 'angelo' | 'javier', texto: string, extra?: { updateId?: number; messageId?: number; edicion?: boolean; reenviado?: boolean; foto?: boolean | { fileId: string; fileUniqueId: string } }): Promise<ResultadoUpdate>;
  /** Omar escribe en su chat privado. */
  omar(texto: string): Promise<ResultadoUpdate>;
  /** Pulsa un boton de un mensaje enviado. */
  pulsar(de: number, chat: number, enviado: Enviado, fila: number, col?: number): Promise<ResultadoUpdate>;
  grupo(): Enviado[];
  aOmar(): Enviado[];
  textosGrupo(): string[];
  textosOmar(): string[];
  ultimoGrupo(): Enviado;
}

export function escenario(salidas: SalidaGuionada[] = [respuesta([{ tipo: 'ninguna' }])], op: Omit<OpcionesAgenteEnMemoria, 'llm'> & { costoMicroUsd?: bigint } = {}): Escenario {
  const llmGuionado = new LlmGuionado(salidas, op.costoMicroUsd ?? 120n);
  // Las pruebas anteriores al modo de los socios esperan el registro directo con eco y Deshacer; el modo estricto se prueba con `confirmarMovimientos: true`.
  const h = crearAgenteEnMemoria({ ...op, config: { confirmarMovimientos: false, ...op.config }, llm: llmGuionado });
  const e: Escenario = {
    ...h,
    llmGuionado,
    socio: (quien, texto, extra = {}) => h.agente.procesarUpdate(updateTexto(h.contador, { de: IDS[quien], chat: IDS.grupoSocios, texto, ...extra })),
    omar: (texto) => h.agente.procesarUpdate(updateTexto(h.contador, { de: IDS.omar, chat: IDS.privadoOmar, texto })),
    pulsar: (de, chat, enviado, fila, col = 0) => {
      const boton = enviado.botones?.[fila]?.[col];
      if (!boton) throw new Error(`el mensaje no tiene boton ${fila},${col}`);
      return h.agente.procesarUpdate(updateBoton(h.contador, { de, chat, messageId: enviado.messageId, data: boton.callbackData }));
    },
    grupo: () => h.telegram.aChat(IDS.grupoSocios),
    aOmar: () => h.telegram.aChat(IDS.privadoOmar),
    textosGrupo: () => h.telegram.aChat(IDS.grupoSocios).map((m) => m.texto),
    textosOmar: () => h.telegram.aChat(IDS.privadoOmar).map((m) => m.texto),
    ultimoGrupo: () => {
      const g = h.telegram.aChat(IDS.grupoSocios);
      const u = g[g.length - 1];
      if (!u) throw new Error('el grupo no ha recibido mensajes');
      return u;
    },
  };
  return e;
}

export function pedido(cliente: string, lineas: Array<[string, number] | [string, number, string | null, string]>, extra: Partial<Extract<Intencion, { tipo: 'pedido' }>> = {}): Intencion {
  return {
    tipo: 'pedido',
    cliente_texto: cliente,
    destino_texto: null,
    lineas: lineas.map((l) => ({ modelo_texto: l[0], sabor_texto: l[2] ?? null, piezas: l[1], precio_texto: (l as [string, number, string | null, string])[3] ?? null, fuente_cita: 'cita' })),
    envio_cobrado_centavos: null,
    plazo_texto: 'de contado', // pruebas generales (el cfg exigirPlazoPedido va apagado); las del plazo obligatorio lo prueban con el cfg encendido
    fuente_cita: 'cita',
    ...extra,
  };
}

/** Sin tarjeta, un cobro sin cuenta se PREGUNTA antes de escribir (decision 14-nov); las pruebas que no tratan ese dato mandan la cuenta completa. */
export const pago = (cliente: string, centavos: number, cuenta: string | null = 'Efectivo'): Intencion => ({ tipo: 'pago', cliente_texto: cliente, monto_centavos: centavos, cuenta_destino_texto: cuenta, pedido_folio: null, fuente_cita: 'cita' });
export const toma = (lineas: Array<[string, number, string | null]>): Intencion => ({
  tipo: 'toma_omar',
  lineas: lineas.map(([m, p, s]) => ({ modelo_texto: m, sabor_texto: s, piezas: p })),
  fuente_cita: 'cita',
});
export const consulta = (c: Extract<Intencion, { tipo: 'consulta' }>['consulta'], extra: Partial<Extract<Intencion, { tipo: 'consulta' }>> = {}): Intencion => ({
  tipo: 'consulta',
  consulta: c,
  modelo_texto: null,
  sabor_texto: null,
  sujeto_texto: null,
  folio: null,
  periodo: null,
  ...extra,
});

export const unaAccion = (a: Intencion, extra: Partial<RespuestaExtractor> = {}): RespuestaExtractor => respuesta([a], extra);

export function todosLosNumeros(texto: string): string[] {
  return [...texto.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]+$/, ''));
}
