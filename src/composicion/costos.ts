// Raiz de composicion de costos del sistema para las paginas de socio.
import { lectorCostosSupabase, type LectorCostos } from '@/infra/supabase/costos';
import { exigirSocio } from './acceso';

export async function costosDeSocio(): Promise<LectorCostos> {
  await exigirSocio();
  return lectorCostosSupabase();
}
