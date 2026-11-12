// Raiz de composicion de la serie semanal de Contabilidad: exige sesion de socio antes de tocar la base.
import type { SerieSemanal } from '@/dominio/contabilidad/serie';
import { leerSerieSemanal } from '@/infra/supabase/contabilidad-serie';
import { exigirSocio } from './acceso';

export async function serieSemanalDeSocio(semanas = 12): Promise<SerieSemanal> {
  await exigirSocio();
  return leerSerieSemanal(semanas);
}
