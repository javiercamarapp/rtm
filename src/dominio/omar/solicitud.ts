// Reglas puras de la solicitud de piezas de Omar. La autoridad final es la funcion SQL (existencia neta de reservas, tope, idempotencia);
// esto es la primera barrera y el mensaje claro para Omar. Nada aqui lee reloj: el instante entra como parametro.
import type { ConfiguracionOmar, EstadoSolicitud, LineaSolicitud, MotivoRechazo, PiezaDisponible, Solicitud } from './tipos';

export const TOPE_POR_OMISION = 15;
export const CADUCIDAD_HORAS_POR_OMISION = 72;

export const CONFIG_POR_OMISION: ConfiguracionOmar = { tope_toma_piezas: TOPE_POR_OMISION, caduca_horas: CADUCIDAD_HORAS_POR_OMISION, renta_por_pieza_cent: null };

export type ValidacionSolicitud = { ok: true; linea: LineaSolicitud } | { ok: false; motivo: MotivoRechazo; mensaje: string };

const norm = (s: string) => s.trim().toLowerCase();

export function existenciaDe(disponible: readonly PiezaDisponible[], modelo: string, sabor: string): number | null {
  const f = disponible.find((p) => norm(p.modelo) === norm(modelo) && norm(p.sabor) === norm(sabor));
  return f ? f.piezas : null;
}

/** Valida UNA solicitud (modelo, sabor, cantidad) contra lo fisico visible y el tope. Los mensajes no revelan reservas ni pedidos. */
export function validarSolicitud(entrada: { modelo: string; sabor: string; piezas: unknown }, disponible: readonly PiezaDisponible[], cfg: ConfiguracionOmar): ValidacionSolicitud {
  const n = entrada.piezas;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return { ok: false, motivo: 'cantidad', mensaje: 'Escribe cuántas piezas necesitas: un número entero de 1 en adelante.' };
  if (n > cfg.tope_toma_piezas) return { ok: false, motivo: 'tope', mensaje: `Cada solicitud admite hasta ${cfg.tope_toma_piezas} piezas. Si necesitas más, haz otra solicitud.` };
  const hay = existenciaDe(disponible, entrada.modelo, entrada.sabor);
  if (hay === null) return { ok: false, motivo: 'pieza_desconocida', mensaje: 'Ese modelo y sabor no están en tu bodega.' };
  if (n > hay) return { ok: false, motivo: 'sin_existencia', mensaje: `En tu bodega hay ${hay} pz de esa pieza; no puedes pedir más.` };
  return { ok: true, linea: { modelo: entrada.modelo.trim(), sabor: entrada.sabor.trim(), piezas: n } };
}

/** Caducidad de una solicitud pendiente: solicitada + horas. */
export function caducaEn(solicitadaIso: string, horas: number): string {
  return new Date(Date.parse(solicitadaIso) + horas * 3_600_000).toISOString();
}

/** El estado que se le muestra: una pendiente cuya hora de caducidad ya paso se ve como caducada aunque el cron aun no la haya movido. */
export function estadoVisible(s: Pick<Solicitud, 'estado' | 'caduca_at'>, ahora: Date): EstadoSolicitud {
  if (s.estado === 'pendiente' && Date.parse(s.caduca_at) <= ahora.getTime()) return 'caducada';
  return s.estado;
}

export const ETIQUETA_ESTADO: Record<EstadoSolicitud, string> = {
  pendiente: 'Pendiente',
  autorizada: 'Autorizada',
  rechazada: 'Rechazada',
  caducada: 'Caducada',
  deshecha: 'Deshecha',
};

export const TONO_ESTADO: Record<EstadoSolicitud, 'ok' | 'atencion' | 'malo' | 'neutro'> = {
  pendiente: 'atencion',
  autorizada: 'ok',
  rechazada: 'malo',
  caducada: 'neutro',
  deshecha: 'neutro',
};

/** Texto de tiempo restante de una pendiente ("caduca en 40 min", "caduca en 71 h"); vacio si ya no corre. */
export function tiempoRestante(caducaIso: string, ahora: Date): string {
  const ms = Date.parse(caducaIso) - ahora.getTime();
  if (ms <= 0) return '';
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `caduca en ${min} min`;
  return `caduca en ${Math.floor(min / 60)} h`;
}

/** Un doble clic o un reintento del mismo formulario comparte clave: viaja con prefijo `web:` y solo admite el alfabeto seguro. */
export function claveValida(clave: unknown): clave is string {
  return typeof clave === 'string' && /^web:[0-9a-f-]{8,64}$/.test(clave);
}

/** Modelos distintos de la bodega, en orden. */
export function modelosDe(disponible: readonly PiezaDisponible[]): string[] {
  return [...new Set(disponible.map((p) => p.modelo))];
}

/** Sabores de un modelo con su existencia fisica. */
export function saboresDe(disponible: readonly PiezaDisponible[], modelo: string): PiezaDisponible[] {
  return disponible.filter((p) => p.modelo === modelo);
}

/** Maximo que se puede pedir de una pieza: el menor entre el tope por toma y lo que hay. */
export function maximoPara(disponible: readonly PiezaDisponible[], modelo: string, sabor: string, tope: number): number {
  return Math.max(0, Math.min(tope, existenciaDe(disponible, modelo, sabor) ?? 0));
}
