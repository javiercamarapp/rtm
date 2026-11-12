// Implementa el puerto de movimientos con las funciones api.mov_* (sesion del usuario, llave publica; nunca la de servicio).
import type { LectorMovimientos } from '@/aplicacion/movimientos/puertos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export function lectorMovimientosSupabase(): LectorMovimientos {
  return {
    resumen: () => leer('mov_resumen'),
    lista: (estado, limite, desplazamiento) => leer('mov_lista', { p_estado: estado, p_limite: limite, p_desplazamiento: desplazamiento }),
    agrupado: (dim) => leer('mov_agrupado', { p_dim: dim }),
    desglose: (dim, id) => leer('mov_desglose', { p_dim: dim, p_id: id }),
    utilidad: () => leer('mov_utilidad'),
    referencias: () => leer('mov_referencias'),
    candidatas: (movimientoId) => leer('mov_candidatas', { p_mov: movimientoId }),
  };
}
