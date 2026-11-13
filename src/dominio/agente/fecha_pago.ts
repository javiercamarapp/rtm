// Interpretacion DETERMINISTA de fechas y horas dichas en lenguaje natural ("el viernes", "manana a las 5", "15 de noviembre", "15/11 5 pm").
// La IA nunca fija una fecha: el modelo, a lo mas, copia la frase tal como la dijo el socio y este codigo la interpreta con el reloj de Merida (UTC-6 fijo).
// Ante cualquier duda (hora sin am/pm, "el viernes" siendo viernes, fecha ilegible) devuelve `ambiguo` o `no_entendi` y el agente pregunta con botones. Nunca adivina.
import { diaSemanaLunes0, fechaNeg, sumarDias, type FechaNeg } from '../calendario';

export interface OpcionFecha {
  fecha: FechaNeg;
  /** HH:MM (24 h) o null si el socio no dijo hora. */
  hora: string | null;
}

export type FechaInterpretada =
  | ({ tipo: 'ok' } & OpcionFecha)
  | { tipo: 'ambiguo'; motivo: 'am_pm' | 'dia'; opciones: OpcionFecha[] }
  | { tipo: 'pasada'; fecha: FechaNeg }
  | { tipo: 'futura'; fecha: FechaNeg }
  | { tipo: 'no_entendi' };

export interface OpcionesFecha {
  /** futuro = fecha de un compromiso (no puede ser pasada); pasado = fecha de un pago ya hecho (no puede ser futura). */
  direccion?: 'futuro' | 'pasado';
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
const DIAS_BONITOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
const MESES_CORTOS: Readonly<Record<string, number>> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };

const p2 = (n: number): string => String(n).padStart(2, '0');

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** AAAA-MM-DD valida (dia real del mes), o null. */
function fechaValida(a: number, m: number, d: number): FechaNeg | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${p2(m)}-${p2(d)}` : null;
}

/** Un anio escrito debe ser el actual o el siguiente: lo demas (2099, 2031...) es un error de dedo y no se acepta. */
function anioRazonable(a: number, hoy: FechaNeg): boolean {
  const actual = Number(hoy.slice(0, 4));
  return a >= actual - 1 && a <= actual + 1;
}

const partes = (f: FechaNeg): { a: number; m: number; d: number } => ({ a: Number(f.slice(0, 4)), m: Number(f.slice(5, 7)), d: Number(f.slice(8, 10)) });

/** Instante (UTC) del final del dia o de la hora indicada, en hora de Merida. */
function instante(f: FechaNeg, hora: string | null): number {
  const { a, m, d } = partes(f);
  const [hh, mm] = hora === null ? [23, 59] : (hora.split(':').map(Number) as [number, number]);
  return Date.UTC(a, m - 1, d, hh + 6, mm, hora === null ? 59 : 0);
}

/** Fecha por numero de dia del mes ("el 15"): la mas cercana en la direccion pedida. */
function porDiaDelMes(dia: number, hoy: FechaNeg, dir: 'futuro' | 'pasado'): FechaNeg | null {
  const { a, m } = partes(hoy);
  const esteMes = fechaValida(a, m, dia);
  const otroMes = (delta: number): FechaNeg | null => {
    const mm = m + delta;
    const aa = a + Math.floor((mm - 1) / 12);
    return fechaValida(aa, ((mm - 1 + 12) % 12) + 1, dia);
  };
  if (dir === 'futuro') return esteMes !== null && esteMes >= hoy ? esteMes : (otroMes(1) ?? otroMes(2));
  return esteMes !== null && esteMes <= hoy ? esteMes : (otroMes(-1) ?? otroMes(-2));
}

function porDiaYMes(dia: number, mes: number, anio: number | null, hoy: FechaNeg): FechaNeg | null {
  const { a } = partes(hoy);
  if (anio !== null) return anioRazonable(anio, hoy) ? fechaValida(anio, mes, dia) : null;
  // Sin anio: SIEMPRE el actual. Una fecha que ya paso (o, en un pago, que aun no llega) no se corre en silencio a otro anio: el llamador la rechaza como pasada o futura.
  return fechaValida(a, mes, dia);
}

interface DiaDetectado {
  fecha: FechaNeg | null;
  /** Opciones cuando el dia mismo es ambiguo ("el viernes" siendo viernes). */
  ambiguo?: FechaNeg[];
  /** Texto restante sin la parte del dia (para buscar la hora). */
  resto: string;
  /** El texto trae un dia numerico que no concuerda con el dia de la semana nombrado. */
  conflicto?: boolean;
}

function detectarDia(t: string, hoy: FechaNeg, dir: 'futuro' | 'pasado'): DiaDetectado {
  let resto = t;
  const quitar = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(resto);
    if (m) resto = `${resto.slice(0, m.index)} ${resto.slice(m.index + m[0].length)}`;
    return m;
  };

  // Formatos numericos de fecha primero (para que sus numeros no se lean como hora).
  let m = quitar(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { fecha: anioRazonable(Number(m[1]), hoy) ? fechaValida(Number(m[1]), Number(m[2]), Number(m[3])) : null, resto };
  // dd/mm o dd/mm/aaaa. Un anio de 1 o 2 digitos ("15/11/2", "15/11/26") es ambiguo y no se acepta: se pide con cuatro digitos.
  m = quitar(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?(?![/.-]?\d)/);
  if (m) return { fecha: porDiaYMes(Number(m[1]), Number(m[2]), m[3] === undefined ? null : Number(m[3]), hoy), resto };
  // "15 de noviembre [de 2026]" | "15 nov"
  const meses = [...MESES, ...Object.keys(MESES_CORTOS)].join('|');
  m = quitar(new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${meses})\\b\\.?(?:\\s+(?:de\\s+)?(\\d{4}))?`));
  if (m) {
    const nombre = m[2]!;
    const idx = MESES.indexOf(nombre as (typeof MESES)[number]);
    const mes = idx >= 0 ? idx + 1 : MESES_CORTOS[nombre]!;
    return { fecha: porDiaYMes(Number(m[1]), mes, m[3] === undefined ? null : Number(m[3]), hoy), resto };
  }
  // "el 15" | "el dia 15"
  m = quitar(/\bel\s+(?:dia\s+)?(\d{1,2})\b(?!\s*(?::|h\b|hrs\b|horas\b|am\b|pm\b))/);
  if (m) return { fecha: porDiaDelMes(Number(m[1]), hoy, dir), resto };

  if (quitar(/\bpasado\s+manana\b/)) return { fecha: sumarDias(hoy, 2), resto };
  if (quitar(/\b(?:anteayer|antier)\b/)) return { fecha: sumarDias(hoy, -2), resto };
  if (quitar(/\bayer\b/)) return { fecha: sumarDias(hoy, -1), resto };
  if (quitar(/\bhoy\b/)) return { fecha: hoy, resto };
  if (quitar(/\bmanana\b/)) return { fecha: sumarDias(hoy, 1), resto };
  m = quitar(/\ben\s+(\d{1,2})\s+dias?\b/);
  if (m) return { fecha: sumarDias(hoy, Number(m[1])), resto };
  if (quitar(/\ben\s+(?:una|1)\s+semana\b|\bla\s+(?:proxima\s+)?semana\s+(?:que\s+viene|proxima)\b/)) return { fecha: sumarDias(hoy, 7), resto };

  // Dia de la semana. "proximo/que viene" = la semana siguiente; sin ellos, el siguiente (futuro) o el mas reciente (pasado).
  const dias = DIAS.join('|');
  m = quitar(new RegExp(`\\b(?:(?:el|este|ese|del|proximo|el\\s+proximo)\\s+)*(${dias})(\\s+(?:que\\s+viene|proximo))?\\b`));
  if (m) {
    const dow = DIAS.indexOf(m[1] as (typeof DIAS)[number]);
    const hoyDow = diaSemanaLunes0(hoy);
    // "viernes 20": el numero suelto es el dia del mes y debe caer en ese dia de la semana; si no coincide, no se adivina (se pide aclaracion).
    const sinHora = resto.replace(/\ba\s+las?\s+\d{1,2}(?::\d{2})?/g, ' ').replace(/\d{1,2}:\d{2}/g, ' ').replace(/\d{1,2}\s*(?:am|pm|h|hrs|horas)\b/g, ' ');
    const suelto = /(?<![\d:])(\d{1,2})(?![\d:])/.exec(sinHora);
    if (suelto) {
      const f = porDiaDelMes(Number(suelto[1]), hoy, dir);
      return f !== null && diaSemanaLunes0(f) === dow ? { fecha: f, resto } : { fecha: null, resto, conflicto: true };
    }
    const forzadoSiguiente = /proximo/.test(m[0]) || m[2] !== undefined;
    if (dir === 'pasado') {
      const atras = (hoyDow - dow + 7) % 7;
      return { fecha: sumarDias(hoy, -atras), resto };
    }
    const adelante = (dow - hoyDow + 7) % 7;
    if (adelante === 0) {
      // El dia de la semana nombrado es hoy: ¿hoy o dentro de ocho dias? No se adivina.
      return forzadoSiguiente ? { fecha: sumarDias(hoy, 7), resto } : { fecha: null, ambiguo: [hoy, sumarDias(hoy, 7)], resto };
    }
    return { fecha: sumarDias(hoy, adelante), resto };
  }
  return { fecha: null, resto };
}

type HoraDetectada = { tipo: 'ninguna' } | { tipo: 'ok'; hora: string } | { tipo: 'am_pm'; h: number; mm: number } | { tipo: 'invalida' };

function detectarHora(t: string): HoraDetectada {
  if (/\bmediodia\b/.test(t)) return { tipo: 'ok', hora: '12:00' };
  const tarde = /(?<![a-z])(?:pm|p\.m\.?|de la tarde|de la noche|por la tarde|por la noche|en la tarde|en la noche)(?![a-z])/.test(t);
  const manana = /(?<![a-z])(?:am|a\.m\.?|de la manana|por la manana|en la manana|de la madrugada)(?![a-z])/.test(t);
  // "17:30", "5:30 pm", "a las 5", "a la 1", "5pm", "17 hrs"
  const m = /(?:\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?|\b(\d{1,2}):(\d{2})|\b(\d{1,2})\s*(?:am|pm|a\.m\.?|p\.m\.?)\b|\b(\d{1,2})\s*(?:h|hrs|horas)\b)/.exec(t);
  if (!m) return { tipo: 'ninguna' };
  const h = Number(m[1] ?? m[3] ?? m[5] ?? m[6]);
  const mm = Number(m[2] ?? m[4] ?? 0);
  if (!Number.isInteger(h) || h < 0 || h > 23 || mm < 0 || mm > 59) return { tipo: 'invalida' };
  const veinticuatro = h === 0 || h >= 13;
  if (veinticuatro) return tarde && h < 13 ? { tipo: 'invalida' } : { tipo: 'ok', hora: `${p2(h)}:${p2(mm)}` };
  if (tarde) return { tipo: 'ok', hora: `${p2(h === 12 ? 12 : h + 12)}:${p2(mm)}` };
  if (manana) return { tipo: 'ok', hora: `${p2(h === 12 ? 0 : h)}:${p2(mm)}` };
  // Hora escrita en 24 h con dos puntos ("09:30", "12:15") sin am/pm: se toma tal cual; "a las 5" / "5:30" sin marca es ambigua.
  if (h === 12) return { tipo: 'ok', hora: `12:${p2(mm)}` };
  if (m[3] !== undefined && m[3].length === 2 && h >= 10) return { tipo: 'ok', hora: `${p2(h)}:${p2(mm)}` };
  return { tipo: 'am_pm', h, mm };
}

/**
 * Interpreta la frase. `ahora` es el instante actual (el reloj entra como parametro). Devuelve siempre un resultado; jamas lanza.
 */
export function interpretarFechaPago(texto: string, ahora: Date, opciones: OpcionesFecha = {}): FechaInterpretada {
  const dir = opciones.direccion ?? 'futuro';
  const hoy = fechaNeg(ahora);
  let t = sinAcentos(texto.toLowerCase()).replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '' || t.length > 80) return { tipo: 'no_entendi' };
  // "en la manana" es la parte del dia, no el dia siguiente.
  t = t.replace(/\b(?:de|por|en)\s+la\s+manana\b/g, ' am ');
  const dia = detectarDia(t, hoy, dir);
  const hora = detectarHora(dia.resto);
  if (hora.tipo === 'invalida') return { tipo: 'no_entendi' };

  const conHora = (f: FechaNeg): OpcionFecha[] => (hora.tipo === 'ok' ? [{ fecha: f, hora: hora.hora }] : hora.tipo === 'am_pm' ? [{ fecha: f, hora: `${p2(hora.h)}:${p2(hora.mm)}` }, { fecha: f, hora: `${p2(hora.h + 12)}:${p2(hora.mm)}` }] : [{ fecha: f, hora: null }]);
  const enRango = (o: OpcionFecha): 'ok' | 'pasada' | 'futura' => {
    if (dir === 'futuro') return instante(o.fecha, o.hora) < ahora.getTime() ? 'pasada' : 'ok';
    return o.fecha > hoy ? 'futura' : 'ok';
  };

  if (dia.ambiguo !== undefined) {
    const opts = dia.ambiguo.flatMap(conHora).filter((o) => enRango(o) === 'ok');
    return opts.length === 0 ? { tipo: 'pasada', fecha: dia.ambiguo[0]! } : { tipo: 'ambiguo', motivo: 'dia', opciones: opts };
  }
  if (dia.fecha === null) return { tipo: 'no_entendi' };
  const candidatas = conHora(dia.fecha);
  const validas = candidatas.filter((o) => enRango(o) === 'ok');
  if (validas.length === 0) return { tipo: dir === 'futuro' ? 'pasada' : 'futura', fecha: dia.fecha };
  if (hora.tipo === 'am_pm' && validas.length > 1) return { tipo: 'ambiguo', motivo: 'am_pm', opciones: validas };
  // Una sola opcion posible tras descartar las pasadas (por ejemplo "hoy a las 5" cuando ya son las 6 pm: solo la de la manana no aplica y queda la de la tarde): se pide confirmar igual.
  if (hora.tipo === 'am_pm') return { tipo: 'ambiguo', motivo: 'am_pm', opciones: validas };
  return { tipo: 'ok', ...validas[0]! };
}

/** "viernes 20 de noviembre de 2026, 17:00 (hora de Mérida)" o "... (sin hora)". */
export function formatearFechaPago(fecha: FechaNeg, hora: string | null): string {
  const { a, m, d } = partes(fecha);
  const base = `${DIAS_BONITOS[diaSemanaLunes0(fecha)]} ${d} de ${MESES[m - 1]} de ${a}`;
  return hora === null ? `${base} (sin hora)` : `${base}, ${hora} (hora de Mérida)`;
}

/** Palabras con las que el socio dice que todavia no hay fecha. */
export function dijoSinFecha(texto: string): boolean {
  return /^(?:sin fecha|no se|todavia no se|aun no se|no tengo fecha|despues|luego|sin definir)\b/.test(sinAcentos(texto.toLowerCase()).trim());
}
