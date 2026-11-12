// Raiz de composicion de las paginas de reportes (sesion del socio). Generar un reporte es un trabajo del sistema (rol servidor) que un socio puede pedir.
import { fechaNeg } from '@/dominio/calendario';
import { sqlServidor } from '@/infra/postgres/servidor';
import { appUrl } from '@/config/env';
import { htmlDeReporte, historialReportes, pdfDeReporte } from '@/infra/supabase/reportes';
import { periodoDeReporte } from './produccion';
import { exigirSocio } from './acceso';

export async function reportesDeSocio() {
  await exigirSocio();
  return { historial: historialReportes, html: htmlDeReporte, pdf: pdfDeReporte };
}

export type ResultadoPedirReporte = { ok: true; clave: string; salio: boolean; aviso?: string } | { ok: false; mensaje: string };

/** Prepara (o reemite) el reporte de un periodo. Idempotente: el mismo paquete no genera version nueva. */
export async function pedirReporte(tipo: 'semanal' | 'mensual', inicio: string | null): Promise<ResultadoPedirReporte> {
  await exigirSocio();
  const desde = inicio ?? periodoDeReporte(tipo, fechaNeg(new Date()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return { ok: false, mensaje: 'La fecha de inicio debe ser AAAA-MM-DD.' };
  try {
    const { generarReporteDeSistema } = await import('./reportes_sistema');
    const r = await generarReporteDeSistema({ sql: sqlServidor, urlApp: appUrl() }, tipo, desde);
    return { ok: true, clave: `${tipo}:${desde}`, salio: r.salio, ...(r.salio ? {} : { aviso: r.aviso }) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error && e.message.length < 200 ? e.message : 'No se pudo preparar el reporte.' };
  }
}
