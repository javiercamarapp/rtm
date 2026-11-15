// Desambiguacion de clientes homonimos: lista corta numerada con las opciones y, cuando la base lo entrega, aviso de saldo.
// Codigo puro. Las cifras de saldo vienen del servidor (nunca se calculan aqui).
import { normalizar } from '../catalogo/normalizar';
import { formatearMoneda } from '../formato';
import type { Candidato } from './resolutor';

export interface CandidatoConSaldo extends Candidato {
  /** Saldo por cobrar segun la base; null = sin dato. */
  saldoCent: bigint | null;
}

export const MAX_OPCIONES_LISTA = 8;

export function textoListaNumerada(titulo: string, candidatos: readonly CandidatoConSaldo[]): string {
  const filas = candidatos.slice(0, MAX_OPCIONES_LISTA).map((c, i) => {
    const saldo = c.saldoCent === null ? '' : c.saldoCent > 0n ? ` (debe ${formatearMoneda(c.saldoCent)})` : ' (sin saldo)';
    return `${i + 1}. ${c.nombre}${saldo}`;
  });
  return `${titulo}\n${filas.join('\n')}\nResponde con el número o con el nombre.`;
}

/** Elige un candidato por numero ("2", "el 2", "la dos") o por nombre completo/parcial inequivoco. null = no se pudo. */
export function elegirCandidato(texto: string, candidatos: readonly Candidato[]): Candidato | null {
  const t = normalizar(texto);
  if (t === '') return null;
  const num = /^(?:el|la|opcion|numero|no|#)?\s*(\d{1,2})$/.exec(t);
  if (num) {
    const i = Number(num[1]) - 1;
    return candidatos[i] ?? null;
  }
  const palabras: Readonly<Record<string, number>> = { uno: 0, primero: 0, primera: 0, dos: 1, segundo: 1, segunda: 1, tres: 2, tercero: 2, tercera: 2, cuatro: 3, cuarto: 3, cinco: 4 };
  const w = /^(?:el|la)?\s*(uno|primero|primera|dos|segundo|segunda|tres|tercero|tercera|cuatro|cuarto|cinco)$/.exec(t);
  if (w) return candidatos[palabras[w[1]!]!] ?? null;
  const exactos = candidatos.filter((c) => normalizar(c.nombre) === t);
  if (exactos.length === 1) return exactos[0]!;
  const parciales = candidatos.filter((c) => normalizar(c.nombre).includes(t) || t.includes(normalizar(c.nombre)));
  return parciales.length === 1 ? parciales[0]! : null;
}
