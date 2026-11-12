// Lectura de vCard 2.1 y 3.0 a la misma tabla (matriz de textos) que usa el resto del importador. Puro.
// Soporta lineas dobladas, grupos (item1.TEL), parametros con o sin nombre, codificacion QUOTED-PRINTABLE y escapes de vCard 3.0.

/** Desdobla lineas: continuacion por espacio/tabulador (3.0) o por '=' final en quoted-printable (2.1). */
function lineasLogicas(texto: string): string[] {
  const crudas = texto.replace(/\r\n?/g, '\n').split('\n');
  const salida: string[] = [];
  for (const l of crudas) {
    const previa = salida[salida.length - 1];
    if (previa !== undefined && /^[ \t]/.test(l)) salida[salida.length - 1] = previa + l.slice(1);
    else if (previa !== undefined && /QUOTED-PRINTABLE/i.test(previa.split(':')[0] ?? '') && previa.endsWith('=')) salida[salida.length - 1] = previa.slice(0, -1) + l;
    else salida.push(l);
  }
  return salida.filter((l) => l !== '');
}

function decodificarQp(valor: string, charset: string): string {
  const bytes: number[] = [];
  const crudo = valor.replace(/=\r?\n/g, '');
  for (let i = 0; i < crudo.length; i++) {
    if (crudo[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(crudo.slice(i + 1, i + 3))) { bytes.push(parseInt(crudo.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(crudo[i]!));
  }
  try { return new TextDecoder(charset.toLowerCase() === 'iso-8859-1' ? 'iso-8859-1' : 'utf-8').decode(new Uint8Array(bytes)); } catch { return crudo; }
}

function desescapar(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c));
}

interface Propiedad { nombre: string; params: string[]; valor: string }

function propiedad(linea: string): Propiedad | null {
  const i = linea.indexOf(':');
  if (i < 1) return null;
  const [cabeza, ...params] = linea.slice(0, i).split(';');
  const nombre = (cabeza ?? '').replace(/^.*\./, '').toUpperCase();
  let valor = linea.slice(i + 1);
  const esQp = params.some((p) => /QUOTED-PRINTABLE/i.test(p));
  if (esQp) valor = decodificarQp(valor, params.find((p) => /^CHARSET=/i.test(p))?.slice(8) ?? 'utf-8');
  return { nombre, params, valor };
}

function nombreDeN(n: string): string {
  const [familia = '', dado = '', adicional = '', prefijo = '', sufijo = ''] = n.split(';');
  return [prefijo, dado, adicional, familia, sufijo].map((p) => desescapar(p).trim()).filter((p) => p !== '').join(' ');
}

/**
 * Convierte el texto de un .vcf en una tabla: una fila por tarjeta, con columnas
 * `First Name`, `Labels`, `E-mail N - Value` y `Phone N - Value`. Una tarjeta sin TEL produce una fila sin telefono (se cuenta como descartada).
 */
export function leerVcf(texto: string): string[][] {
  const tarjetas: Array<{ nombre: string; n: string; tels: string[]; correos: string[]; etiquetas: string[] }> = [];
  let actual: (typeof tarjetas)[number] | null = null;
  for (const linea of lineasLogicas(texto)) {
    const p = propiedad(linea);
    if (!p) continue;
    if (p.nombre === 'BEGIN' && p.valor.trim().toUpperCase() === 'VCARD') { actual = { nombre: '', n: '', tels: [], correos: [], etiquetas: [] }; continue; }
    if (p.nombre === 'END' && p.valor.trim().toUpperCase() === 'VCARD') { if (actual) tarjetas.push(actual); actual = null; continue; }
    if (!actual) continue;
    if (p.nombre === 'FN') actual.nombre = desescapar(p.valor).trim();
    else if (p.nombre === 'N') actual.n = nombreDeN(p.valor);
    else if (p.nombre === 'TEL') { const t = p.valor.trim().replace(/^tel:/i, ''); if (t !== '') actual.tels.push(t); }
    else if (p.nombre === 'EMAIL') { const c = p.valor.trim().replace(/^mailto:/i, ''); if (c !== '') actual.correos.push(c); }
    else if (p.nombre === 'CATEGORIES') actual.etiquetas.push(...p.valor.split(',').map((e) => desescapar(e).trim()).filter((e) => e !== ''));
  }
  const maxTel = Math.max(1, ...tarjetas.map((t) => t.tels.length));
  const maxCor = Math.max(0, ...tarjetas.map((t) => t.correos.length));
  const cab = ['First Name', 'Labels', ...Array.from({ length: maxCor }, (_, i) => `E-mail ${i + 1} - Value`), ...Array.from({ length: maxTel }, (_, i) => `Phone ${i + 1} - Value`)];
  const filas = tarjetas.map((t) => [
    t.nombre || t.n,
    t.etiquetas.join(' ::: '),
    ...Array.from({ length: maxCor }, (_, i) => t.correos[i] ?? ''),
    ...Array.from({ length: maxTel }, (_, i) => t.tels[i] ?? ''),
  ]);
  return [cab, ...filas];
}
