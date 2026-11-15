// Textos de modelo que SIEMPRE se preguntan (decision del dueno, 14-nov). Codigo puro: el modelo de lenguaje nunca elige.
// Espejo de `ambiguos` en scripts/catalogo/alias-waka.json (una prueba comprueba que no se desvian) y de los alias
// ambiguos de catalogo.modelo_alias (migracion 20261118400000). Las opciones son NOMBRES de modelo del catalogo; `etiqueta`
// es solo el texto del boton cuando el nombre del catalogo no dice por si solo cual es (el id que se registra es siempre el del modelo).
import { normalizar } from '../catalogo/normalizar';

export interface OpcionAmbigua {
  modelo: string;
  etiqueta?: string;
}

export interface TextoAmbiguo {
  /** Textos (ya normalizados al comparar) que disparan la pregunta. */
  textos: readonly string[];
  opciones: readonly OpcionAmbigua[];
  /** Forma corta de la pregunta, para documentacion y pruebas. */
  pregunta: string;
}

export const TEXTOS_AMBIGUOS_MODELO: readonly TextoAmbiguo[] = [
  { textos: ['waka 50', 'waka 50k'], opciones: [{ modelo: 'Waka Jupiter 50K' }, { modelo: 'Waka Icon 50K' }], pregunta: 'Jupiter o Icon' },
  { textos: ['waka 15', 'waka 15k'], opciones: [{ modelo: 'Waka 15K', etiqueta: 'Waka SoPro 15K' }, { modelo: 'Waka DM 15K' }], pregunta: 'SoPro o DM' },
  { textos: ['waka sopro 30k'], opciones: [{ modelo: 'Waka 30K' }, { modelo: 'Waka Titan 30K' }], pregunta: 'Waka 30K o Titan 30K' },
];

/** El grupo ambiguo al que pertenece el texto, o null. */
export function textoAmbiguo(texto: string): TextoAmbiguo | null {
  const q = normalizar(texto);
  return TEXTOS_AMBIGUOS_MODELO.find((t) => t.textos.includes(q)) ?? null;
}
