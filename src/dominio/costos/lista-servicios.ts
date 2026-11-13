// Presentacion de la lista de servicios de Costos del sistema (sin cifras: el dinero lo calcula la base y llega ya redondeado).
import type { ResumenServicio } from './vista';

export type CategoriaServicio = 'mantenimiento' | 'opcional' | 'construccion';
export const ETIQUETA_CATEGORIA: Record<CategoriaServicio, string> = { mantenimiento: 'Mantenimiento', opcional: 'Opcional', construccion: 'Construcción' };
const ORDEN_CATEGORIA: Record<CategoriaServicio, number> = { mantenimiento: 0, opcional: 1, construccion: 2 };

/** Construccion gana a opcional (Claude Max es opcional Y de construccion y se lista como Construccion, igual que antes). */
export function categoriaDe(s: Pick<ResumenServicio, 'fase' | 'opcional'>): CategoriaServicio {
  return s.fase === 'construccion' ? 'construccion' : s.opcional ? 'opcional' : 'mantenimiento';
}

/** Orden estable y unico de la lista: primero por categoria (Mantenimiento, Opcional, Construccion) y dentro de cada una alfabetico por nombre (es). */
export function ordenarServicios<T extends Pick<ResumenServicio, 'fase' | 'opcional' | 'servicio'>>(servicios: readonly T[]): T[] {
  return [...servicios].sort((a, b) => ORDEN_CATEGORIA[categoriaDe(a)] - ORDEN_CATEGORIA[categoriaDe(b)] || a.servicio.localeCompare(b.servicio, 'es'));
}

/** Iniciales para el monograma de la casilla de logo (dos letras como maximo). */
export function inicialesServicio(nombre: string): string {
  const partes = nombre.trim().split(/[\s,]+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? partes[0]?.[1] ?? '')).toUpperCase();
}
