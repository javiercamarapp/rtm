// Calendarios de negocio. Zona America/Merida = UTC-6 fijo. Nunca se calcula "hoy" con la fecha UTC.
// El reloj entra como parametro: este modulo no lee la hora del sistema.

/** Fecha de negocio en formato AAAA-MM-DD. */
export type FechaNeg = string;

const MS_DIA = 86_400_000;
const DESFASE_MERIDA_MS = 6 * 3_600_000;

function aTexto(ms: number): FechaNeg {
  const d = new Date(ms);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function desdeTexto(f: FechaNeg): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
  if (!m) throw new RangeError(`fecha invalida: ${f}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Fecha de negocio (Merida) de un instante. 02:00 UTC del sabado 14 es viernes 13. */
export function fechaNeg(instante: Date): FechaNeg {
  return aTexto(instante.getTime() - DESFASE_MERIDA_MS);
}

/** Dia de la semana: 0 = lunes ... 6 = domingo. */
export function diaSemanaLunes0(f: FechaNeg): number {
  const dow = new Date(desdeTexto(f)).getUTCDay(); // 0 = domingo
  return (dow + 6) % 7;
}

export function sumarDias(f: FechaNeg, dias: number): FechaNeg {
  return aTexto(desdeTexto(f) + dias * MS_DIA);
}

export interface Semana { inicio: FechaNeg; fin: FechaNeg }

/** semana_reporte: lunes a domingo. */
export function semanaReporte(f: FechaNeg): Semana {
  const inicio = sumarDias(f, -diaSemanaLunes0(f));
  return { inicio, fin: sumarDias(inicio, 6) };
}

/** semana_liquidacion_proveedor: lunes a viernes; cierre el viernes. */
export function semanaLiquidacionProveedor(f: FechaNeg): Semana & { cierre: FechaNeg } {
  const inicio = sumarDias(f, -diaSemanaLunes0(f));
  const fin = sumarDias(inicio, 4);
  return { inicio, fin, cierre: fin };
}

/** semana_omar: lunes a domingo; corte parametrizable (por defecto lunes: la semana 9 a 15 se liquida el lunes 16). */
export function semanaOmar(f: FechaNeg, diaCorteLunes0 = 0): Semana & { corte: FechaNeg } {
  const base = semanaReporte(f);
  return { ...base, corte: sumarDias(base.fin, 1 + diaCorteLunes0) };
}
