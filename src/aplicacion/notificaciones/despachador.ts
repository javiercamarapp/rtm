// Despachador: UNA salida. El latido llama `despacharUnaVez`; el repositorio (funciones notificacion.* de la base) decide quien sale, en que orden,
// con que limites y cuanto se espera; el enviador del canal (Telegram o correo, que llegan en M2) solo dice que paso. El texto se rinde al despachar.
export type ResultadoEnvio =
  | { resultado: 'ok'; mensajeId?: string }
  | { resultado: '429'; retryAfter: number }
  | { resultado: '5xx' | 'red'; codigo?: string; incierto?: boolean }
  | { resultado: '403' | '400_formato'; codigo?: string }
  | { resultado: '400_migrar'; migrarA: number };

export interface MiembroLote {
  entrega_id: number; notificacion_id: number; tipo: string; severidad: 'C' | 'I' | 'F'; version: number; titulo: string;
  payload: Record<string, unknown>; entidad_tipo: string | null; entidad_id: number | null; conteo: number; requiere_accion: boolean; botones: string[]; reenvio: boolean;
}
export interface LoteEntrega { canal: 'telegram' | 'correo'; destino: string; grupo_clave: string | null; silencioso: boolean; telegram_chat_id: number | null; miembros: MiembroLote[] }

export interface RepositorioEntregas {
  reclamar(limite: number): Promise<LoteEntrega[]>;
  registrar(entregaId: number, r: ResultadoEnvio): Promise<string>;
}
export interface EnviadorCanal { enviar(lote: LoteEntrega): Promise<ResultadoEnvio> }

export interface ResumenDespacho { lotes: number; enviadas: number; reintentos: number; muertas: number }

export async function despacharUnaVez(repo: RepositorioEntregas, enviadores: Partial<Record<'telegram' | 'correo', EnviadorCanal>>, limite = 10): Promise<ResumenDespacho> {
  const lotes = await repo.reclamar(limite);
  const resumen: ResumenDespacho = { lotes: lotes.length, enviadas: 0, reintentos: 0, muertas: 0 };
  for (const lote of lotes) {
    const enviador = enviadores[lote.canal];
    // Sin enviador del canal (en M1 no existe) la entrega vuelve a la cola sin gastar un intento real: nada se pierde y la campana ya mostro el aviso.
    const r: ResultadoEnvio = enviador ? await enviador.enviar(lote).catch((): ResultadoEnvio => ({ resultado: 'red', incierto: true })) : { resultado: '429', retryAfter: 300 };
    for (const m of lote.miembros) {
      const estado = await repo.registrar(m.entrega_id, r);
      if (estado === 'enviada') resumen.enviadas += 1;
      else if (estado === 'pendiente') resumen.reintentos += 1;
      else if (estado === 'muerta') resumen.muertas += 1;
    }
  }
  return resumen;
}
