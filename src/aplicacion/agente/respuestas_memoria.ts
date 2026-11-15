// El id de una pregunta pendiente (sabores duplicados, alias, dato faltante) SIEMPRE sale de la memoria del servidor, nunca del modelo (decision del dueno, 14-nov).
// El esquema estricto del modelo no tiene `pregunta_id`: un modelo que lo mande es rechazado por zod. Este modulo liga la respuesta si/no del modelo con la pregunta que el servidor recuerda.
import type { Intencion } from '@/dominio/agente/intenciones';

export type TipoPreguntaServidor = 'sabor_duplicado' | 'alias' | 'slot';

/** Lo que el servidor recuerda de la ultima pregunta abierta del chat. */
export interface PreguntaPendienteServidor {
  id: string;
  tipo: TipoPreguntaServidor;
  /** Texto de la pregunta que se le hizo al socio (va al prompt como pregunta_pendiente_del_bot). */
  texto: string;
}

export type VinculoRespuesta =
  | { ok: true; preguntaId: string; respuesta: 'si' | 'no' | 'no_se' | null; valorTexto: string | null }
  | { ok: false; motivo: 'sin_pregunta_pendiente' | 'otra_pregunta' | 'no_es_respuesta' };

const ESPERADA = { sabor_respuesta: 'sabor_duplicado', alias_respuesta: 'alias', slot_respuesta: 'slot' } as const;

/**
 * Liga una respuesta extraida (sabor_respuesta, alias_respuesta o slot_respuesta) con la pregunta pendiente que el servidor recuerda.
 * Sin pregunta pendiente, o con una de otro tipo, NO se aplica nada: una respuesta suelta jamas cierra ni unifica por su cuenta.
 */
export function vincularRespuesta(a: Intencion, pendiente: PreguntaPendienteServidor | null): VinculoRespuesta {
  if (a.tipo !== 'sabor_respuesta' && a.tipo !== 'alias_respuesta' && a.tipo !== 'slot_respuesta') return { ok: false, motivo: 'no_es_respuesta' };
  if (pendiente === null) return { ok: false, motivo: 'sin_pregunta_pendiente' };
  if (pendiente.tipo !== ESPERADA[a.tipo]) return { ok: false, motivo: 'otra_pregunta' };
  return {
    ok: true,
    preguntaId: pendiente.id,
    respuesta: a.tipo === 'slot_respuesta' ? null : a.respuesta,
    valorTexto: a.tipo === 'slot_respuesta' ? a.valor_texto : null,
  };
}
