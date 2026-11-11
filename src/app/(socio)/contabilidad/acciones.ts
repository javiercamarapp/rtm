'use server';

import { contabilidadDeSocio } from '@/composicion/contabilidad';
import type { VerificacionAsiento } from '@/dominio/contabilidad/tipos';

/** Botón "Verificar" de un asiento: las cuatro comprobaciones se calculan en la base. */
export async function verificarAsientoAccion(id: number): Promise<VerificacionAsiento> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('asiento invalido');
  return (await contabilidadDeSocio()).verificarAsiento(id);
}
