// Normalizacion unica de nombres (misma regla que catalogo.normalizar en SQL): minusculas, sin acentos, solo letras y numeros.
const DE = 'áàäâéèëêíìïîóòöôúùüûñ';
const A = 'aaaaeeeeiiiioooouuuun';

export function normalizar(texto: string): string {
  let t = texto.toLowerCase();
  let salida = '';
  for (const ch of t) {
    const i = DE.indexOf(ch);
    salida += i >= 0 ? A[i] : ch;
  }
  t = salida;
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}
