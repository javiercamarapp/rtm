// Unico modulo donde se formatean numeros. Prohibido el formato regional del motor (toLocaleString) fuera de aqui (guarda estatica).
// Moneda "$1,234.50", piezas "1,524 pz", signo real U+2212.

export const MENOS = '−';

function agrupar(enteros: string): string {
  return enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatearMoneda(cent: bigint, opciones: { conSigno?: boolean } = {}): string {
  const negativo = cent < 0n;
  const abs = negativo ? -cent : cent;
  const enteros = (abs / 100n).toString();
  const decimales = (abs % 100n).toString().padStart(2, '0');
  const cuerpo = `$${agrupar(enteros)}.${decimales}`;
  if (negativo) return `${MENOS}${cuerpo}`;
  return opciones.conSigno && cent > 0n ? `+${cuerpo}` : cuerpo;
}

export function formatearPiezas(n: number): string {
  if (!Number.isInteger(n)) throw new RangeError('piezas deben ser enteras');
  const abs = Math.abs(n);
  return `${n < 0 ? MENOS : ''}${agrupar(String(abs))} pz`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

/** "2026-11-09" -> { dia: 9, mes: 'nov' } sin pasar por Date ni por el formato regional del motor. */
function partes(f: string): { dia: number; mes: (typeof MESES)[number] } {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(f);
  if (!m) throw new RangeError(`fecha invalida: ${f}`);
  return { dia: Number(m[2]), mes: MESES[Number(m[1]) - 1]! };
}

/** "9 a 15 nov" (o "30 oct a 5 nov" si cruza de mes). */
export function etiquetaRango(inicio: string, fin: string): string {
  const a = partes(inicio);
  const b = partes(fin);
  return a.mes === b.mes ? `${a.dia} a ${b.dia} ${b.mes}` : `${a.dia} ${a.mes} a ${b.dia} ${b.mes}`;
}

/** Nombre del dia (lunes0 = 0 ... domingo = 6) y fecha corta: "martes 10 nov". */
export function etiquetaDia(f: string, diaLunes0: number): string {
  const p = partes(f);
  return `${DIAS[diaLunes0]} ${p.dia} ${p.mes}`;
}

/** "2026-11-10" -> "10 nov 2026". */
export function etiquetaFecha(f: string): string {
  const p = partes(f);
  return `${p.dia} ${p.mes} ${f.slice(0, 4)}`;
}

/** Instante ISO -> "10 nov 14:32" en la hora de Merida (UTC-6 fijo), sin pasar por el formato regional del motor. */
export function etiquetaFechaHora(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`instante invalido: ${iso}`);
  const d = new Date(ms - 6 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`;
}

/** Pesos sin signo de moneda para el texto de WhatsApp: "7,000" (enteros) o "13,590.00" (con centavos). Misma regla que `operacion.fmt_pesos` de la base. */
export function formatearPesosCorto(cent: bigint, forzarCentavos = false): string {
  const negativo = cent < 0n;
  const abs = negativo ? -cent : cent;
  const cuerpo = `${agrupar((abs / 100n).toString())}${forzarCentavos || abs % 100n !== 0n ? `.${(abs % 100n).toString().padStart(2, '0')}` : ''}`;
  return negativo ? `-${cuerpo}` : cuerpo;
}
