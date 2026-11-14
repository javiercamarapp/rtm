// Plazo de un pedido dicho por el socio (decision del dueno, 14-nov: todo pedido a credito exige plazo; de contado = 0 dias).
// La IA solo copia la frase; los DIAS los calcula este codigo (nunca el modelo). Una frase ambigua o ilegible vuelve a preguntarse.
import { fechaNeg } from '../calendario';
import { interpretarFechaPago } from './fecha_pago';

export type PlazoInterpretado = { tipo: 'ok'; dias: number } | { tipo: 'no_entendi' };

const NUM_TEXTO: Readonly<Record<string, number>> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10, quince: 15, veinte: 20, treinta: 30 };

function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function numero(t: string): number | null {
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return NUM_TEXTO[t] ?? null;
}

const MS_DIA = 86_400_000;

/** "contado", "a 15 dias", "dos semanas", "quincena", "el viernes" (se vuelve dias contados desde hoy). Rango 0 a 365. */
export function interpretarPlazo(texto: string, ahora: Date): PlazoInterpretado {
  const t = sinAcentos(texto.toLowerCase()).replace(/[,;.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '' || t.length > 80) return { tipo: 'no_entendi' };
  if (/\b(?:de|al)\s+contado\b|^contado$|\bpaga\s+(?:hoy|ya|en el acto)\b|\bpago\s+inmediato\b|\bpagado\b|\bsin\s+credito\b/.test(t)) return { tipo: 'ok', dias: 0 };
  const dias = /\b(\d{1,3}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|diez|quince|veinte|treinta)\s*(?:dias?|d)\b/.exec(t);
  if (dias) {
    const n = numero(dias[1]!);
    return n !== null && n >= 1 && n <= 365 ? { tipo: 'ok', dias: n } : { tipo: 'no_entendi' };
  }
  const semanas = /\b(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|ocho)\s*semanas?\b/.exec(t) ?? (/\buna\s+semana\b/.test(t) ? ['', '1'] : null);
  if (semanas) {
    const n = numero(semanas[1]!);
    return n !== null && n >= 1 && n * 7 <= 365 ? { tipo: 'ok', dias: n * 7 } : { tipo: 'no_entendi' };
  }
  if (/\bquincena\b/.test(t)) return { tipo: 'ok', dias: 15 };
  if (/\b(?:un|1)\s*mes\b/.test(t)) return { tipo: 'ok', dias: 30 };
  // Una fecha ("el viernes", "20 de noviembre"): los dias son la distancia desde hoy. Si es ambigua o ya paso, se pregunta otra vez.
  const f = interpretarFechaPago(texto, ahora);
  if (f.tipo === 'ok') {
    const d = Math.round((Date.parse(`${f.fecha}T00:00:00Z`) - Date.parse(`${fechaNeg(ahora)}T00:00:00Z`)) / MS_DIA);
    return d >= 0 && d <= 365 ? { tipo: 'ok', dias: d } : { tipo: 'no_entendi' };
  }
  return { tipo: 'no_entendi' };
}
