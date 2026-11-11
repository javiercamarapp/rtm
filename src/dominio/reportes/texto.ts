// Texto con marcadores {{cifra:id}} o {{cifra:id|formato}} (modo base, sin IA). El renderizador sustituye cada marcador por el valor formateado
// del paquete; el modelo (si algun dia redacta) solo escribe marcadores, nunca digitos.
import { formatearCifra, formatearValor } from './formato';
import type { Cifra, FormatoCifra } from './tipos';
import { ErrorReporte } from './tipos';

export interface FuenteCifras {
  obtener(id: string): Cifra;
}

const MARCADOR = /\{\{cifra:([\w.]+)(?:\|(\w+))?\}\}/g;
const FORMATOS: readonly FormatoCifra[] = ['entero', 'centavos', 'pct0', 'pct1', 'razon', 'dias', 'pz', 'n'];

export function marcadoresDe(plantilla: string): string[] {
  return [...plantilla.matchAll(MARCADOR)].map((m) => m[1]!);
}

export function textoSinDatos(c: Cifra): string {
  const requeridos = /requeridos:(\d+)/.exec(c.metodo ?? '')?.[1] ?? '?';
  return `no hay datos suficientes (${c.nMuestra} de ${requeridos} requeridos)`;
}

/** Sustituye los marcadores. Un marcador a una cifra inexistente lanza CIFRA_INEXISTENTE; a una cifra sin datos, la frase fija de datos insuficientes. */
export function renderMarcadores(plantilla: string, fuente: FuenteCifras): string {
  return plantilla.replace(MARCADOR, (_, id: string, mod: string | undefined) => {
    const c = fuente.obtener(id);
    if (c.estado !== 'ok') return textoSinDatos(c);
    if (mod === 'abs') return formatearValor(c.valor < 0n ? -c.valor : c.valor, c.unidad, c.formato);
    if (mod !== undefined) {
      if (!(FORMATOS as readonly string[]).includes(mod)) throw new ErrorReporte('DATOS_INVALIDOS', `modificador de marcador desconocido: ${mod}`);
      return formatearValor(c.valor, c.unidad, mod as FormatoCifra);
    }
    return formatearCifra(c);
  });
}

/** Titular de accion: maximo 22 palabras (spec 16, 1.2). */
export function palabras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}
