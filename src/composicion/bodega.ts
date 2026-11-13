// Raiz de composicion de la vista de bodega. Las paginas de app/(bodega) importan de aqui, nunca de infra.
import { leer, type LecturaBodega } from '@/aplicacion/bodega/bodega';
import type { HoyAPreparar, Llegadas } from '@/dominio/bodega/bodega';
import { lectorBodegaSupabase } from '@/infra/supabase/bodega';
import { exigirBodega } from './acceso';

export async function hoyDeBodega(): Promise<LecturaBodega<HoyAPreparar>> {
  await exigirBodega();
  return leer(() => lectorBodegaSupabase().hoy());
}
export async function llegadasDeBodega(): Promise<LecturaBodega<Llegadas>> {
  await exigirBodega();
  return leer(() => lectorBodegaSupabase().llegadas());
}
