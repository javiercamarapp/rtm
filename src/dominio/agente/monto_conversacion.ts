// Interpretacion de un monto dicho en una conversacion (decision del dueno, 14-nov): un monto escrito con «k», con «mil» o con palabras NO se registra de inmediato:
// el bot repite la cifra interpretada y pregunta si son, por ejemplo, 20,000 antes de registrar. Un monto ambiguo ("1.250") se pide de nuevo. Sin tope de monto.
// Codigo puro: el modelo de IA nunca calcula dinero; aqui solo se lee la cifra que el socio escribio.
import { parsearPrecio, valoresDeTexto } from './cifras';

export type MontoInterpretado =
  /** Cifra completa y clara ("12,500", "$1,250.50"): se acepta tal cual. */
  | { tipo: 'ok'; centavos: number }
  /** Cifra que hay que repetir al socio antes de aceptarla ("20k", "20 mil", "veinte mil"). */
  | { tipo: 'confirmar'; centavos: number; motivo: 'sufijo' | 'palabras' }
  /** Formato que cambia de significado segun la convencion ("1.250", "1,5"). */
  | { tipo: 'ambiguo' }
  | { tipo: 'sin_cifra' };

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "12,500" o "20k" o "veinte mil" o "sin envio" (cero solo si el slot lo permite). */
export function interpretarMonto(texto: string, opciones: { permitirCero?: boolean } = {}): MontoInterpretado {
  const t = sinAcentos(texto.toLowerCase()).trim();
  if (opciones.permitirCero && /^(sin\s+envio|sin|no|nada|cero|0)$/.test(t.replace(/[.,;:!]/g, '').trim())) return { tipo: 'ok', centavos: 0 };
  const hayDigitos = /\d/.test(t);
  const p = parsearPrecio(t);
  if (!p.ok) {
    if (p.motivo === 'ambiguo') return { tipo: 'ambiguo' };
    return { tipo: 'sin_cifra' };
  }
  if (!hayDigitos) return { tipo: 'confirmar', centavos: p.centavos, motivo: 'palabras' };
  if (/\d\s*(k|mil|millon|millones)\b/.test(t) || /\b(mil|millon|millones)\b/.test(t)) return { tipo: 'confirmar', centavos: p.centavos, motivo: 'sufijo' };
  return { tipo: 'ok', centavos: p.centavos };
}

/**
 * Un monto que el extractor devolvio (centavos) frente al texto original del socio: si el texto solo lo explica con k, mil o palabras, hay que confirmarlo;
 * si el texto no contiene la cifra, se pregunta de nuevo (cifra sin procedencia).
 */
export function montoDeExtraccion(fuente: string, centavos: number): MontoInterpretado {
  const valor = BigInt(centavos);
  if (!valoresDeTexto(fuente).has(valor)) return { tipo: 'sin_cifra' };
  const t = sinAcentos(fuente.toLowerCase());
  const tokens = [...t.matchAll(/\d[\d.,]*(?:\s*(?:k|mil|millones|millon)\b)?/g)].map((m) => m[0]).filter((tok) => valoresDeTexto(tok).has(valor));
  if (tokens.length === 0) return { tipo: 'confirmar', centavos, motivo: 'palabras' };
  if (tokens.every((tok) => /\b(k|mil|millon|millones)\b|\dk\b/.test(tok))) return { tipo: 'confirmar', centavos, motivo: 'sufijo' };
  if (tokens.every((tok) => parsearPrecio(/\d[\d.,]*/.exec(tok)![0]).ok === false)) return { tipo: 'ambiguo' };
  return { tipo: 'ok', centavos };
}

/** "si", "no", "correcto"... para contestar una confirmacion. */
export function respuestaSiNo(texto: string): 'si' | 'no' | null {
  const t = sinAcentos(texto.toLowerCase()).replace(/[.,;:!¡¿?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  if (/^(si|sip|simon|claro|correcto|exacto|asi es|dale|ok|va|afirmativo|son|es correcto|sí)\b/.test(t) && !/\bno\b/.test(t)) return 'si';
  if (/^(no|nel|nop|negativo|incorrecto|no son|no es|para nada)\b/.test(t)) return 'no';
  return null;
}
