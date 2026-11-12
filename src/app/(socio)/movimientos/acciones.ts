'use server';

import { movimientosDeSocio } from '@/composicion/apertura';
import type { Candidata } from '@/dominio/movimientos/tipos';

/** Hechos vigentes que sirven de contraparte de un movimiento clasificado (la base decide tipo, suma, sentido y uso), para elegir con cual conciliar. */
export async function candidatasAccion(movimientoId: number): Promise<Candidata[]> {
  if (!Number.isSafeInteger(movimientoId) || movimientoId <= 0) return [];
  return (await movimientosDeSocio()).candidatas(movimientoId);
}
