// Acceso de solo lectura a api.conta_serie_semanal (sesion del usuario, llave publica; nunca la de servicio).
import type { SerieSemanal } from '@/dominio/contabilidad/serie';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

export async function leerSerieSemanal(semanas = 12): Promise<SerieSemanal> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc('conta_serie_semanal', { p_semanas: semanas });
  if (error) throw new Error(`conta_serie_semanal: ${error.message}`);
  return centavosABigint<SerieSemanal>(data);
}
