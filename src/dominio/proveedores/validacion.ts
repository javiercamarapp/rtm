// Cordura de una lectura ya parseada contra el estado vigente: caida anomala del catalogo o cambio masivo de disponibilidad.
// Una lectura sospechosa se retiene: no genera eventos ni avisos de cambio hasta que una segunda lectura la desmienta o un socio la confirme.

import type { EstadoProveedor, LecturaCatalogo } from './tipos';

/** Caida maxima tolerada del total de variantes en una sola lectura. */
export const UMBRAL_CAIDA_VARIANTES = 0.3;
/** Fraccion maxima de variantes que puede cambiar de disponibilidad en una sola lectura. */
export const UMBRAL_CAMBIO_DISPONIBILIDAD = 0.5;

export type VeredictoLectura =
  | { estado: 'ok' }
  | { estado: 'sospechosa'; razon: 'caida_variantes' | 'cambio_masivo'; detalle: string };

export function evaluarAnomalia(estado: EstadoProveedor, lectura: LecturaCatalogo): VeredictoLectura {
  const previas = Object.values(estado.variantes).filter((v) => v.estado !== 'descontinuada');
  if (previas.length === 0) return { estado: 'ok' };
  const actuales = new Map<string, boolean>();
  for (const p of lectura.productos) for (const v of p.variantes) actuales.set(v.id, v.disponible);

  const caida = (previas.length - actuales.size) / previas.length;
  if (caida > UMBRAL_CAIDA_VARIANTES) {
    return { estado: 'sospechosa', razon: 'caida_variantes', detalle: `el total de variantes cayo ${Math.round(caida * 100)} %` };
  }
  let comunes = 0;
  let cambiadas = 0;
  for (const v of previas) {
    const ahora = actuales.get(v.id);
    if (ahora === undefined) continue;
    comunes++;
    if (ahora !== v.disponible) cambiadas++;
  }
  if (comunes > 0 && cambiadas / comunes > UMBRAL_CAMBIO_DISPONIBILIDAD) {
    return { estado: 'sospechosa', razon: 'cambio_masivo', detalle: `${Math.round((cambiadas / comunes) * 100)} % de los sabores cambio de estado` };
  }
  return { estado: 'ok' };
}
