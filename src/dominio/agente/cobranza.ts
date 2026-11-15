// Cobranza por Telegram: lo que el CODIGO (nunca el modelo) interpreta de una respuesta del socio. Codigo puro, sin red, sin base y sin reloj propio.
//   * duracion dicha en lenguaje natural ("una semana", "3 dias", "quince dias") -> numero de dias; la suma de fechas la hace SQL.
//   * la cuenta a la que entro un pago;
//   * atajos del servidor: "silenciar Cliente X 7 dias", "deshacer COB-0012", "solo recordatorio" y "extender plazo".
// El modelo de IA solo copia frases tal como las dijo el socio; el saldo, el reparto, el recargo y la fecha de "se atrasa" los pone SQL.

export const ACCIONES_COBRANZA = ['pago_total', 'pago_parcial', 'prometio', 'se_atrasa', 'aun_no', 'disputa', 'pausa', 'reanudar', 'extender_plazo'] as const;
export type AccionCobranza = (typeof ACCIONES_COBRANZA)[number];

export const CUENTAS_COBRANZA = ['angelo', 'javier', 'isaac', 'karen', 'efectivo'] as const;
export type CuentaCobranza = (typeof CUENTAS_COBRANZA)[number];

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const NUMEROS: Readonly<Record<string, number>> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  veinte: 20, treinta: 30, medio: 0,
};

/**
 * "una semana" -> 7, "3 dias" -> 3, "dos semanas" -> 14, "quince dias" -> 15. Un mes, "un rato" o una frase sin unidad no se interpretan (null): el bot pregunta cuantos dias.
 * Una cifra sola ("3") cuenta como dias solo si `numeroSoloEsDias` (cuando el bot acaba de preguntar "¿cuantos dias?").
 */
export function interpretarDuracionDias(texto: string, numeroSoloEsDias = false): number | null {
  const t = sinAcentos(texto.toLowerCase()).replace(/[.,;:!¡¿?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  const m = /\b(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta)\s*(dia|dias|semana|semanas)\b/.exec(t);
  if (m) {
    const n = /^\d/.test(m[1]!) ? Number(m[1]) : NUMEROS[m[1]!]!;
    if (n <= 0) return null;
    return /^semana/.test(m[2]!) ? n * 7 : n;
  }
  if (/\b(una semana|semana mas|ocho dias)\b/.test(t)) return /ocho/.test(t) ? 8 : 7;
  if (/\bquincena\b/.test(t)) return 15;
  if (numeroSoloEsDias && /^\d{1,3}$/.test(t)) return Number(t) > 0 ? Number(t) : null;
  return null;
}

/** La cuenta a la que entro un pago, dicha como "a la de Javier", "a Isaac", "en efectivo". null si no se entiende. */
export function interpretarCuenta(texto: string): CuentaCobranza | null {
  const t = sinAcentos(texto.toLowerCase());
  const halladas = CUENTAS_COBRANZA.filter((c) => (c === 'efectivo' ? /\befectivo\b|\bcash\b|\bcaja\b/.test(t) : new RegExp(`\\b${c}\\b`).test(t)));
  return halladas.length === 1 ? halladas[0]! : null;
}

export type AtajoCobranza =
  | { tipo: 'deshacer'; folio: string }
  | { tipo: 'silenciar'; cliente_texto: string; dias: number | null; dias_texto: string }
  | { tipo: 'reanudar'; cliente_texto: string }
  | { tipo: 'solo_recordatorio' }
  | { tipo: 'extender_plazo' };

/** Atajos que se resuelven sin IA: lo que el propio digest le ensena al socio a escribir. */
export function reconocerAtajoCobranza(texto: string, hayPreguntaExtender: boolean): AtajoCobranza | null {
  const t = sinAcentos(texto.toLowerCase()).trim().replace(/\s+/g, ' ');
  const d = /^(?:deshaz|deshacer|deshace)\s+(?:cobranza\s+)?(cob-\d{1,6})\b/.exec(t);
  if (d) return { tipo: 'deshacer', folio: d[1]!.toUpperCase() };
  const s = /^(?:silenciar|calla|callar|pausa|pausar)\s+(.+?)\s+(?:por\s+)?(\d{1,3}\s*(?:dias?|semanas?)|(?:un|una|dos|tres|cuatro|cinco|siete|diez|quince)\s*(?:dias?|semanas?))\.?$/.exec(t);
  if (s) return { tipo: 'silenciar', cliente_texto: s[1]!.replace(/^["']|["']$/g, ''), dias: interpretarDuracionDias(s[2]!), dias_texto: s[2]! };
  const r = /^(?:reanudar|reanuda|reactivar|quita la pausa de|quita la disputa de)\s+(.+)$/.exec(t);
  if (r) return { tipo: 'reanudar', cliente_texto: r[1]!.trim() };
  if (hayPreguntaExtender) {
    if (/^(?:solo|nada mas)\s+(?:el\s+|mi\s+)?recordatorio\b/.test(t) || /^recordatorio$/.test(t)) return { tipo: 'solo_recordatorio' };
    if (/^(?:extender|extiende|extiendele|extender el|ampliar)\s*(?:el\s+)?(?:plazo)?\b/.test(t) || /^si,?\s*extender\b/.test(t)) return { tipo: 'extender_plazo' };
  }
  return null;
}

/** Texto corto de una pregunta pendiente para repetirla cuando la respuesta no se entendio. */
export const PREGUNTAS_FALTANTES: Readonly<Record<string, string>> = {
  cuenta: '¿A qué cuenta entró el pago? Angelo, Javier, Isaac, Karen o Efectivo.',
  monto: '¿Cuánto pagó? Dime la cifra completa.',
  fecha: '¿Para qué fecha? Puedes decir, por ejemplo, "el jueves" o "el 25".',
  dias: '¿Cuántos días? Por ejemplo, "3 días" o "una semana".',
  motivo: '¿Cuál es el motivo? Escríbelo con tus palabras.',
  extender: 'Responde "solo recordatorio" o "extender plazo".',
  fecha_resto: '¿Para qué fecha paga el resto?',
  confirmar_monto: '¿Es correcta esa cifra? Responde sí o no.',
  confirmar_duplicado: '¿Es otro pago? Responde sí o no.',
};
