'use server';

import type { ResultadoEmpaque } from '@/aplicacion/bodega/bodega';
import { cerrarSesionYSalir } from '@/composicion/acceso';
import { empacarDeBodega } from '@/composicion/bodega';

export async function salir(): Promise<void> {
  await cerrarSesionYSalir();
}

export async function empacarAccion(clave: string, folio: string): Promise<ResultadoEmpaque> {
  if (typeof clave !== 'string' || typeof folio !== 'string') return { ok: false, mensaje: 'Datos inválidos.' };
  return empacarDeBodega(clave.slice(0, 80), folio.slice(0, 20));
}
