'use server';

import type { ResultadoRespuesta } from '@/dominio/catalogo/duplicados';
import { deshacerDeSocio, responderDeSocio, type ResultadoDuplicados } from '@/composicion/duplicados';

const CLAVE = /^web:[0-9a-f-]{8,64}$/;
const invalida = { ok: false, mensaje: 'Solicitud inválida. Recarga la página.' } as const;

/** "Sí, es lo mismo" (unifica, con el canonico y el nombre final elegidos) o "No, son distintos" (guarda el negativo). La base decide; aquí solo se valida la forma. */
export async function responderDuplicadoAccion(claveIdem: string, id: number, respuesta: 'si' | 'no', canonicoId: number | null, nombreFinal: string | null): Promise<ResultadoDuplicados<ResultadoRespuesta>> {
  if (!CLAVE.test(claveIdem) || !Number.isInteger(id) || id <= 0 || (respuesta !== 'si' && respuesta !== 'no')) return invalida;
  if (canonicoId !== null && (!Number.isInteger(canonicoId) || canonicoId <= 0)) return invalida;
  const nombre = typeof nombreFinal === 'string' && nombreFinal.trim() !== '' ? nombreFinal.trim() : null;
  if (nombre !== null && nombre.length > 40) return { ok: false, mensaje: 'El nombre es muy largo (máximo 40 caracteres).' };
  return responderDeSocio(claveIdem, id, respuesta, canonicoId, nombre);
}

export async function deshacerUnificacionAccion(claveIdem: string, unificacionId: number): Promise<ResultadoDuplicados<{ estado: string }>> {
  if (!CLAVE.test(claveIdem) || !Number.isInteger(unificacionId) || unificacionId <= 0) return invalida;
  return deshacerDeSocio(claveIdem, unificacionId);
}
