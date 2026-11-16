// Raiz de composicion de la vista de bodega. Las paginas de app/(bodega) importan de aqui, nunca de infra.
import { empacar, leer, type LecturaBodega, type ResultadoEmpaque } from '@/aplicacion/bodega/bodega';
import type { HoyAPreparar, Llegadas } from '@/dominio/bodega/bodega';
import { accionesBodegaSupabase, lectorBodegaSupabase } from '@/infra/supabase/bodega';
import { exigirBodega } from './acceso';

export async function hoyDeBodega(): Promise<LecturaBodega<HoyAPreparar>> {
  await exigirBodega();
  return leer(() => lectorBodegaSupabase().hoy());
}
export async function llegadasDeBodega(): Promise<LecturaBodega<Llegadas>> {
  await exigirBodega();
  return leer(() => lectorBodegaSupabase().llegadas());
}
export async function empacarDeBodega(clave: string, folio: string): Promise<ResultadoEmpaque> {
  await exigirBodega();
  return empacar(accionesBodegaSupabase(), clave, folio);
}
