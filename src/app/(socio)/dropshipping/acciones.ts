'use server';

import { dropshippingDeSocio } from '@/composicion/dropshipping';

export type RespuestaOrden = { ok: true; texto: string; falta_destinatario: boolean; completo: boolean } | { ok: false; mensaje: string };
export type RespuestaRevelar = { ok: true; valor: string } | { ok: false; mensaje: string };

/** Orden lista para copiar. Con `completo` entrega el bloque completo del destinatario y la base deja el registro (quien, cuando). Sin sesion de socio no llega a la base. */
export async function textoOrdenAccion(pedidoId: number, completo: boolean): Promise<RespuestaOrden> {
  if (!Number.isInteger(pedidoId) || pedidoId < 1) return { ok: false, mensaje: 'Solicitud inválida.' };
  try {
    const o = await (await dropshippingDeSocio()).orden(pedidoId, completo === true);
    return { ok: true, texto: o.texto, falta_destinatario: o.falta_destinatario, completo: o.completo };
  } catch {
    return { ok: false, mensaje: 'No se pudo armar la orden. Intenta de nuevo.' };
  }
}

/** Boton "Revelar": telefono o correo completos, auditado en la base. */
export async function revelarDestinatarioAccion(pedidoId: number, campo: 'telefono' | 'correo'): Promise<RespuestaRevelar> {
  if (!Number.isInteger(pedidoId) || pedidoId < 1 || (campo !== 'telefono' && campo !== 'correo')) return { ok: false, mensaje: 'Solicitud inválida.' };
  try {
    return { ok: true, valor: await (await dropshippingDeSocio()).revelar(pedidoId, campo, 'revelar en pantalla') };
  } catch {
    return { ok: false, mensaje: 'No se pudo revelar. Intenta de nuevo.' };
  }
}
