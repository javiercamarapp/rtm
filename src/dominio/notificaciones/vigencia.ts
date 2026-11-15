import type { FiltroAvisos } from './tipos';

/** Pestana de la bandeja a partir del parametro de la URL. Por omision solo lo vigente ("todas" ya no acumula lo resuelto). */
export function filtroDeAvisos(valor: string | undefined): FiltroAvisos {
  return valor === 'sin_leer' || valor === 'resueltos' ? valor : 'todas';
}

/** Texto corto de por que un aviso dejo de estar vigente (el motivo viene de la base; si falta se dice con palabras llanas). */
export function motivoResuelto(estado: string, motivo: string | null | undefined): string {
  if (motivo) return motivo.charAt(0).toUpperCase() + motivo.slice(1);
  if (estado === 'caducada') return 'Caduco por antiguedad';
  if (estado === 'descartada') return 'Descartado por una persona';
  return 'Resuelto';
}
