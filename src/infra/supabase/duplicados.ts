// Puertas de la web para la unificacion de sabores: api.duplicados_pendientes / duplicado_responder / sabor_unificacion_deshacer (sesion del socio, llave publica).
import type { PreguntaDuplicado, ResultadoRespuesta } from '@/dominio/catalogo/duplicados';
import { crearClienteServidor } from './cliente-servidor';

export interface UnificacionReciente { id: number; origen: string; destino: string; estado: 'aplicada' | 'deshecha'; creada_at: string; skus: number }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export const duplicadosSupabase = {
  pendientes: (tipo: string | null = null) => rpc<PreguntaDuplicado[]>('duplicados_pendientes', { p_tipo: tipo }),
  responder: (clave: string, id: number, respuesta: 'si' | 'no', canonicoId: number | null, nombreFinal: string | null) =>
    rpc<ResultadoRespuesta>('duplicado_responder', { p_clave_idem: clave, p_id: id, p_respuesta: respuesta, p_canonico_id: canonicoId, p_nombre_final: nombreFinal }),
  deshacer: (clave: string, unificacionId: number) => rpc<{ estado: string }>('sabor_unificacion_deshacer', { p_clave_idem: clave, p_unificacion_id: unificacionId }),
  recientes: (limite = 5) => rpc<UnificacionReciente[]>('sabor_unificaciones', { p_limite: limite }),
};
