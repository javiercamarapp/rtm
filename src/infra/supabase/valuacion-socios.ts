// Lectura de api.cuenta_socios_valuacion (sesion del usuario, llave publica; nunca la de servicio). Solo socios: la base exige el rol dentro de la funcion.
import type { CuentaSociosValuacion } from '@/dominio/socios/valuacion';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

export async function leerCuentaSociosValuacion(hasta: string | null): Promise<CuentaSociosValuacion> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc('cuenta_socios_valuacion', { p_hasta: hasta });
  if (error) throw new Error(`cuenta_socios_valuacion: ${error.message}`);
  return centavosABigint<CuentaSociosValuacion>(data);
}
