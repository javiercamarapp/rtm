// Rangos de fechas de negocio para los estados (semana de lunes a domingo, mes calendario). Aritmetica de fechas sin reloj: el "hoy" lo pone quien llama.
import { semanaReporte, sumarDias, type FechaNeg } from '../calendario';

export interface Rango { ini: FechaNeg; fin: FechaNeg; etiqueta: string }

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esFecha(t: string | undefined): t is string {
  return t !== undefined && FECHA.test(t);
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Mes calendario que contiene a la fecha. */
export function mesDe(f: FechaNeg): { ini: FechaNeg; fin: FechaNeg } {
  const anio = Number(f.slice(0, 4));
  const mes = Number(f.slice(5, 7));
  const dd = String(ultimoDiaDelMes(anio, mes)).padStart(2, '0');
  return { ini: `${f.slice(0, 7)}-01`, fin: `${f.slice(0, 7)}-${dd}` };
}

export function mesAnterior(f: FechaNeg): { ini: FechaNeg; fin: FechaNeg } {
  return mesDe(sumarDias(mesDe(f).ini, -1));
}

/** Atajos que ofrece la interfaz para elegir el periodo de un estado. */
export function atajos(hoy: FechaNeg): Rango[] {
  const sem = semanaReporte(hoy);
  const semPas = semanaReporte(sumarDias(sem.inicio, -1));
  const mes = mesDe(hoy);
  const mesPas = mesAnterior(hoy);
  return [
    { ini: sem.inicio, fin: sem.fin, etiqueta: 'Esta semana' },
    { ini: semPas.inicio, fin: semPas.fin, etiqueta: 'Semana pasada' },
    { ini: mes.ini, fin: mes.fin, etiqueta: 'Este mes' },
    { ini: mesPas.ini, fin: mesPas.fin, etiqueta: 'Mes pasado' },
  ];
}

/** Rango pedido por la URL (ini y fin validos) o, si no, el mes en curso. */
export function rangoDeConsulta(hoy: FechaNeg, ini: string | undefined, fin: string | undefined): { ini: FechaNeg; fin: FechaNeg } {
  if (esFecha(ini) && esFecha(fin) && fin >= ini) return { ini, fin };
  return mesDe(hoy);
}
