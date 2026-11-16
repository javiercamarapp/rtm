// Raiz de composicion de costos del sistema para las paginas de socio.
import { lectorCostosSupabase, type LectorCostos } from '@/infra/supabase/costos';
import { exigirSocio } from './acceso';

export async function costosDeSocio(): Promise<LectorCostos> {
  await exigirSocio();
  return lectorCostosSupabase();
}

import { configPrivada } from '@/config/privada';
import { leerUsoDeLaLlave } from '@/infra/costos/openrouter_en_vivo';

/** OpenRouter en vivo (lo que dice OpenRouter de la llave de RTM) junto al libro propio del mes. La lectura externa puede ser null (sin llave o sin red). */
export async function openRouterEnVivoDeSocio(mes: string) {
  const lector = await costosDeSocio();
  const [libro, externo] = await Promise.all([lector.iaLibro(mes), leerUsoDeLaLlave(configPrivada().OPENROUTER_API_KEY)]);
  return { libro, externo };
}
