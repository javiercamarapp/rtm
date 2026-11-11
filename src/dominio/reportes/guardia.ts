// Guardia de numeros (spec 16, 2.1; 02 F1.3): todo numero de un texto redactado debe existir en el paquete.
// Se extraen las cifras del texto final, se normalizan (separadores, signo, simbolo de pesos, porcentaje) y cada una
// debe pertenecer al conjunto autorizado por el paquete. Sin tolerancia de digitos sueltos. Fechas y folios se validan aparte.
import { sumarDias } from '../calendario';
import { formatearMoneda } from '../formato';
import { canonNumero, numerosAutorizados, pesosEnteros, porcentaje0, porcentaje1, razon } from './formato';
import type { Cifra } from './tipos';
import { ErrorReporte } from './tipos';

export interface ContextoGuardia {
  readonly cifras: readonly Cifra[];
  /** Nombres propios que pueden llevar digitos (modelos, clientes, sabores). */
  readonly nombres: readonly string[];
  /** Fechas autorizadas (AAAA-MM-DD): periodo, corte, aprobacion. */
  readonly fechas: readonly string[];
  /** Hojas del paquete (tablas y datos de graficas) que autorizan sus valores. */
  readonly valoresExtra: readonly (bigint | number)[];
  /** Numeros autorizados por construccion (ejes, tope de 80 %, etc.). */
  readonly constantes: readonly string[];
}

export interface ResultadoGuardia {
  readonly ok: boolean;
  readonly violaciones: readonly string[];
}

const MESES_TXT = '(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-zé]*';
const RE_FECHA = new RegExp(`\\d{1,2}(?:\\s*(?:a|al|-)\\s*\\d{1,2})?[\\s-]*(?:de\\s+)?${MESES_TXT}(?:\\s+(?:de\\s+)?\\d{4})?`, 'gi');
const RE_FOLIO = /\b[A-Z]{2,3}-\d{4}-\d{2}\b/g;
const RE_HUELLA = /huella:?\s+[0-9a-f]{6,64}/gi;
const RE_HORA = /\b\d{1,2}:\d{2}\b/g;
const RE_PAGINA = /\bp\.\s*\d+\/\d+/gi;
const RE_ID = /\b(?:C|I|R)\d{1,2}\b|\bR\.[A-Z]+\b/g;
const RE_NUM = /[−-]?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|pz)?/g;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Autoriza las formas en que puede mostrarse un valor suelto (bigint o entero). */
export function numerosDeValor(v: bigint | number): string[] {
  if (typeof v === 'number') return Number.isInteger(v) ? [canonNumero(String(Math.abs(v)))] : [];
  const a = v < 0n ? -v : v;
  return [a.toString(), pesosEnteros(a), formatearMoneda(a), porcentaje0(a), porcentaje1(a), razon(a)].map(canonNumero);
}

export function numerosPermitidos(ctx: ContextoGuardia): Set<string> {
  const s = new Set<string>(ctx.constantes.map(canonNumero));
  for (const c of ctx.cifras) for (const n of numerosAutorizados(c)) s.add(n);
  for (const v of ctx.valoresExtra) for (const n of numerosDeValor(v)) s.add(n);
  return s;
}

/** Numeros de dia y anio de las fechas autorizadas. */
function numerosDeFechas(fechas: readonly string[]): Set<string> {
  const s = new Set<string>();
  for (const f of fechas) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
    if (!m) throw new ErrorReporte('DATOS_INVALIDOS', `fecha invalida en la guardia: ${f}`);
    s.add(canonNumero(m[1]!));
    s.add(canonNumero(String(Number(m[3]))));
  }
  return s;
}

/** Rango de fechas inclusive, para autorizar todos los dias de un periodo. */
export function fechasEntre(inicio: string, fin: string): string[] {
  const out: string[] = [];
  for (let f = inicio, i = 0; f <= fin && i < 400; f = sumarDias(f, 1), i++) out.push(f);
  return out;
}

export function extraerNumeros(texto: string): string[] {
  return [...texto.matchAll(RE_NUM)].map((m) => m[0].trim());
}

/** Verifica un texto contra el paquete. Devuelve las violaciones (numero y fragmento) en lugar de lanzar. */
export function verificarTexto(texto: string, ctx: ContextoGuardia): ResultadoGuardia {
  const violaciones: string[] = [];
  let resto = texto;
  const permitidos = numerosPermitidos(ctx);
  const diasFecha = numerosDeFechas(ctx.fechas);
  // Nombres propios (mas largos primero) con digitos.
  for (const n of [...ctx.nombres].filter((x) => /\d/.test(x)).sort((a, b) => b.length - a.length)) resto = resto.replace(new RegExp(escapar(n), 'gi'), ' ');
  resto = resto.replace(RE_FOLIO, ' ').replace(RE_HUELLA, ' ').replace(RE_HORA, ' ').replace(RE_PAGINA, ' ').replace(RE_ID, ' ');
  // Fechas: sus numeros se validan contra las fechas del periodo.
  resto = resto.replace(RE_FECHA, (frag) => {
    for (const n of frag.match(/\d+/g) ?? []) if (!diasFecha.has(canonNumero(n))) violaciones.push(`fecha fuera del periodo: ${n} en "${frag.trim()}"`);
    return ' ';
  });
  // Numeracion de listas ("1. ", "2. ") al inicio de linea.
  resto = resto.replace(/^\s*\d{1,2}\.\s/gm, ' ');
  for (const tok of extraerNumeros(resto)) {
    const c = canonNumero(tok);
    if (c === '' || permitidos.has(c)) continue;
    violaciones.push(`numero fuera del paquete: ${tok}`);
  }
  return { ok: violaciones.length === 0, violaciones };
}

/** Variante que lanza GUARDIA_NUMEROS. */
export function exigirTextoVerificado(texto: string, ctx: ContextoGuardia): void {
  const r = verificarTexto(texto, ctx);
  if (!r.ok) throw new ErrorReporte('GUARDIA_NUMEROS', 'el texto contiene numeros que no estan en el paquete', r.violaciones);
}
