// Raiz de composicion de dropshipping. Solo socios (Omar nunca): se exige sesion de socio ANTES de tocar la base y la autoridad igual es la funcion SQL.
import type { LectorDropshipping } from '@/aplicacion/dropshipping/puertos';
import { lectorDropshippingSupabase } from '@/infra/supabase/dropshipping';
import { exigirSocio } from './acceso';

export async function dropshippingDeSocio(): Promise<LectorDropshipping> {
  await exigirSocio();
  return lectorDropshippingSupabase();
}
