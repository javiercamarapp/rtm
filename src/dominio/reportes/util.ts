// Utilidades puras del motor de reportes: racionales con bigint, reparto exacto, estadistica basica y sha256.
// Sin reloj, sin azar, sin red. El dinero es siempre bigint en centavos.
import { redondearMedioArriba } from '../dinero';

export type Rac = { readonly n: bigint; readonly d: bigint };

function mcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function rac(n: bigint, d: bigint = 1n): Rac {
  if (d === 0n) throw new RangeError('denominador cero');
  const s = d < 0n ? -1n : 1n;
  const g = mcd(n, d) || 1n;
  return { n: (s * n) / g, d: (s * d) / g };
}
export const sumaRac = (a: Rac, b: Rac): Rac => rac(a.n * b.d + b.n * a.d, a.d * b.d);
export const restaRac = (a: Rac, b: Rac): Rac => rac(a.n * b.d - b.n * a.d, a.d * b.d);
export const porRac = (a: Rac, b: Rac): Rac => rac(a.n * b.n, a.d * b.d);
export const RAC_CERO: Rac = { n: 0n, d: 1n };
export const sumarRacs = (xs: readonly Rac[]): Rac => xs.reduce(sumaRac, RAC_CERO);

/** floor de un racional (hacia menos infinito). */
export function pisoRac(r: Rac): bigint {
  const q = r.n / r.d;
  return r.n < 0n && r.n % r.d !== 0n ? q - 1n : q;
}

/**
 * Reparto exacto: redondea cada racional a entero de modo que la suma sea exactamente `total`
 * (metodo del mayor residuo; empate por indice). `total` debe ser el entero al que suman los racionales.
 */
export function repartirExacto(partes: readonly Rac[], total: bigint): bigint[] {
  const pisos = partes.map(pisoRac);
  let faltan = total - pisos.reduce((a, b) => a + b, 0n);
  const orden = partes
    .map((p, i) => ({ i, resto: restaRac(p, rac(pisos[i]!)) }))
    .sort((a, b) => {
      const c = restaRac(b.resto, a.resto);
      return c.n > 0n ? 1 : c.n < 0n ? -1 : a.i - b.i;
    });
  const out = [...pisos];
  for (const o of orden) {
    if (faltan <= 0n) break;
    out[o.i] = out[o.i]! + 1n;
    faltan -= 1n;
  }
  if (faltan !== 0n) throw new RangeError('el reparto exacto no cierra: los racionales no suman el total');
  return out;
}

/** Prorratea `monto` entre `pesos` (enteros >= 0) con residuo exacto. Si todos los pesos son 0, todo va al primero. */
export function prorratear(monto: bigint, pesos: readonly number[]): bigint[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (pesos.length === 0) return [];
  if (suma === 0) return pesos.map((_, i) => (i === 0 ? monto : 0n));
  return repartirExacto(
    pesos.map((p) => rac(monto * BigInt(p), BigInt(suma))),
    monto,
  );
}

export const sumaBig = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

/** Porcentaje en puntos base (centesimas de punto porcentual), medio arriba: 40422/463900 -> 871. */
export function bp(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new RangeError('denominador cero');
  const signo = den < 0n ? -1n : 1n;
  return redondearMedioArriba(num * 10_000n * signo, den * signo);
}

export function medianaNum(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('mediana de una serie vacia');
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Percentil por interpolacion lineal (p en 0..1). */
export function percentil(xs: readonly number[], p: number): number {
  if (xs.length === 0) throw new RangeError('percentil de una serie vacia');
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const mediaNum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

export function desvEstandar(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mediaNum(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Orden de texto determinista (no depende de la configuracion regional del motor). */
export const cmpTexto = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const aBigRedondeado = (x: number): bigint => BigInt(Math.round(x));

// ---------- JSON canonico y sha256 (puros) ----------

/** JSON con llaves ordenadas; bigint como texto. Base de la huella y de la comparacion de paquetes. */
export function jsonCanonico(valor: unknown): string {
  if (typeof valor === 'bigint') return JSON.stringify(valor.toString());
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor === undefined ? null : valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const o = valor as Record<string, unknown>;
  const llaves = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${llaves.map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`).join(',')}}`;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** sha256 en hexadecimal de un texto (UTF-8). Implementacion pura, verificada contra node:crypto en las pruebas. */
export function sha256Hex(texto: string): string {
  return sha256BytesHex(new TextEncoder().encode(texto));
}

/** sha256 en hexadecimal de bytes (el PDF). */
export function sha256BytesHex(bytes: Uint8Array): string {
  const bitLen = bytes.length * 8;
  const total = (((bytes.length + 9 + 63) >> 6) << 6) >>> 0;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}
