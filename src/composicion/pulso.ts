// Pulso del armazon: lee cuatro cuentas con la sesion del socio. Una lectura que falla no tumba la pagina: ese chip queda en "Sin dato".
import { armarPulso, type Pulso } from '@/aplicacion/operacion/pulso';
import { lectorCatalogoSupabase } from '@/infra/supabase/lector-catalogo';
import { lectorOperacionSupabase } from '@/infra/supabase/operacion';
import { exigirSocio } from './acceso';

const valor = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

export async function leerPulso(): Promise<Pulso> {
  await exigirSocio();
  const op = lectorOperacionSupabase();
  const [isaac, cxc, socios, existencia] = await Promise.allSettled([op.cuentaProveedor('Isaac'), op.cuentasPorCobrar(), op.cuentaSocios(), lectorCatalogoSupabase().existencia()]);
  return armarPulso({ isaac: valor(isaac), cxc: valor(cxc), socios: valor(socios), existencia: valor(existencia) });
}
