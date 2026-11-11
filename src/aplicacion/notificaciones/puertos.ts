import type { ListaCampana, Pulso, TuTurno } from '@/dominio/notificaciones/tipos';

export interface LectorNotificaciones {
  mis(filtro: 'todas' | 'sin_leer', pagina: number): Promise<ListaCampana>;
  contarNoLeidas(): Promise<number>;
  tuTurno(): Promise<TuTurno>;
  pulso(): Promise<Pulso>;
}

export interface EscritorNotificaciones {
  marcarLeida(avisoId: number): Promise<void>;
  marcarTodasLeidas(): Promise<void>;
}
