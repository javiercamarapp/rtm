// Exportacion del kardex a CSV con las columnas del Excel (entradas, salidas y existencias, cada una con cantidad, unitario y total) mas hora, tipo, referencia, autor y mensaje original.
import { marcaMayus, nombreVape, saborMayus } from '@/dominio/formato';
import type { Cent, Kardex } from './tipos';

function pesos(c: Cent | null): string {
  if (c === null) return '';
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

function celda(v: string | number | null): string {
  if (v === null) return '';
  const t = String(v);
  // Un texto que empieza con = + - @ se tomaria como formula al abrirlo en una hoja de calculo: se neutraliza.
  const seguro = /^[=+@-]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
  return /[",\n\r]/.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
}

export const COLUMNAS_KARDEX = [
  'Fecha', 'Hora', 'Tipo', 'Referencia', 'Sabor', 'Entra piezas', 'Entra unitario', 'Entra total', 'Sale piezas', 'Sale unitario', 'Sale total',
  'Existencia piezas', 'Existencia valor', 'Costo promedio', 'Existencia del sabor', 'Evento', 'Canal', 'Autor', 'Mensaje original', 'Reversa de',
] as const;

export function kardexCsv(k: Kardex): string {
  const filas = k.movimientos.map((m) => [
    m.fecha_neg, m.hora, m.tipo.replaceAll('_', ' '), m.referencia, saborMayus(m.sabor), m.entra_piezas, pesos(m.entra_unit_cent), pesos(m.entra_total_cent), m.sale_piezas, pesos(m.sale_unit_cent), pesos(m.sale_total_cent),
    m.saldo_piezas, pesos(m.saldo_valor_cent), pesos(m.costo_prom_cent), m.saldo_sabor_piezas, m.evento, m.canal, m.autor, m.mensaje_origen, m.reversa_de,
  ].map((v) => celda(v)).join(','));
  return [`Kardex de ${marcaMayus(k.modelo.marca)} ${nombreVape(k.modelo.nombre)}`, COLUMNAS_KARDEX.join(','), ...filas].join('\r\n') + '\r\n';
}
