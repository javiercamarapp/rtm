// Raiz de composicion de los contactos de menudeo. Solo socios (Omar nunca): se exige sesion de socio ANTES de tocar la base y la autoridad igual es la funcion SQL.
import { exigirSocio } from './acceso';
import type { LectorContactos } from '@/aplicacion/contactos/puertos';
import { lectorContactosSupabase } from '@/infra/supabase/lector-contactos';

export async function lectorContactosDeSocio(): Promise<LectorContactos> {
  await exigirSocio();
  return lectorContactosSupabase();
}
