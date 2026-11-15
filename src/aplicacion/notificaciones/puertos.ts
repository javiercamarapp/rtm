import type { FiltroAvisos, ListaCampana, Pulso, TuTurno } from '@/dominio/notificaciones/tipos';

export interface LectorNotificaciones {
  mis(filtro: FiltroAvisos, pagina: number): Promise<ListaCampana>;
  contarNoLeidas(): Promise<number>;
  tuTurno(): Promise<TuTurno>;
  pulso(): Promise<Pulso>;
}

export interface EscritorNotificaciones {
  marcarLeida(avisoId: number): Promise<void>;
  marcarTodasLeidas(): Promise<void>;
  /** Barrido idempotente: cierra los avisos cuya causa ya no existe y retira los informativos viejos. Devuelve las cuentas. */
  depurar(): Promise<ResultadoDepuracion>;
}

export interface ResultadoDepuracion { aplicado: boolean; resueltos: number; retirados: number; reabiertos: number }
