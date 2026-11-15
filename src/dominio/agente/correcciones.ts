// Frases con las que un socio corrige o cancela en medio de una conversacion: "no, era X", "cambia el monto a Y", "mejor a credito", "cancela".
// Codigo puro, sin IA: devuelve QUE slot cambia (o cual era el ultimo) y el texto nuevo; la maquina vuelve a interpretar ese texto con el parser del slot.
import { normalizar } from '../catalogo/normalizar';
import type { DefSlot } from './slots';

export type Correccion =
  | { tipo: 'cancelar' }
  /** "mejor a credito", "mejor de contado": reescribe la modalidad. */
  | { tipo: 'modalidad'; valor: 'contado' | 'credito' }
  /** "cambia el monto a 5000": el slot se nombra. */
  | { tipo: 'slot'; slot: string; texto: string }
  /** "no, era mango": reescribe el ultimo dato que se acaba de llenar. */
  | { tipo: 'ultimo'; texto: string };

const CANCELAR = /^(cancela(r|lo|la)?|cancelalo|olvidalo|olvidala|dejalo|ya no|no lo registres|no registres nada|mejor no|aborta|abortar|detente|para)(\s+(todo|eso|esto|la operacion|el pedido|el cobro|ya))?[.!]*$/;

export function detectarCorreccion(texto: string, slots: readonly DefSlot[]): Correccion | null {
  const t = normalizar(texto);
  if (t === '') return null;
  if (CANCELAR.test(t)) return { tipo: 'cancelar' };
  if (/^(mejor|ahora)\s+(a|de)\s+credito$/.test(t) || /^(mejor|ahora)\s+credito$/.test(t)) return { tipo: 'modalidad', valor: 'credito' };
  if (/^(mejor|ahora)\s+(a|de)\s+contado$/.test(t) || /^(mejor|ahora)\s+contado$/.test(t)) return { tipo: 'modalidad', valor: 'contado' };
  // "cambia el monto a 5000" | "corrige el cliente por Memo" | "el monto es 5000" | "pon el plazo en 15 dias"
  const orig = texto.trim();
  const m = /^(?:cambia(?:lo)?|corrige|cambiale|modifica|pon|ponle|actualiza)\s+(?:el|la|los|las)?\s*([\p{L} ]+?)\s+(?:a|por|en|con)\s+(.+)$/iu.exec(orig) ?? /^(?:el|la|los|las)\s+([\p{L} ]+?)\s+(?:es|son|era|eran|fue|fueron)\s+(.+)$/iu.exec(orig);
  if (m) {
    const nombre = normalizar(m[1]!);
    const def = slots.find((s) => s.clave === nombre.replace(/ /g, '_') || (s.sinonimos ?? []).some((x) => normalizar(x) === nombre));
    if (def) return { tipo: 'slot', slot: def.clave, texto: m[2]!.trim() };
  }
  // "no, era X" | "no es X" | "no fue X sino Y" | "perdon, es X"
  const n = /^(?:no|perdon|perdona|error)[\s,.:;-]+(?:(?:era|es|fue|son|eran|quise decir|queria decir|me refiero a|digo)\s+)(.+)$/iu.exec(orig);
  if (n) return { tipo: 'ultimo', texto: n[1]!.replace(/^(?:el|la|los|las)\s+/i, (x) => x).trim() };
  return null;
}
