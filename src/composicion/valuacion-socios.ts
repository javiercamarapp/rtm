// Raiz de composicion de la valuacion por socio: exige sesion de socio antes de tocar la base. Las paginas importan de aqui, nunca de infra.
import type { CuentaSociosValuacion, Socio } from '@/dominio/socios/valuacion';
import { leerCuentaSociosValuacion } from '@/infra/supabase/valuacion-socios';
import { exigirSocio } from './acceso';

export async function valuacionDeSocios(hasta: string | null = null): Promise<{ cuenta: CuentaSociosValuacion; yo: Socio | null }> {
  const { perfil } = await exigirSocio();
  const yo = perfil.socio_nombre === 'Angelo' || perfil.socio_nombre === 'Javier' ? perfil.socio_nombre : null;
  return { cuenta: await leerCuentaSociosValuacion(hasta), yo };
}
