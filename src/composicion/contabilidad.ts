// Raiz de composicion de la seccion Contabilidad. Las paginas importan de aqui, nunca de infra.
import type { LectorContabilidad } from '@/aplicacion/contabilidad/puertos';
import { lectorContabilidadSupabase } from '@/infra/supabase/contabilidad';
import { exigirSocio } from './acceso';

/** Lector para paginas de socio: exige sesion de socio ANTES de tocar la base (la autoridad igual es la funcion SQL). */
export async function contabilidadDeSocio(): Promise<LectorContabilidad> {
  await exigirSocio();
  return lectorContabilidadSupabase();
}
