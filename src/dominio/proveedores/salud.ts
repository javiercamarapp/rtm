// Salud de la fuente: latido de la ultima lectura, fallos seguidos e incidentes (P-17: una sola vez por incidente y un recordatorio a las 6 horas).
// Catalogo vacio, formato nuevo y bloqueo avisan de inmediato; un simple fallo de red avisa a la tercera lectura fallida seguida.
// Una lectura rechazada NO genera eventos ni marca nada como descontinuado: se conserva el ultimo estado bueno.

import { avisoFuente } from './avisos';
import { FALLOS_PARA_INCIDENTE, HORAS_RECORDATORIO_INCIDENTE, LECTURAS_RECORDADAS } from './politica';
import { horasEntre, MS_HORA, sumarMs } from './tipos';
import type { EstadoProveedor, Instante, SolicitudAviso, TipoIncidente } from './tipos';

export interface ResultadoSalud {
  estado: EstadoProveedor;
  avisos: SolicitudAviso[];
}

/** Lectura valida procesada: actualiza el latido, cierra el incidente y recuerda la clave para la idempotencia. */
export function registrarExito(previo: EstadoProveedor, en: Instante, claveLectura: string): EstadoProveedor {
  const estado = structuredClone(previo);
  estado.salud = { ultimaLecturaOk: en, ultimoIntento: en, fallosSeguidos: 0, bloqueada: false, incidente: null };
  estado.lecturasProcesadas = [...estado.lecturasProcesadas.filter((c) => c !== claveLectura), claveLectura].slice(-LECTURAS_RECORDADAS);
  return estado;
}

/** La lectura fue sospechosa (retenida): la fuente responde, asi que no es un fallo de la fuente, pero tampoco refresca el dato publicado. */
export function registrarIntento(previo: EstadoProveedor, en: Instante): EstadoProveedor {
  const estado = structuredClone(previo);
  estado.salud.ultimoIntento = en;
  return estado;
}

export function registrarFallo(previo: EstadoProveedor, en: Instante, causa: TipoIncidente): ResultadoSalud {
  const estado = structuredClone(previo);
  const avisos: SolicitudAviso[] = [];
  estado.salud.ultimoIntento = en;
  estado.salud.fallosSeguidos += 1;
  if (causa === 'bloqueada') estado.salud.bloqueada = true;
  const horas = estado.salud.ultimaLecturaOk ? horasEntre(estado.salud.ultimaLecturaOk, en) : null;
  const inmediato = causa !== 'sin_lectura';
  if (!estado.salud.incidente && (inmediato || estado.salud.fallosSeguidos >= FALLOS_PARA_INCIDENTE)) {
    estado.salud.incidente = { tipo: causa, desde: en, avisadoEn: en, recordatorioEn: null };
    avisos.push(avisoFuente(estado.salud.incidente, horas, estado.salud.ultimaLecturaOk, false, en));
  }
  return { estado, avisos: [...avisos, ...recordatorioPendiente(estado, en)] };
}

/** Recordatorio unico a las 6 horas de un incidente abierto. Se llama tambien en cada ciclo aunque no haya lectura nueva. */
export function recordatorioPendiente(estado: EstadoProveedor, en: Instante): SolicitudAviso[] {
  const inc = estado.salud.incidente;
  if (!inc || inc.recordatorioEn !== null) return [];
  if (Date.parse(en) < Date.parse(sumarMs(inc.avisadoEn, HORAS_RECORDATORIO_INCIDENTE * MS_HORA))) return [];
  inc.recordatorioEn = en;
  const horas = estado.salud.ultimaLecturaOk ? horasEntre(estado.salud.ultimaLecturaOk, en) : null;
  return [avisoFuente(inc, horas, estado.salud.ultimaLecturaOk, true, en)];
}

/** Un socio reanuda la fuente tras un bloqueo (por ejemplo, ya hablo con Karen). Nunca se reanuda sola. */
export function reanudarFuente(previo: EstadoProveedor): EstadoProveedor {
  const estado = structuredClone(previo);
  estado.salud.bloqueada = false;
  estado.salud.fallosSeguidos = 0;
  estado.salud.incidente = null;
  return estado;
}
