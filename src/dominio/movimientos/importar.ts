// Lectura de movimientos historicos pegados o de un CSV. Puro: no lee el reloj ni calcula nada contable; solo convierte texto en filas con montos en centavos.
import { centavosDesdeTexto } from '../dinero';

export interface FilaImportada {
  linea: number;
  fecha: string;
  monto_cent: bigint;
  cuenta: string;
  origen: string;
  mensaje: string;
}
export interface ErrorImportacion {
  linea: number;
  motivo: string;
}
export interface LecturaImportacion {
  filas: FilaImportada[];
  errores: ErrorImportacion[];
  columnas: string[];
  delimitador: '\t' | ';' | ',';
  conEncabezado: boolean;
}

const MAX_FILAS = 5000;

function diasDelMes(a: number, m: number): number {
  if (m === 2) return (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA o DD/MM/AA (el dia va primero, como se escribe en Mexico). null si no es una fecha real. */
export function fechaDesdeTexto(texto: string): string | null {
  const t = texto.trim();
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) {
    a = Number(r[1]); m = Number(r[2]); d = Number(r[3]);
  } else {
    r = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(t);
    if (!r) return null;
    d = Number(r[1]); m = Number(r[2]); a = r[3]!.length === 2 ? 2000 + Number(r[3]) : Number(r[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > diasDelMes(a, m) || a < 2000 || a > 2100) return null;
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "1,234.50", "$1234.5", "(1,234.50)" o "-1234" a centavos. Sin decimales flotantes. */
export function montoDesdeTexto(texto: string): bigint | null {
  let t = texto.trim();
  if (t === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  try {
    const c = centavosDesdeTexto(t);
    return neg ? -c : c;
  } catch {
    return null;
  }
}

/** Parte una linea respetando comillas dobles (campos con el delimitador adentro y "" como comilla escapada). */
function partir(linea: string, sep: string): string[] {
  const salida: string[] = [];
  let actual = '';
  let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!;
    if (dentro) {
      if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; } else if (c === '"') dentro = false; else actual += c;
    } else if (c === '"') dentro = true;
    else if (c === sep) { salida.push(actual); actual = ''; } else actual += c;
  }
  salida.push(actual);
  return salida.map((x) => x.trim());
}

const SINONIMOS: Record<string, string[]> = {
  fecha: ['fecha', 'date', 'dia'],
  monto: ['monto', 'importe', 'cantidad', 'total'],
  entrada: ['entrada', 'abono', 'deposito', 'depósito', 'ingreso'],
  salida: ['salida', 'cargo', 'retiro', 'egreso'],
  cuenta: ['cuenta', 'banco', 'caja'],
  origen: ['origen', 'de', 'contraparte', 'nombre', 'cliente'],
  mensaje: ['mensaje', 'descripcion', 'descripción', 'concepto', 'nota', 'detalle', 'referencia'],
};

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function columnaDe(nombre: string): string | null {
  const n = normalizar(nombre);
  for (const [k, lista] of Object.entries(SINONIMOS)) if (lista.some((x) => normalizar(x) === n)) return k;
  return null;
}

/** Lee texto pegado o un CSV. Reconoce encabezados (fecha, monto o entrada/salida, cuenta, origen, mensaje); sin encabezado el orden es fecha, monto, cuenta, origen, mensaje. */
export function leerMovimientos(texto: string): LecturaImportacion {
  const limpio = texto.replace(/^\uFEFF/, '');
  const lineas = limpio.split(/\r\n|\n|\r/).map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.trim() !== '');
  const errores: ErrorImportacion[] = [];
  if (lineas.length === 0) return { filas: [], errores, columnas: [], delimitador: '\t', conEncabezado: false };
  const primera = lineas[0]!.l;
  const cuentas = { '\t': primera.split('\t').length, ';': primera.split(';').length, ',': primera.split(',').length };
  const delimitador: '\t' | ';' | ',' = cuentas['\t'] > 1 ? '\t' : cuentas[';'] > 1 ? ';' : ',';
  const primeraCeldas = partir(primera, delimitador);
  const mapa = primeraCeldas.map(columnaDe);
  const conEncabezado = mapa.includes('fecha') && (mapa.includes('monto') || mapa.includes('entrada') || mapa.includes('salida'));
  const columnas = conEncabezado ? (mapa.map((x) => x ?? '') as string[]) : ['fecha', 'monto', 'cuenta', 'origen', 'mensaje'];
  const cuerpo = conEncabezado ? lineas.slice(1) : lineas;
  if (cuerpo.length > MAX_FILAS) {
    errores.push({ linea: 0, motivo: `Máximo ${MAX_FILAS} filas por importación.` });
    return { filas: [], errores, columnas, delimitador, conEncabezado };
  }
  const filas: FilaImportada[] = [];
  for (const { l, n } of cuerpo) {
    const celdas = partir(l, delimitador);
    const dato = (k: string): string => {
      const i = columnas.indexOf(k);
      return i >= 0 ? (celdas[i] ?? '') : '';
    };
    const fecha = fechaDesdeTexto(dato('fecha'));
    if (!fecha) { errores.push({ linea: n, motivo: `Fecha no válida: "${dato('fecha')}".` }); continue; }
    let monto: bigint | null;
    if (columnas.includes('monto')) monto = montoDesdeTexto(dato('monto'));
    else {
      const e = dato('entrada') === '' ? 0n : montoDesdeTexto(dato('entrada'));
      const s = dato('salida') === '' ? 0n : montoDesdeTexto(dato('salida'));
      monto = e === null || s === null ? null : e - (s < 0n ? -s : s);
    }
    if (monto === null) { errores.push({ linea: n, motivo: 'Monto no válido.' }); continue; }
    if (monto === 0n) { errores.push({ linea: n, motivo: 'El monto no puede ser cero.' }); continue; }
    filas.push({ linea: n, fecha, monto_cent: monto, cuenta: dato('cuenta'), origen: dato('origen'), mensaje: dato('mensaje') });
  }
  return { filas, errores, columnas, delimitador, conEncabezado };
}
