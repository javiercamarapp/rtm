// Conciliacion del libro propio de IA contra la lectura externa (`/key` de la llave de RTM). Spec 17, 4 y caso 5.

import { ceilDiv } from '../dinero/techo';

export type EstadoConciliacion = 'cuadra' | 'fuera_de_tolerancia';

export interface ResultadoConciliacion {
  estado: EstadoConciliacion;
  /** |libro - externo| / libro, en ppm, redondeado hacia arriba. Con libro en cero, 1_000_000 si hay diferencia. */
  diferenciaPpm: bigint;
  diferenciaUsdMicro: bigint;
}

export const TOLERANCIA_POR_DEFECTO_PPM = 20_000n; // 2 %

export function conciliar(libroUsdMicro: bigint, externoUsdMicro: bigint, toleranciaPpm: bigint = TOLERANCIA_POR_DEFECTO_PPM): ResultadoConciliacion {
  const dif = libroUsdMicro > externoUsdMicro ? libroUsdMicro - externoUsdMicro : externoUsdMicro - libroUsdMicro;
  const ppm = dif === 0n ? 0n : libroUsdMicro <= 0n ? 1_000_000n : ceilDiv(dif * 1_000_000n, libroUsdMicro);
  return { estado: ppm <= toleranciaPpm ? 'cuadra' : 'fuera_de_tolerancia', diferenciaPpm: ppm, diferenciaUsdMicro: dif };
}
