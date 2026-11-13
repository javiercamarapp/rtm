// Acceso de solo lectura a api.capital_por_mes (sesion del usuario, llave publica; nunca la de servicio).
import type { CapitalPorMes } from '@/dominio/capital/tipos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

export async function leerCapitalPorMes(desde: string | null, hasta: string | null): Promise<CapitalPorMes> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc('capital_por_mes', { p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(`capital_por_mes: ${error.message}`);
  return centavosABigint<CapitalPorMes>(data);
}
