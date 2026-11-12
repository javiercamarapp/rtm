// Piezas comunes de las paginas A1: series semanales, deltas y textos. Solo formatea lo que la base ya entrego (nada de dinero calculado por IA).
import { formatearMoneda } from '@/dominio/formato';
import { sentidoDe, textoVariacion, variacionPct, type SemanaSerie } from '@/dominio/tablero/agregados';
import type { DatoColumna } from '@/ui/graficas';
import type { DeltaTexto } from '@/ui/graficas/tipos';

export const NUMERO_SEMANAS = [4, 8, 12] as const;
export function semanasDe(valor: string | undefined): (typeof NUMERO_SEMANAS)[number] {
  const n = Number(valor);
  return (NUMERO_SEMANAS as readonly number[]).includes(n) ? (n as (typeof NUMERO_SEMANAS)[number]) : 8;
}

/** Columnas por semana con variacion contra la semana anterior COMPLETA; la semana en curso va parcial y sin variacion. */
export function columnasSemana(semanas: readonly SemanaSerie[], valores: readonly number[], texto: (n: number) => string, unidad: string, escala = 1): DatoColumna[] {
  return semanas.map((s, i) => {
    const v = valores[i] ?? 0;
    const previo = i > 0 ? valores[i - 1] ?? null : null;
    const pct = !s.parcial && i > 0 && !semanas[i - 1]!.parcial ? variacionPct(v, previo) : null;
    const t = textoVariacion(pct);
    return { id: s.id, etiqueta: s.etiqueta, valor: v / escala, texto: texto(v), parcial: s.parcial, variacion: t ? `${sentidoDe(pct) === 'sube' ? '▲' : sentidoDe(pct) === 'baja' ? '▼' : '='} ${t} contra la semana anterior (${unidad})` : undefined };
  });
}

/** Delta de la ultima semana completa contra la anterior; null si no hay base. `bueno` dice si subir es bueno para el negocio. */
export function deltaSemanal(semanas: readonly SemanaSerie[], valores: readonly number[], bueno: boolean): DeltaTexto | undefined {
  const completas = semanas.map((s, i) => ({ s, v: valores[i] ?? 0 })).filter((x) => !x.s.parcial);
  if (completas.length < 2) return undefined;
  const pct = variacionPct(completas[completas.length - 1]!.v, completas[completas.length - 2]!.v);
  const t = textoVariacion(pct);
  if (t === null) return undefined;
  const sentido = sentidoDe(pct);
  return { texto: `${t} vs semana anterior`, sentido, bueno: sentido === 'igual' ? undefined : sentido === 'sube' ? bueno : !bueno };
}

/** Serie para el sparkline de un KPI; solo si hay al menos dos semanas con algun dato real. */
export function sparkSemanal(semanas: readonly SemanaSerie[], valores: readonly number[], texto: (n: number) => string) {
  if (valores.filter((v) => v > 0).length < 2) return undefined;
  return { etiquetas: semanas.map((s) => s.etiqueta), valores: [...valores], textos: valores.map(texto) };
}

export const centTexto = (n: number): string => formatearMoneda(BigInt(Math.round(n)));
export const dinero = (c: bigint): string => formatearMoneda(c);
