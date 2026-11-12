// Raiz de composicion de las lecturas enterprise (inventario, valuacion, caja, libro). Las paginas importan de aqui, nunca de infra.
import type { LectorDatos } from '@/aplicacion/datos/puertos';
import { lectorDatosSupabase } from '@/infra/supabase/datos-enterprise';
import { exigirSocio } from './acceso';

export async function datosDeSocio(): Promise<LectorDatos> {
  await exigirSocio();
  return lectorDatosSupabase();
}
