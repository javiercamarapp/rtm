// Implementa el puerto de contabilidad con las funciones api.conta_* (sesion del usuario, llave publica; nunca la de servicio).
import type { LectorContabilidad } from '@/aplicacion/contabilidad/puertos';
import { centavosABigint } from '@/dominio/operacion/json';
import { crearClienteServidor } from './cliente-servidor';

async function leer<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return centavosABigint<T>(data);
}

export function lectorContabilidadSupabase(): LectorContabilidad {
  return {
    diario: (ini, fin, limite) => leer('conta_diario', { p_ini: ini, p_fin: fin, p_limite: limite }),
    verificarAsiento: (id) => leer('conta_asiento', { p_asiento: id }),
    cuentas: (hasta) => leer('conta_mayor', { p_cuenta: null, p_fin: hasta }),
    mayor: (cuenta, ini, fin) => leer('conta_mayor', { p_cuenta: cuenta, p_ini: ini, p_fin: fin }),
    estadoResultados: (ini, fin) => leer('conta_estado_resultados', { p_ini: ini, p_fin: fin }),
    balance: (hasta) => leer('conta_balance', { p_hasta: hasta }),
    flujo: (ini, fin) => leer('conta_flujo', { p_ini: ini, p_fin: fin }),
    valuacion: (hasta) => leer('conta_valuacion', { p_hasta: hasta }),
    comprobaciones: () => leer('conta_comprobaciones'),
    periodos: () => leer('conta_periodos'),
  };
}
