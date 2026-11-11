'use server';

import { aperturaDeSocio } from '@/composicion/apertura';
import type { EnsayoApertura } from '@/dominio/apertura/tipos';

export type ResultadoEnsayo = { ok: true; ensayo: EnsayoApertura } | { ok: false; mensaje: string };

/** Ensayo: publica de verdad dentro de una subtransaccion de la base y la deshace. No deja asientos, movimientos ni folios. */
export async function ensayoAccion(sesion: number): Promise<ResultadoEnsayo> {
  if (!Number.isInteger(sesion) || sesion <= 0) return { ok: false, mensaje: 'Sesión inválida.' };
  try {
    return { ok: true, ensayo: await (await aperturaDeSocio()).ensayo(sesion) };
  } catch (e) {
    const m = e instanceof Error ? e.message.replace(/^apertura_ensayo:\s*/, '') : '';
    return { ok: false, mensaje: m || 'No se pudo hacer el ensayo.' };
  }
}
