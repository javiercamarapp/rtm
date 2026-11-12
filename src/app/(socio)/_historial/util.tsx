// Formato del historial personal y del acta. Nada aqui calcula dinero: solo muestra lo que entregaron la base y dominio/historial/ratios.
import { formatearDecimal } from '@/dominio/formato';
import { SinDato } from '@/ui/componentes/estado-texto';
import { m } from '../_a3/util';

export { m };
export const bpAPct = (bp: bigint | null): string | null => (bp === null ? null : `${formatearDecimal(Number(bp) / 100, 1)} %`);
export const razon = (x100: bigint | null): string | null => (x100 === null ? null : `${formatearDecimal(Number(x100) / 100, 2)} veces`);
export const mesesTexto = (n: number | null): string | null => (n === null ? null : n === 0 ? 'Ya recuperado' : `${n} ${n === 1 ? 'mes' : 'meses'}`);
export const conSigno = (c: bigint | null): string | null => (c === null ? null : m(c, true));
export const sd = (v: string | null) => v ?? <SinDato />;
/** Anos presentes en una lista de periodos 'AAAA-MM-DD' (mas reciente primero). */
export const anosDe = (fechas: readonly string[]): string[] => [...new Set(fechas.map((f) => f.slice(0, 4)))].sort().reverse();
export const NOMBRES = ['Angelo', 'Javier'] as const;
