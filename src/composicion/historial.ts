// Raiz de composicion del historial personal y del acta de corte. Las paginas importan de aqui, nunca de infra.
import type { LectorHistorial } from '@/aplicacion/historial/puertos';
import { pdfActaCorte } from '@/infra/pdf/acta';
import { pdfHistorialSocio } from '@/infra/pdf/historial';
import { huella } from '@/infra/pdf/nota';
import { lectorHistorialSupabase } from '@/infra/supabase/historial';
import { exigirSocio } from './acceso';

export async function historialDeSocio(): Promise<LectorHistorial> {
  await exigirSocio();
  return lectorHistorialSupabase();
}

export interface PdfEntregable { bytes: Uint8Array; nombre: string; sha256: string }

/** PDF del acta (con sello si ya se cerro). null si no existe o esta anulada. */
export async function pdfDeActa(id: number): Promise<PdfEntregable | null> {
  const d = await (await historialDeSocio()).acta(id);
  if (!d || d.cierre.estado === 'anulado') return null;
  const bytes = await pdfActaCorte(d.cierre, d.sello);
  return { bytes, nombre: `${d.cierre.folio}.pdf`, sha256: huella(bytes) };
}

/** Estado de cuenta personal en PDF. */
export async function pdfDeHistorial(socio: 'Angelo' | 'Javier'): Promise<PdfEntregable> {
  const h = await (await historialDeSocio()).historial(socio, null);
  const bytes = await pdfHistorialSocio(h);
  return { bytes, nombre: `estado-${socio}-${h.hoy}.pdf`, sha256: huella(bytes) };
}
