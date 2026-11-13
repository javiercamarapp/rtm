// Raiz de composicion de Capital por mes: exige sesion de socio antes de tocar la base.
import type { CapitalPorMes, NombreSocio } from '@/dominio/capital/tipos';
import { leerCapitalPorMes } from '@/infra/supabase/capital';
import { exigirSocio } from './acceso';

export async function capitalDeSocio(desde: string | null, hasta: string | null): Promise<{ datos: CapitalPorMes; mio: NombreSocio | null }> {
  const { perfil } = await exigirSocio();
  const mio = perfil.socio_nombre === 'Angelo' || perfil.socio_nombre === 'Javier' ? perfil.socio_nombre : null;
  return { datos: await leerCapitalPorMes(desde, hasta), mio };
}
