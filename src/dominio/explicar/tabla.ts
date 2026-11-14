// Orden, paginacion y CSV del detalle de movimientos de "Explicar este numero". Puro: solo reordena y parte filas ya calculadas por la base.
import type { FilaDetalle } from './vista';

export type ClaveOrden = 'fecha' | 'folio' | 'concepto' | 'monto';
export type Sentido = 'asc' | 'desc';
export const POR_PAGINA = 10;

export function ordenarDetalle(filas: readonly FilaDetalle[], clave: ClaveOrden, sentido: Sentido): FilaDetalle[] {
  const signo = sentido === 'asc' ? 1 : -1;
  const cmp = (a: FilaDetalle, b: FilaDetalle): number => {
    switch (clave) {
      case 'monto': return a.monto - b.monto;
      case 'fecha': return (a.fecha ?? '').localeCompare(b.fecha ?? '');
      case 'folio': return a.folio.localeCompare(b.folio, 'es', { numeric: true });
      default: return a.concepto.localeCompare(b.concepto, 'es', { sensitivity: 'base' });
    }
  };
  // Orden estable con desempate por posicion original: dos filas iguales no se intercambian al cambiar de pagina.
  return filas.map((f, i) => ({ f, i })).sort((x, y) => signo * cmp(x.f, y.f) || x.i - y.i).map((x) => x.f);
}

export function paginar<T>(filas: readonly T[], pagina: number, tam = POR_PAGINA): { filas: T[]; pagina: number; paginas: number } {
  const paginas = Math.max(1, Math.ceil(filas.length / tam));
  const actual = Math.min(Math.max(0, pagina), paginas - 1);
  return { filas: filas.slice(actual * tam, actual * tam + tam), pagina: actual, paginas };
}

/** Neutraliza formulas de hoja de calculo (=, +, @, tab, retorno); el menos tipografico no es operador. */
const neutralizar = (t: string) => (/^[=+@\t\r-]/.test(t) && !/^−/.test(t) ? `'${t}` : t);
const celda = (t: string) => `"${neutralizar(t.replace(/\s+/g, ' ').trim()).replaceAll('"', '""')}"`;

/** CSV con todas las filas (no solo la pagina visible), en el orden que ve la persona. Lleva BOM para que Excel respete los acentos. */
export function csvDeDetalle(filas: readonly FilaDetalle[]): string {
  const cab = ['Folio', 'Fecha', 'Concepto', 'Monto', 'Saldo', 'Origen', 'Nota'];
  const lineas = filas.map((f) => [f.folio, f.fechaTexto, f.concepto, f.montoTexto, f.saldoTexto ?? '', f.origen, f.nota ?? ''].map(celda).join(','));
  return `\uFEFF${[cab.map(celda).join(','), ...lineas].join('\r\n')}\r\n`;
}

export function nombreArchivoCsv(cifra: string): string {
  return `explicar-${cifra.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cifra'}.csv`;
}
