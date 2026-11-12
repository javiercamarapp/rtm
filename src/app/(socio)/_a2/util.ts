// Ayudas de las paginas de datos enterprise (A2). Solo formato y enlaces: ninguna cifra se calcula aqui, la base ya las entrega.
import '@/ui/estilos/paginas-a2.css';
import { fechaNeg, sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, formatearDecimal, formatearMoneda, formatearPiezas } from '@/dominio/formato';

export const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const TIPO_MOV: Record<string, string> = {
  entrada_compra: 'Entrada de compra', salida_pedido: 'Salida de pedido', salida_toma_omar: 'Toma de Omar', devolucion: 'Devolución', merma: 'Merma',
  ajuste_conteo: 'Ajuste de conteo', traspaso_puente: 'Traspaso del puente', reversa: 'Reversa', apertura: 'Apertura',
};

export type Params = Record<string, string | string[] | undefined>;
export const uno = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
export const fechaParam = (v: string | string[] | undefined): string | null => { const t = uno(v); return t && FECHA.test(t) ? t : null; };
export const enteroParam = (v: string | string[] | undefined): number | null => { const n = Number(uno(v)); return Number.isInteger(n) && n > 0 ? n : null; };
export const textoParam = (v: string | string[] | undefined): string | null => { const t = uno(v)?.trim(); return t ? t.slice(0, 80) : null; };

export const hoyNeg = () => fechaNeg(new Date());

/** Periodo desde la URL: ?dias=N (preset) o ?ini=&fin=. */
export function periodo(sp: Params, porOmision: number | null): { ini: string | null; fin: string | null; dias: number | null } {
  const ini = fechaParam(sp.ini);
  const fin = fechaParam(sp.fin);
  if (ini || fin) return { ini, fin, dias: null };
  const d = enteroParam(sp.dias);
  const dias = d ?? porOmision;
  if (dias === null || sp.dias === 'todo') return { ini: null, fin: null, dias: null };
  return { ini: sumarDias(hoyNeg(), -(dias - 1)), fin: null, dias };
}

/** Arma un enlace conservando los parametros actuales; un valor vacio los quita. */
export function enlace(base: string, sp: Params, cambios: Record<string, string | number | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const t = uno(v); if (t !== undefined && t !== '') q.set(k, t); }
  for (const [k, v] of Object.entries(cambios)) { if (v === null || v === '') q.delete(k); else q.set(k, String(v)); }
  return q.size ? `${base}?${q}` : base;
}

export const m = (c: bigint | null | undefined) => (c === null || c === undefined ? null : formatearMoneda(c));
export const pz = (n: number | null | undefined) => (n === null || n === undefined ? null : formatearPiezas(n));
export const dec = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? null : formatearDecimal(n, d));
/** Puntos base a texto con un decimal: 1234 -> "12.3 %". */
export const bpTexto = (bp: number | null | undefined) => (bp === null || bp === undefined ? null : `${formatearDecimal(bp / 100, 1)} %`);
export const partePct = (parte: bigint | number, total: bigint | number): number | null => {
  const t = Number(total);
  return t > 0 ? Math.round((Number(parte) / t) * 1000) / 10 : null;
};
export const pctTexto = (p: number | null) => (p === null ? null : `${formatearDecimal(p, 1)} %`);
export const fecha = (f: string | null | undefined) => (f ? etiquetaFecha(f) : null);

export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const mesEtiqueta = (f: string) => `${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(2, 4)}`;
export const semanaEtiqueta = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]}`;
export const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** CSV generico: neutraliza formulas, comillas dobles y saltos. `pesos` formatea centavos como 1234.50 sin simbolo. */
export function pesosCsv(c: bigint | null): string {
  if (c === null) return '';
  const neg = c < 0n; const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
export function celdaCsv(v: string | number | null): string {
  if (v === null) return '';
  const t = String(v);
  const seguro = /^[=+@-]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
  return /[",\n\r]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}
export const respuestaCsv = (nombre: string, lineas: string[]) => new Response(String.fromCharCode(0xfeff) + lineas.join('\r\n') + '\r\n', {
  headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${nombre}.csv"`, 'cache-control': 'private, no-store' },
});

/** Tono de ChipEstado para un tono de cobertura (neutro se apaga). */
export const tonoChip = (t: 'ok' | 'atencion' | 'malo' | 'neutro'): 'ok' | 'atencion' | 'malo' | 'apagado' => (t === 'neutro' ? 'apagado' : t);
