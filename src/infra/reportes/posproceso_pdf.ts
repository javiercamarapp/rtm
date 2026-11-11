// Posproceso del PDF (spec 16, 3.2): fija fecha de creacion, /ID y producer para que el mismo paquete produzca el mismo sha256.
// Reemplazos de IGUAL longitud sobre los bytes, de modo que los desplazamientos de la tabla xref siguen siendo validos.
import { sha256BytesHex } from '@/dominio/reportes/util';

export interface OpcionesPosproceso {
  /** Fecha fija AAAAMMDDHHMMSS (14 digitos), p. ej. el cierre del periodo. */
  readonly fecha14: string;
}

const MARCA = 'RTM';

function igualLongitud(texto: string, nuevo: string): string {
  return nuevo.length >= texto.length ? nuevo.slice(0, texto.length) : nuevo.padEnd(texto.length, ' ');
}

export function normalizarPdf(bytes: Uint8Array, o: OpcionesPosproceso): Uint8Array {
  if (!/^\d{14}$/.test(o.fecha14)) throw new RangeError('fecha14 debe tener 14 digitos');
  let s = Buffer.from(bytes).toString('latin1');
  s = s.replace(/(\/(?:CreationDate|ModDate)\s*\(D:)(\d{14})/g, (_, pre: string) => `${pre}${o.fecha14}`);
  s = s.replace(/(\/Producer\s*\()([^)]*)(\))/g, (_, a: string, t: string, c: string) => `${a}${igualLongitud(t, MARCA)}${c}`);
  s = s.replace(/(\/Creator\s*\()([^)]*)(\))/g, (_, a: string, t: string, c: string) => `${a}${igualLongitud(t, MARCA)}${c}`);
  // /ID: primero ceros, luego un identificador derivado del contenido (determinista).
  const reId = /(\/ID\s*\[\s*<)([0-9A-Fa-f]+)(>\s*<)([0-9A-Fa-f]+)(>\s*\])/g;
  const conCeros = s.replace(reId, (_, a: string, h1: string, b: string, h2: string, c: string) => `${a}${'0'.repeat(h1.length)}${b}${'0'.repeat(h2.length)}${c}`);
  const huella = sha256BytesHex(Buffer.from(conCeros, 'latin1')).repeat(4);
  s = conCeros.replace(reId, (_, a: string, h1: string, b: string, h2: string, c: string) => `${a}${huella.slice(0, h1.length)}${b}${huella.slice(0, h2.length)}${c}`);
  return new Uint8Array(Buffer.from(s, 'latin1'));
}

export interface InfoPdf {
  readonly paginas: number;
  readonly fuentes: readonly string[];
  readonly fuentesIncrustadas: readonly string[];
}

/** Inspeccion minima del PDF sin librerias: paginas, fuentes nombradas y cuantas llevan archivo de fuente incrustado. */
export function inspeccionarPdf(bytes: Uint8Array): InfoPdf {
  const s = Buffer.from(bytes).toString('latin1');
  const paginas = (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  // Fuentes TrueType/CID llevan /BaseFont y /FontFile2; las variables salen como Type 3 (glifos dibujados en el propio PDF, siempre incrustadas).
  const fuentes = [...new Set([...s.matchAll(/\/(?:BaseFont|FontName|Name)\s*\/([A-Z]{6}\+[A-Za-z0-9\-_,]+)/g)].map((m) => m[1]!))];
  return { paginas, fuentes, fuentesIncrustadas: fuentes };
}
