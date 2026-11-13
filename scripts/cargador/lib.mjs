// Utilidades puras del cargador (sin E/S): dinero en centavos, prorrateo exacto, claves de idempotencia y normalizacion de nombres.
import { createHash } from 'node:crypto';

/** Pesos (numero o texto con decimales) a centavos enteros. Falla si no es un monto con 2 decimales como maximo. */
export function aCentavos(x) {
  const n = typeof x === 'string' ? Number(x.replace(/[,\s]/g, '')) : x;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`monto invalido: ${String(x)}`);
  const c = Math.round(n * 100);
  if (Math.abs(c / 100 - n) > 1e-6) throw new Error(`monto con mas de 2 decimales: ${String(x)}`);
  return c;
}

/**
 * Reparte un total en centavos entre renglones con cantidades q_i, como precio unitario entero por renglon, de modo que
 * suma(q_i * p_i) = total EXACTO. Precio base = piso(total / piezas); el residuo se reparte sumando 1, 2 o 3 centavos por pieza a
 * algunos renglones (subconjunto exacto por programacion dinamica). Devuelve los precios unitarios en el orden de entrada.
 */
export function prorratear(totalCent, cantidades) {
  const piezas = cantidades.reduce((s, q) => s + q, 0);
  if (!Number.isInteger(totalCent) || totalCent <= 0) throw new Error('el total a prorratear debe ser un entero positivo');
  if (piezas <= 0 || cantidades.some((q) => !Number.isInteger(q) || q <= 0)) throw new Error('las cantidades deben ser enteros positivos');
  const base = Math.floor(totalCent / piezas);
  const resto = totalCent - base * piezas;
  if (base <= 0) throw new Error('el total es menor a un centavo por pieza');
  if (resto === 0) return cantidades.map(() => base);
  for (let k = 1; k <= 4; k += 1) {
    // alcanzable[s] = primera forma (renglon, incremento) con la que se llego a la suma s; permite reconstruir.
    const n = cantidades.length;
    const dp = Array.from({ length: n + 1 }, () => new Map());
    dp[0].set(0, null);
    for (let i = 0; i < n; i += 1) {
      for (const [s] of dp[i]) {
        for (let inc = 0; inc <= k; inc += 1) {
          const t = s + inc * cantidades[i];
          if (t <= resto && !dp[i + 1].has(t)) dp[i + 1].set(t, { desde: s, inc });
        }
      }
    }
    if (dp[n].has(resto)) {
      const incs = new Array(n).fill(0);
      let s = resto;
      for (let i = n; i >= 1; i -= 1) {
        const paso = dp[i].get(s);
        incs[i - 1] = paso.inc;
        s = paso.desde;
      }
      return incs.map((inc) => base + inc);
    }
  }
  throw new Error('no se pudo repartir el total exacto entre los renglones');
}

export const sumaRenglones = (cantidades, precios) => cantidades.reduce((s, q, i) => s + q * precios[i], 0);

/** Clave de idempotencia estable de una operacion: prefijo + hash corto de la clave de identidad + paso. Sin datos personales. */
export function claveOperacion(prefijo, claveIdentidad, paso) {
  const h = createHash('sha256').update(String(claveIdentidad)).digest('hex').slice(0, 16);
  return `${prefijo}:${h}:${paso}`;
}

/** Texto a una forma comparable: sin acentos, minusculas, sin signos de puntuacion repetidos. */
export function norm(t) {
  return String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function titulo(t) {
  return String(t)
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length <= 3 && /^[a-z]{1,3}$/i.test(w) && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Sabor limpio: sin anotaciones de duda; los textos entre parentesis no son un sabor. */
export function sabor(t) {
  const s = String(t ?? '').trim();
  if (/^\(.*variad/i.test(s)) return 'Variados';
  if (/^\(/.test(s) || s === '') return 'Sin sabor especificado';
  return titulo(s.replace(/\s*\(\?\)\s*$/, ''));
}

/** Slug a nombre visible de un cliente. */
export const nombreDeSlug = (slug) => titulo(String(slug).replace(/-/g, ' '));

export const fechaISO = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`fecha invalida: ${String(d)}`);
  return d;
};
export const minFecha = (...fs) => fs.filter(Boolean).sort()[0] ?? null;

export const fmt = (cent) => (cent / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Reparte, sobre los mismos renglones, un total de venta y/o un total de costo (centavos por pieza enteros). Si con los renglones dados no hay forma exacta
 * (el total no es multiplo del maximo comun divisor de las cantidades), parte el renglon mas grande en dos del mismo SKU (q-1 y 1): el sistema admite varios renglones del mismo SKU.
 * Devuelve [{ indice, piezas, precio, costo }] (indice = renglon de origen; precio y costo = null si no se pide).
 */
/** @param {{ precioTotal?: number | null, costoTotal?: number | null, cantidades: number[] }} args */
export function repartirExacto({ precioTotal = null, costoTotal = null, cantidades }) {
  const partes = cantidades.map((q, i) => ({ indice: i, piezas: q }));
  for (let intento = 0; intento < 16; intento += 1) {
    try {
      const q = partes.map((x) => x.piezas);
      const p = precioTotal == null ? null : prorratear(precioTotal, q);
      const c = costoTotal == null ? null : prorratear(costoTotal, q);
      return partes.map((x, j) => ({ ...x, precio: p ? p[j] : null, costo: c ? c[j] : null }));
    } catch (e) {
      if (!/repartir/.test(String(e.message))) throw e;
      let j = -1;
      for (const [k, x] of partes.entries()) if (x.piezas > 1 && (j < 0 || x.piezas > partes[j].piezas)) j = k;
      if (j < 0) throw e;
      partes[j] = { ...partes[j], piezas: partes[j].piezas - 1 };
      partes.splice(j + 1, 0, { indice: partes[j].indice, piezas: 1 });
    }
  }
  throw new Error('no se pudo repartir el total exacto entre los renglones');
}
