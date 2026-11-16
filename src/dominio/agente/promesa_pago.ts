// Guardia determinista contra una confusion real (16-nov): "GDL PAGA el viernes LOS 4,000" es una PROMESA de pago futura (cobranza: prometio, fecha el viernes), pero el modelo la leyo
// como un pago ya hecho y el bot pregunto "¿a qué cuenta entró?". Esta guardia corrige la salida del modelo SIN IA: si el mensaje habla de un pago FUTURO con fecha y no hay
// ninguna marca de pago ya hecho, la accion 'pago' se vuelve cobranza_respuesta 'prometio'. Es pura: no toca dinero ni escribe; solo cambia que flujo atiende el mensaje.
import type { RespuestaExtractor } from './intenciones';
import type { ICobranzaRespuesta } from './intenciones_ampliadas';

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normal = (t: string): string => sinAcentos(t.toLowerCase()).replace(/\s+/g, ' ').trim();

// Verbos de futuro o promesa ("paga", "pagara", "va a pagar", "me paga", "dice que paga", "promete pagar").
const FUTURO = /\b(?:paga|pagan|pagara|pagaran|pagaria|va a pagar|van a pagar|me paga|me pagan|nos paga|nos pagan|promete pagar|prometio pagar|prometen pagar|dice que paga|dijo que paga|dicen que pagan|quedo de pagar|quedaron de pagar)\b/;
// Fecha o momento futuro.
const CUANDO = /\b((?:el|este|para el|hasta el)\s+(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2}(?:\s+de\s+[a-z]+)?)|pasado manana|manana|hoy mismo|la proxima semana|la semana que entra|en\s+\d{1,2}\s+dias?|en una semana)\b/;
// Marcas de pago YA hecho: si aparecen, no es una promesa.
const YA_PAGO = /\b(?:ya pago|ya pagaron|ya pagamos|ya deposito|ya depositaron|ya transfirio|ya cayo|ya me pago|ya nos pago|me deposito|me deposit[oa]ron|me cayo|nos cayo|pago ayer|pago hoy|pagaron ayer|liquido|liquidaron|me transfirio|me transfirieron|dejo el pago|dejaron el pago)\b/;

/** Devuelve la frase de fecha ("el viernes") si el texto es una promesa de pago futura; null si no lo es. */
export function promesaDePago(texto: string): string | null {
  const t = normal(texto);
  if (YA_PAGO.test(t) || !FUTURO.test(t)) return null;
  const m = CUANDO.exec(t);
  return m ? m[1]! : null;
}

/** Cambia las acciones 'pago' del modelo por 'cobranza_respuesta: prometio' cuando el mensaje es una promesa futura. El resto de la respuesta queda igual. */
export function corregirPromesasDePago(r: RespuestaExtractor, texto: string): RespuestaExtractor {
  const cuando = promesaDePago(texto);
  if (cuando === null || !r.acciones.some((a) => a.tipo === 'pago')) return r;
  return {
    ...r,
    acciones: r.acciones.map((a) => {
      if (a.tipo !== 'pago') return a;
      const prometio: ICobranzaRespuesta = {
        tipo: 'cobranza_respuesta', accion: 'prometio', cliente_texto: a.cliente_texto, pedidos_texto: a.pedido_folio ? [a.pedido_folio] : [], monto_texto: null,
        cuenta: null, cuando_texto: cuando, duracion_texto: null, motivo: null, fuente_cita: a.fuente_cita,
      };
      return prometio;
    }),
  };
}
