// Lectura de texto tabular (CSV) sin dependencias: decodifica UTF-8 o UTF-16 (con o sin BOM) y separa filas y celdas (comillas RFC 4180).

/** Decodifica bytes detectando BOM UTF-8, UTF-16 LE/BE; sin BOM, detecta UTF-16 por la densidad de ceros alternados. */
export function decodificarTexto(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  const muestra = Math.min(bytes.length, 200);
  let cerosPares = 0;
  let cerosImpares = 0;
  for (let i = 0; i < muestra; i++) if (bytes[i] === 0) { if (i % 2 === 0) cerosPares++; else cerosImpares++; }
  if (cerosImpares > muestra / 4 && cerosPares === 0) return new TextDecoder('utf-16le').decode(bytes);
  if (cerosPares > muestra / 4 && cerosImpares === 0) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Detecta el delimitador (coma, tabulador o punto y coma) por la primera linea fuera de comillas. */
export function detectarDelimitador(texto: string): string {
  const cuenta: Record<string, number> = { ',': 0, '\t': 0, ';': 0 };
  let enComillas = false;
  for (const c of texto) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && (c === '\n' || c === '\r')) break;
    else if (!enComillas && c in cuenta) cuenta[c]!++;
  }
  return (['\t', ';', ','] as const).reduce((mejor, d) => (cuenta[d]! > cuenta[mejor]! ? d : mejor), ',');
}

/** Separa un texto CSV en filas de celdas. Tolera saltos de linea dentro de comillas, comillas dobles escapadas y un cierre sin salto final. */
export function parsearCsv(texto: string, delimitador?: string): string[][] {
  const d = delimitador ?? detectarDelimitador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let enComillas = false;
  const cerrarFila = () => {
    fila.push(celda);
    celda = '';
    if (fila.length > 1 || fila[0] !== '') filas.push(fila);
    fila = [];
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else enComillas = false;
      } else celda += c;
    } else if (c === '"' && celda === '') enComillas = true;
    else if (c === d) { fila.push(celda); celda = ''; }
    else if (c === '\n') cerrarFila();
    else if (c === '\r') { if (texto[i + 1] === '\n') i++; cerrarFila(); }
    else celda += c;
  }
  if (celda !== '' || fila.length > 0) cerrarFila();
  return filas;
}
