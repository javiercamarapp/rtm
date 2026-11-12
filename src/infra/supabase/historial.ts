// Implementa el puerto del historial con las funciones api.* de la migracion 20261112400000 (sesion del usuario, llave publica; nunca la de servicio).
import type { LectorHistorial } from '@/aplicacion/historial/puertos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';
import { explicacion, llamar } from './lector-catalogo';

async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export function lectorHistorialSupabase(): LectorHistorial {
  return {
    historial: (socio, hasta) => leer('historial_socio', { p_socio: socio, p_hasta: hasta }),
    acta: (id) => leer('acta_detalle', { p_cierre: id }),
    periodoSugerido: () => leer('acta_periodo_sugerido'),
    explicar: (cifra) => llamar('explicar_historial', { p_cifra: cifra }, explicacion),
  };
}
