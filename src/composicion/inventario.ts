// Raiz de composicion del inventario y las notificaciones. Las paginas y acciones importan de aqui, nunca de infra.
import { exportarInventario, type InventarioExportado } from '@/aplicacion/inventario/exportar';
import type { EscritorInventario, GeneradorPdfInventario, LectorInventario } from '@/aplicacion/inventario/puertos';
import type { EscritorNotificaciones, LectorNotificaciones } from '@/aplicacion/notificaciones/puertos';
import type { ParametrosInventario, VersionInventario } from '@/dominio/inventario/tipos';
import { huella } from '@/infra/pdf/nota';
import { pdfInventario } from '@/infra/pdf/inventario';
import { ErrorInventario, escritorInventarioSupabase, lectorInventarioSupabase } from '@/infra/supabase/inventario';
import { escritorNotificacionesSupabase, lectorNotificacionesSupabase } from '@/infra/supabase/notificaciones';
import { exigirSocio } from './acceso';

const generador: GeneradorPdfInventario = { generar: pdfInventario, huella };

export async function inventarioDeSocio(): Promise<LectorInventario> {
  await exigirSocio();
  return lectorInventarioSupabase();
}

export async function escritorInventarioDeSocio(): Promise<EscritorInventario> {
  await exigirSocio();
  return escritorInventarioSupabase();
}

export async function notificacionesDeSocio(): Promise<LectorNotificaciones> {
  await exigirSocio();
  return lectorNotificacionesSupabase();
}

export async function escritorNotificacionesDeSocio(): Promise<EscritorNotificaciones> {
  await exigirSocio();
  return escritorNotificacionesSupabase();
}

export type ResultadoInventario<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

function mensajeDe(e: unknown): string {
  if (e instanceof ErrorInventario) return e.message;
  return 'No se pudo completar. Intenta de nuevo.';
}

export async function exportarInventarioDeSocio(claveIdem: string, version: VersionInventario, params: Partial<ParametrosInventario>): Promise<ResultadoInventario<InventarioExportado>> {
  await exigirSocio();
  try {
    return { ok: true, datos: await exportarInventario({ escritor: escritorInventarioSupabase(), pdf: generador }, claveIdem, version, params) };
  } catch (e) {
    return { ok: false, mensaje: mensajeDe(e) };
  }
}

export async function operarConteo<T>(fn: (e: EscritorInventario) => Promise<T>): Promise<ResultadoInventario<T>> {
  await exigirSocio();
  try {
    return { ok: true, datos: await fn(escritorInventarioSupabase()) };
  } catch (e) {
    return { ok: false, mensaje: mensajeDe(e) };
  }
}
