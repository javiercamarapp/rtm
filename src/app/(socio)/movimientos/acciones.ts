'use server';

import { movimientosDeSocio } from '@/composicion/apertura';
import type { Candidata } from '@/dominio/movimientos/tipos';

/** Hechos existentes con la misma suma y sentido que un movimiento, para elegir la contraparte de la conciliacion. */
export async function candidatasAccion(tipo: string, montoCent: number): Promise<Candidata[]> {
  if ((tipo !== 'pago' && tipo !== 'gasto' && tipo !== 'aportacion') || !Number.isSafeInteger(montoCent) || montoCent === 0) return [];
  return (await movimientosDeSocio()).candidatas(tipo, BigInt(montoCent));
}
