// Raiz de composicion de "Sabores por revisar": solo socios. Las paginas y acciones importan de aqui, nunca de infra.
import type { PreguntaDuplicado, ResultadoRespuesta } from '@/dominio/catalogo/duplicados';
import { duplicadosSupabase, type UnificacionReciente } from '@/infra/supabase/duplicados';
import { exigirSocio } from './acceso';

export type { UnificacionReciente };
export type ResultadoDuplicados<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

export async function preguntasDeSocio(): Promise<{ preguntas: PreguntaDuplicado[]; recientes: UnificacionReciente[] }> {
  await exigirSocio();
  const [preguntas, recientes] = await Promise.all([duplicadosSupabase.pendientes(null), duplicadosSupabase.recientes(5)]);
  return { preguntas, recientes };
}

async function operar<T>(fn: () => Promise<T>): Promise<ResultadoDuplicados<T>> {
  await exigirSocio();
  try {
    return { ok: true, datos: await fn() };
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    return { ok: false, mensaje: /ya usa otro sabor|ese nombre ya lo usa/.test(m) ? 'Ese nombre ya lo usa otro sabor.' : 'No se pudo completar. Intenta de nuevo.' };
  }
}

export const responderDeSocio = (clave: string, id: number, respuesta: 'si' | 'no', canonicoId: number | null, nombreFinal: string | null): Promise<ResultadoDuplicados<ResultadoRespuesta>> =>
  operar(() => duplicadosSupabase.responder(clave, id, respuesta, canonicoId, nombreFinal));
export const deshacerDeSocio = (clave: string, unificacionId: number): Promise<ResultadoDuplicados<{ estado: string }>> => operar(() => duplicadosSupabase.deshacer(clave, unificacionId));
