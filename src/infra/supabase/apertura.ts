// Implementa el puerto de apertura con las funciones api.apertura_* (sesion del usuario, llave publica; nunca la de servicio).
import type { LectorApertura } from '@/aplicacion/apertura/puertos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export function lectorAperturaSupabase(): LectorApertura {
  return {
    estado: (sesion) => leer('apertura_estado', { p_sesion: sesion }),
    catalogos: () => leer('apertura_catalogos'),
    vistaPrevia: (sesion) => leer('apertura_vista_previa', { p_sesion: sesion }),
    ensayo: (sesion) => leer('apertura_ensayo', { p_sesion: sesion }),
  };
}
