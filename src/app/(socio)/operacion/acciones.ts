'use server';

import { ejecutarAccionDeSocio } from '@/composicion/operacion';
import type { ResultadoAccion } from '@/dominio/operacion/tipos';

/** Unica puerta de escritura de las pantallas de F2. La lista cerrada de acciones y la clave de idempotencia se validan en la composicion; la autoridad es la funcion SQL. */
export async function ejecutar(accion: string, args: Record<string, unknown>): Promise<ResultadoAccion> {
  return ejecutarAccionDeSocio(accion, args);
}
