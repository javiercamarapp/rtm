'use server';

import { pedirReporte, type ResultadoPedirReporte } from '@/composicion/reportes';

export async function prepararReporte(tipo: 'semanal' | 'mensual', inicio: string | null): Promise<ResultadoPedirReporte> {
  if (tipo !== 'semanal' && tipo !== 'mensual') return { ok: false, mensaje: 'Tipo de reporte desconocido.' };
  return pedirReporte(tipo, inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : null);
}
