// Pulso del armazon: lee cuatro cuentas con la sesion del socio. Una lectura que falla no tumba la pagina: ese chip queda en "Sin dato".
import { armarPulso, type Pulso } from '@/dominio/operacion/pulso';
import { lectorCatalogoSupabase } from '@/infra/supabase/lector-catalogo';
import { lectorOperacionSupabase } from '@/infra/supabase/operacion';
import { leerCuentaSociosValuacion } from '@/infra/supabase/valuacion-socios';
import { exigirSocio } from './acceso';

const valor = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

export async function leerPulso(): Promise<Pulso> {
  const { perfil } = await exigirSocio();
  const yo = perfil.socio_nombre === 'Angelo' || perfil.socio_nombre === 'Javier' ? perfil.socio_nombre : null;
  const op = lectorOperacionSupabase();
  const [isaac, cxc, socios, existencia, val] = await Promise.allSettled([op.cuentaProveedor('Isaac'), op.cuentasPorCobrar(), op.cuentaSocios(), lectorCatalogoSupabase().existencia(), leerCuentaSociosValuacion(null)]);
  const cuenta = valor(val);
  return armarPulso({ isaac: valor(isaac), cxc: valor(cxc), socios: valor(socios), existencia: valor(existencia), valuacion: yo && cuenta ? { cuenta, yo } : null });
}
