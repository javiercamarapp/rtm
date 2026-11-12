// Raiz de composicion del historial personal y del acta de corte. Las paginas importan de aqui, nunca de infra.
import type { LectorHistorial } from '@/aplicacion/historial/puertos';
import { lectorHistorialSupabase } from '@/infra/supabase/historial';
import { exigirSocio } from './acceso';

export async function historialDeSocio(): Promise<LectorHistorial> {
  await exigirSocio();
  return lectorHistorialSupabase();
}
