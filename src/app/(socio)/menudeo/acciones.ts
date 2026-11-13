'use server';

import { dropshippingDeSocio } from '@/composicion/dropshipping';

export type RespuestaEvidencia = { ok: true; mime: string; nombre: string; sha256: string; b64: string } | { ok: false; mensaje: string };

/** Descarga la evidencia de un pago (solo socios en la web). La base registra cada lectura; el modelo de IA y Telegram nunca la leen. */
export async function evidenciaAccion(reporteId: number): Promise<RespuestaEvidencia> {
  if (!Number.isInteger(reporteId) || reporteId < 1) return { ok: false, mensaje: 'Solicitud inválida.' };
  try {
    const e = await (await dropshippingDeSocio()).evidencia(reporteId);
    return e ? { ok: true, ...e } : { ok: false, mensaje: 'Este pago no tiene evidencia adjunta.' };
  } catch {
    return { ok: false, mensaje: 'No se pudo abrir la evidencia. Intenta de nuevo.' };
  }
}
