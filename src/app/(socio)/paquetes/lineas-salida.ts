'use server';

import { operacionDeSocio } from '@/composicion/operacion';
import type { SalidaLineaIncidente } from '@/dominio/operacion/tipos';

/** Renglones surtidos de un pedido enviado (menos lo ya reportado) para el reporte de paquete perdido o danado. La autoridad es la funcion SQL (rol socio). */
export async function lineasSalida(pedidoId: number): Promise<SalidaLineaIncidente[]> {
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) return [];
  const lector = await operacionDeSocio();
  return lector.salidaLineasIncidente(pedidoId);
}
