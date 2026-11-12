// Agregados puros para los tableros de pedidos, clientes, catalogo, paquetes e inicio. Sin dinero calculado por IA: solo suma, cuenta y agrupa
// hechos que la base ya entrego (bigint en centavos). Dato ausente = null (la interfaz dice "Sin dato"), nunca cero.
import { diaSemanaLunes0, sumarDias } from '../calendario';
import { etiquetaFecha } from '../formato';

/** Lunes de la semana de una fecha de negocio. */
export function inicioSemana(f: string): string {
  return sumarDias(f, -diaSemanaLunes0(f));
}

export interface SemanaSerie { id: string; inicio: string; etiqueta: string; parcial: boolean }

/** Las `n` semanas que terminan en la de `hoy`; la ultima es parcial (en curso). */
export function ultimasSemanas(hoy: string, n: number): SemanaSerie[] {
  const actual = inicioSemana(hoy);
  const out: SemanaSerie[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const inicio = sumarDias(actual, -7 * i);
    out.push({ id: inicio, inicio, etiqueta: etiquetaFecha(inicio).slice(0, -5), parcial: i === 0 });
  }
  return out;
}

/** Suma por semana (clave = lunes) y descarta lo que cae fuera de la ventana. */
export function sumarPorSemana<T>(items: readonly T[], semanas: readonly SemanaSerie[], fecha: (x: T) => string | null, valor: (x: T) => number): number[] {
  const idx = new Map(semanas.map((s, i) => [s.inicio, i]));
  const acc = semanas.map(() => 0);
  for (const it of items) {
    const f = fecha(it);
    if (!f) continue;
    const i = idx.get(inicioSemana(f));
    if (i !== undefined) acc[i] = (acc[i] ?? 0) + valor(it);
  }
  return acc;
}

/** Variacion porcentual entre dos periodos COMPLETOS; null si falta base o es cero. */
export function variacionPct(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior === 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

/** "+4.2 %" / "−3.0 %" con signo tipografico; null si no hay variacion. */
export function textoVariacion(p: number | null): string | null {
  if (p === null || !Number.isFinite(p)) return null;
  const r = Math.round(p * 10) / 10;
  if (Math.abs(r) < 0.05) return '0.0 %';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} %`;
}

export function sentidoDe(p: number | null): 'sube' | 'baja' | 'igual' {
  return p === null || Math.abs(p) < 0.05 ? 'igual' : p > 0 ? 'sube' : 'baja';
}

/** Porcentaje 0-100 de una parte sobre un total; null si el total no es positivo. */
export function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? (parte / total) * 100 : null;
}

/** Cuenta por clave, ordenada de mayor a menor. */
export function contarPor<T>(items: readonly T[], clave: (x: T) => string): { clave: string; n: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(clave(it), (m.get(clave(it)) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ clave: k, n })).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
}

/** Parte de los elementos (ya ordenados de mayor a menor) que alcanza el umbral acumulado: "3 de 9 clientes suman el 80 %". */
export function alcanzanUmbral(valores: readonly number[], umbral = 0.8): { n: number; total: number } {
  const orden = [...valores].filter((v) => v > 0).sort((a, b) => b - a);
  const suma = orden.reduce((a, v) => a + v, 0);
  let acc = 0;
  let n = 0;
  for (const v of orden) {
    acc += v;
    n += 1;
    if (suma > 0 && acc / suma >= umbral) break;
  }
  return { n, total: orden.length };
}

/** Convierte centavos a number SOLO para geometria de graficas (el texto exacto viaja aparte). */
export const aNumero = (c: bigint): number => Number(c);

export interface PedidoRitmo { fecha: string; piezas: number }
/** Regla "pidio menos del 70 % de su promedio de 12 semanas": compara la ultima semana COMPLETA con el promedio semanal de las 12 anteriores.
 *  null (sin dato) si tiene menos de 3 pedidos o menos de 28 dias de historia: no se infiere ritmo sin muestra. */
export function ritmoCliente(pedidos: readonly PedidoRitmo[], hoy: string): { baja: boolean; recientes: number; promedio: number } | null {
  if (pedidos.length < 3) return null;
  const primera = [...pedidos].map((p) => p.fecha).sort()[0]!;
  if (sumarDias(primera, 28) > hoy) return null;
  const actual = inicioSemana(hoy);
  const semanas = ultimasSemanas(sumarDias(actual, -7), 13); // 13 semanas completas: la ultima es la de comparacion
  const v = sumarPorSemana(pedidos, semanas.map((s) => ({ ...s, parcial: false })), (p) => p.fecha, (p) => p.piezas);
  const recientes = v[v.length - 1] ?? 0;
  const previas = v.slice(0, -1);
  const promedio = previas.reduce((a, x) => a + x, 0) / previas.length;
  if (promedio <= 0) return null;
  return { baja: recientes < promedio * 0.7, recientes, promedio };
}
