// Formato unico de los reportes (spec 16, 1.10): `$40,422` sin decimales, `2,310 pz`, `8.7 %`, variaciones con signo y palabra.
// Reutiliza el formato central del dominio para moneda con centavos; nunca usa el formato regional del motor.
import { redondearMedioArriba } from '../dinero';
import { MENOS, formatearMoneda } from '../formato';
import type { Cifra, FormatoCifra, Unidad } from './tipos';

const agrupar = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `$40,422` / `−$1,098` (pesos enteros, medio arriba sobre el valor absoluto). */
export function pesosEnteros(cent: bigint): string {
  const neg = cent < 0n;
  const abs = neg ? -cent : cent;
  const pesos = redondearMedioArriba(abs, 100n);
  return `${neg && pesos !== 0n ? MENOS : ''}$${agrupar(pesos.toString())}`;
}

/** Decimal con `dec` decimales a partir de un entero escalado (medio arriba sobre el valor absoluto). */
function decimal(valor: bigint, escala: bigint, dec: number): string {
  const neg = valor < 0n;
  const abs = neg ? -valor : valor;
  const factor = 10n ** BigInt(dec);
  const x = redondearMedioArriba(abs * factor, escala);
  const ent = x / factor;
  const frac = (x % factor).toString().padStart(dec, '0');
  const cuerpo = dec === 0 ? agrupar(ent.toString()) : `${agrupar(ent.toString())}.${frac}`;
  return `${neg && x !== 0n ? MENOS : ''}${cuerpo}`;
}

export const porcentaje1 = (bp: bigint): string => `${decimal(bp, 100n, 1)} %`;
export const porcentaje0 = (bp: bigint): string => `${decimal(bp, 100n, 0)} %`;

/** Razon con hasta 2 decimales ("1.3", "0.94", "1.0"). */
export function razon(milesimas: bigint): string {
  const t = decimal(milesimas, 1000n, 2);
  return /\.\d0$/.test(t) ? t.slice(0, -1) : t;
}

export const diasTexto = (n: number): string => `${agrupar(String(Math.abs(n)))} ${Math.abs(n) === 1 ? 'día' : 'días'}`;
export const piezasTexto = (n: number): string => `${n < 0 ? MENOS : ''}${agrupar(String(Math.abs(n)))} pz`;
export const enteroTexto = (n: number): string => `${n < 0 ? MENOS : ''}${agrupar(String(Math.abs(n)))}`;

const FORMATO_POR_UNIDAD: Record<Unidad, FormatoCifra> = { cent: 'entero', pz: 'pz', bp: 'pct1', milesimas: 'razon', dias: 'dias', n: 'n' };

export function formatearValor(valor: bigint, unidad: Unidad, formato?: FormatoCifra): string {
  switch (formato ?? FORMATO_POR_UNIDAD[unidad]) {
    case 'entero':
      return pesosEnteros(valor);
    case 'centavos':
      return formatearMoneda(valor);
    case 'pct0':
      return porcentaje0(valor);
    case 'pct1':
      return porcentaje1(valor);
    case 'razon':
      return razon(valor);
    case 'dias':
      return diasTexto(Number(valor));
    case 'pz':
      return piezasTexto(Number(valor));
    case 'n':
      return enteroTexto(Number(valor));
  }
}

export const formatearCifra = (c: Cifra): string => formatearValor(c.valor, c.unidad, c.formato);

/** Variacion con palabra: "9 % menos", "12 % más", "sin cambio". Recibe puntos base de la variacion relativa. */
export function variacionTexto(bpVar: bigint): string {
  const abs = bpVar < 0n ? -bpVar : bpVar;
  const t = decimal(abs, 100n, 0);
  if (t === '0') return 'sin cambio';
  return `${t} % ${bpVar < 0n ? 'menos' : 'más'}`;
}

/** Normaliza un token numerico a su forma canonica para la guardia: sin signo, separadores, simbolos ni ceros a la derecha. */
export function canonNumero(token: string): string {
  let t = token.replace(/[$%\s−\-+]|pz/gi, '').replace(/,/g, '');
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  t = t.replace(/^0+(?=\d)/, '');
  return t;
}

/** Todas las formas numericas que una cifra autoriza en un texto redactado. */
export function numerosAutorizados(c: Cifra): string[] {
  const out = new Set<string>();
  const unidades: Record<Unidad, FormatoCifra[]> = {
    cent: ['entero', 'centavos'],
    pz: ['pz', 'n'],
    bp: ['pct0', 'pct1'],
    milesimas: ['razon', 'pct0'],
    dias: ['dias', 'n'],
    n: ['n'],
  };
  const valores = [c.valor, ...(c.rango ? [c.rango.lo, c.rango.hi] : [])];
  for (const v of valores) {
    for (const f of unidades[c.unidad]) out.add(canonNumero(formatearValor(v, c.unidad, f)));
    out.add(canonNumero((v < 0n ? -v : v).toString()));
  }
  return [...out];
}
