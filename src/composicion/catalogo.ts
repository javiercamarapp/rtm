// Raiz de composicion del catalogo, los clientes y el inventario. Las paginas importan de aqui, nunca de infra.
import { exigirSocio } from './acceso';
import type { EscritorCatalogo, LectorCatalogo } from '@/aplicacion/catalogo/puertos';
import { escritorCatalogoSupabase, lectorCatalogoSupabase } from '@/infra/supabase/lector-catalogo';

/** Lector para paginas de socio: exige sesion de socio ANTES de tocar la base (la autoridad igual es la funcion SQL). */
export async function lectorDeSocio(): Promise<LectorCatalogo> {
  await exigirSocio();
  return lectorCatalogoSupabase();
}

export async function escritorDeSocio(): Promise<EscritorCatalogo> {
  await exigirSocio();
  return escritorCatalogoSupabase();
}
