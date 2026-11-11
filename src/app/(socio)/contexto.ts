import { diaSemanaLunes0, fechaNeg, semanaReporte } from '@/dominio/calendario';
import { etiquetaDia, etiquetaRango } from '@/dominio/formato';

/** "martes 10 nov · semana 9 a 15 nov": siempre con la fecha de negocio de Merida, nunca la fecha UTC del servidor. */
export function etiquetaHoy(): string {
  const hoy = fechaNeg(new Date());
  const s = semanaReporte(hoy);
  return `${etiquetaDia(hoy, diaSemanaLunes0(hoy))} · semana ${etiquetaRango(s.inicio, s.fin)}`;
}
