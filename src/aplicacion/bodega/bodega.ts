// Casos de uso de la vista de bodega: solo lectura. La base valida el rol dentro de cada funcion (bodega activo o socio en vista previa).
import type { HoyAPreparar, Llegadas } from '@/dominio/bodega/bodega';

export interface LectorBodega {
  hoy(): Promise<HoyAPreparar>;
  llegadas(): Promise<Llegadas>;
}

/** Una lectura que falla se muestra como error en palabras; nunca como ceros inventados. */
export type LecturaBodega<T> = { estado: 'ok'; datos: T } | { estado: 'error' };

export async function leer<T>(f: () => Promise<T>): Promise<LecturaBodega<T>> {
  try {
    return { estado: 'ok', datos: await f() };
  } catch {
    return { estado: 'error' };
  }
}
