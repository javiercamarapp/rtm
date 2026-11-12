// Aritmetica pura de ejes (sin DOM): marcas "bonitas" y abreviatura es-MX. Con prueba unitaria.
const PASOS = [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10] as const;

/** Tope "bonito" y tres marcas [0, mitad, tope] para un maximo positivo. Maximo <= 0 o no finito: escala 0 a 1. */
export function escalaBonita(max: number): { tope: number; marcas: [number, number, number] } {
  if (!Number.isFinite(max) || max <= 0) return { tope: 1, marcas: [0, 0.5, 1] };
  const exp = Math.floor(Math.log10(max));
  const base = 10 ** exp;
  const m = max / base;
  const paso = PASOS.find((p) => p >= m - 1e-9) ?? 10;
  const tope = paso * base;
  return { tope, marcas: [0, tope / 2, tope] };
}

/** Abreviatura es-MX: 2,100,000 -> "2.1 M"; 337,900 -> "337.9 mil"; menos de mil, entero. Negativos con el signo menos tipografico. */
export function compactoEs(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const signo = n < 0 ? '−' : '';
  const dec = (v: number) => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '');
  if (abs >= 1_000_000) return `${signo}${dec(abs / 1_000_000)} M`;
  if (abs >= 1_000) return `${signo}${dec(abs / 1_000)} mil`;
  return `${signo}${Math.round(abs)}`;
}
