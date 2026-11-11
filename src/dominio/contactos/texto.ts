// Normalizacion de texto para comparar (nombres, colonias). Puro.

/** Sin acentos, en minusculas, solo letras y numeros separados por un espacio. */
export function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
