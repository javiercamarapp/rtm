// Texto de un PDF tabular (salida de `pdftotext -layout`) a la tabla estandar. Puro.
// Cada fila util trae un indice y, separado por 2 o mas espacios, el telefono (con espacios o guiones) y quiza un nombre.

const FILA = /^\s*(\d{1,5})(?:\s{2,}|\t+)(\S.*)$/;
const TEXTO = /\p{L}[\p{L}\s.'-]*/gu;

/** Una fila por renglon con indice; los renglones sin indice (encabezados, saltos de pagina) se ignoran. Renglones con indice y sin nada mas se descartan aguas abajo como sin telefono. */
export function tablaDeTextoPdf(texto: string): string[][] {
  const filas: string[][] = [];
  for (const l of texto.replace(/\f/g, '\n').split(/\r?\n/)) {
    const m = FILA.exec(l);
    if (!m) continue;
    const resto = m[2]!.trim();
    const nombre = (resto.match(TEXTO) ?? []).join(' ').replace(/\s+/g, ' ').trim();
    const telefono = resto.replace(TEXTO, ' ').replace(/\s+/g, ' ').trim();
    filas.push([nombre, telefono]);
  }
  return [['First Name', 'Phone 1 - Value'], ...filas];
}
