// Guardia de cifras en dos direcciones.
//  1) ENTRADA: cada numero que el extractor devuelve (piezas, montos, precios) debe poder encontrarse en el mensaje fuente.
//     Si no esta, la accion no se ejecuta: se pregunta. Detecta la alucinacion de cifras.
//  2) SALIDA: todo numero que llega a una respuesta debe haber sido registrado por una cifra del servidor.
// Unidad comun: centesimas (piezas x 100, pesos x 100 = centavos), como bigint.
import { formatearMoneda, formatearPiezas } from '../formato';
import { ErrorCifraAjena, type CifraServidor } from './tipos';

const UNIDADES: Readonly<Record<string, number>> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const DECENAS: Readonly<Record<string, number>> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const CENTENAS: Readonly<Record<string, number>> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Escala "1234.5" a centesimas (123450n). Mas de dos decimales: se truncan (la otra interpretacion cubre el caso 1.500). */
function aCentesimas(entero: string, decimal: string): bigint {
  const e = entero === '' ? '0' : entero;
  return BigInt(e) * 100n + BigInt((decimal + '00').slice(0, 2));
}

function interpretaciones(crudo: string): bigint[] {
  const limpio = crudo.replace(/[.,]+$/, '');
  if (limpio === '') return [];
  const salida: bigint[] = [];
  // Convencion de Mexico: coma = miles, punto = decimales.
  const mx = limpio.replace(/,/g, '');
  const partes = mx.split('.');
  if (partes.length <= 2 && /^\d*$/.test(partes[0] ?? '') && /^\d*$/.test(partes[1] ?? '')) {
    salida.push(aCentesimas(partes[0] ?? '', partes[1] ?? ''));
  }
  // Otra lectura: separadores solo de miles ("1.500" = 1500) o coma decimal ("1,5").
  const soloDigitos = limpio.replace(/[.,]/g, '');
  if (/^\d+$/.test(soloDigitos)) salida.push(BigInt(soloDigitos) * 100n);
  const coma = /^(\d+),(\d{1,2})$/.exec(limpio);
  if (coma) salida.push(aCentesimas(coma[1]!, coma[2]!));
  return salida;
}

function numerosEnPalabras(texto: string): bigint[] {
  const tokens = sinAcentos(texto.toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean);
  const hallados: bigint[] = [];
  let total = 0;
  let actual = 0;
  let enSecuencia = false;
  const volcar = () => {
    if (enSecuencia) hallados.push(BigInt(total + actual) * 100n);
    total = 0;
    actual = 0;
    enSecuencia = false;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t in UNIDADES) {
      actual += UNIDADES[t]!;
      enSecuencia = true;
    } else if (t in DECENAS) {
      actual += DECENAS[t]!;
      enSecuencia = true;
    } else if (t in CENTENAS) {
      actual += CENTENAS[t]!;
      enSecuencia = true;
    } else if (t === 'mil' && enSecuencia) {
      total += (actual === 0 ? 1 : actual) * 1000;
      actual = 0;
    } else if (t === 'mil') {
      total = 1000;
      enSecuencia = true;
    } else if (t === 'y' && enSecuencia && tokens[i + 1] !== undefined && tokens[i + 1]! in UNIDADES) {
      continue;
    } else {
      volcar();
    }
  }
  volcar();
  return hallados;
}

/** Todos los valores numericos mencionados en un texto, en centesimas (cifras, "1.5k", "15 mil" y palabras en espanol). */
export function valoresDeTexto(texto: string): Set<bigint> {
  const valores = new Set<bigint>();
  const t = sinAcentos(texto.toLowerCase());
  for (const m of t.matchAll(/(\d[\d.,]*)(?:\s*(k|mil|millones|millon)\b)?/g)) {
    const mult = m[2] === undefined ? 1n : m[2] === 'k' || m[2] === 'mil' ? 1000n : 1_000_000n;
    for (const v of interpretaciones(m[1]!)) {
      valores.add(v);
      if (mult !== 1n) valores.add(v * mult);
    }
  }
  for (const v of numerosEnPalabras(t)) valores.add(v);
  return valores;
}

export interface CifraExtraida {
  campo: string;
  /** Centesimas: piezas x 100; monto_centavos tal cual. */
  valor: bigint;
}

/** Devuelve los campos cuya cifra NO aparece en el mensaje fuente. Lista vacia = todo con procedencia. */
export function cifrasSinProcedencia(fuente: string, extraidas: readonly CifraExtraida[]): string[] {
  const enFuente = valoresDeTexto(fuente);
  return extraidas.filter((c) => !enFuente.has(c.valor)).map((c) => c.campo);
}

export function cifrasDePiezas(campo: string, piezas: number): CifraExtraida {
  return { campo, valor: BigInt(piezas) * 100n };
}

export function cifrasDeMonto(campo: string, centavos: number): CifraExtraida {
  return { campo, valor: BigInt(centavos) };
}

/** Normaliza un grupo de digitos para comparar: sin separadores y sin ceros a la izquierda. */
function claveDigitos(token: string): string {
  const d = token.replace(/\D/g, '');
  return d.replace(/^0+(?=\d)/, '');
}

/**
 * Registro de las cifras que el servidor entrego. Cada metodo devuelve el texto ya formateado y registra sus digitos;
 * `auditar` revisa un texto final y reporta todo numero que no se registro.
 */
export class RegistroCifras {
  private readonly permitidas = new Set<string>();

  private registrar(texto: string): string {
    for (const m of texto.matchAll(/\d[\d.,]*/g)) this.permitidas.add(claveDigitos(m[0]));
    return texto;
  }

  pesos(centavos: bigint, opciones: { conSigno?: boolean } = {}): string {
    return this.registrar(formatearMoneda(centavos, opciones));
  }

  piezas(n: number): string {
    return this.registrar(formatearPiezas(n));
  }

  folio(f: string): string {
    return this.registrar(f);
  }

  /** Numero de configuracion (minutos de la ventana, maximo de preguntas...). */
  config(n: number): string {
    return this.registrar(String(n));
  }

  /** Texto que entrego el servidor (nombres de catalogo, advertencias): sus digitos son legitimos. */
  servidor(texto: string): string {
    return this.registrar(texto);
  }

  /** Cita literal de lo que escribio el socio (procedencia: su propio mensaje, no el modelo). */
  citaUsuario(texto: string): string {
    return this.registrar(texto);
  }

  cifra(c: CifraServidor): string {
    switch (c.tipo) {
      case 'pesos':
        return this.pesos(c.centavos);
      case 'piezas':
        return this.piezas(c.piezas);
      case 'folio':
        return this.folio(c.folio);
      case 'texto':
        return this.registrar(c.texto);
    }
  }

  auditar(texto: string): string[] {
    const ajenas: string[] = [];
    for (const m of texto.matchAll(/\d[\d.,]*/g)) {
      const limpio = m[0].replace(/[.,]+$/, '');
      if (!this.permitidas.has(claveDigitos(limpio))) ajenas.push(limpio);
    }
    return ajenas;
  }

  /** Lanza ErrorCifraAjena si el texto trae cualquier numero que el servidor no entrego. */
  exigir(texto: string): string {
    const ajenas = this.auditar(texto);
    if (ajenas.length > 0) throw new ErrorCifraAjena(ajenas);
    return texto;
  }
}

export type PrecioDictado = { ok: true; centavos: number } | { ok: false; motivo: 'ambiguo' | 'ilegible' };

/**
 * Un precio dictado ("250", "$1,250.50", "1250.5") a centavos exactos, con la convencion de Mexico: coma = miles, punto = decimales.
 * Los formatos que cambian de significado segun la convencion ("1.250", "1.250,50", "1,5") NO se adivinan: devuelven `ambiguo` y el agente pide aclarar.
 * (valoresDeTexto acepta ambas lecturas para comprobar procedencia; aqui hace falta UNA sola, porque el numero se escribe en la base.)
 */
export function parsearPrecio(texto: string): PrecioDictado {
  const t = sinAcentos(texto.toLowerCase()).replace(/\b(mxn|pesos|peso|mn)\b/g, ' ');
  const nums = [...t.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]+$/, ''));
  if (nums.length === 0) {
    // Solo palabras ("doscientos cincuenta"): vale si hay una unica lectura.
    const v = [...valoresDeTexto(t)];
    return v.length === 1 && v[0]! > 0n && v[0]! <= BigInt(Number.MAX_SAFE_INTEGER) ? { ok: true, centavos: Number(v[0]!) } : { ok: false, motivo: 'ilegible' };
  }
  if (nums.length > 1) return { ok: false, motivo: 'ambiguo' };
  const n = nums[0]!;
  const mult = /\d\s*(k|mil)\b/.test(t) ? 1000n : 1n;
  let centavos: bigint | null = null;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(n)) centavos = aCentesimas(n.replace(/,/g, '').split('.')[0]!, n.split('.')[1] ?? '');
  else if (/^\d+(\.\d{1,2})?$/.test(n)) centavos = aCentesimas(n.split('.')[0]!, n.split('.')[1] ?? '');
  else if (/^\d+$/.test(n)) centavos = aCentesimas(n, '');
  if (centavos === null) return { ok: false, motivo: 'ambiguo' }; // 1.250 | 1.250,50 | 1,5 | 12,50,3 ...
  const total = centavos * mult;
  return total > 0n && total <= BigInt(Number.MAX_SAFE_INTEGER) ? { ok: true, centavos: Number(total) } : { ok: false, motivo: 'ilegible' };
}
