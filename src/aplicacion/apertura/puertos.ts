import type { CatalogosApertura, EnsayoApertura, EstadoApertura, VistaPreviaApertura } from '@/dominio/apertura/tipos';

/** Lo que la web lee de la apertura. Todo sale de funciones de la base; la interfaz no calcula dinero. Escribir se hace por la lista cerrada de acciones (apertura_*). */
export interface LectorApertura {
  estado(sesion: number | null): Promise<EstadoApertura>;
  catalogos(): Promise<CatalogosApertura>;
  vistaPrevia(sesion: number): Promise<VistaPreviaApertura>;
  ensayo(sesion: number): Promise<EnsayoApertura>;
}
