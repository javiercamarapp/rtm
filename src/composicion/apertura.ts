// Raiz de composicion de la apertura y de la zona Movimientos. Las paginas importan de aqui, nunca de infra.
import type { LectorApertura } from '@/aplicacion/apertura/puertos';
import type { LectorMovimientos } from '@/aplicacion/movimientos/puertos';
import { lectorAperturaSupabase } from '@/infra/supabase/apertura';
import { lectorMovimientosSupabase } from '@/infra/supabase/movimientos';
import { exigirSocio } from './acceso';

export async function aperturaDeSocio(): Promise<LectorApertura> {
  await exigirSocio();
  return lectorAperturaSupabase();
}

export async function movimientosDeSocio(): Promise<LectorMovimientos> {
  await exigirSocio();
  return lectorMovimientosSupabase();
}
