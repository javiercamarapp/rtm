// CSV del kardex consolidado: las columnas del Excel (entradas, salidas y existencias con cantidad, unitario y total) mas modelo, sabor, valor del sabor, autor y mensaje original.
import { marcaMayus, nombreVape, saborMayus } from '@/dominio/formato';
import type { FilaKardex, KardexConsolidado } from './tipos';

function pesos(c: bigint | null): string {
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

export const COLUMNAS_KARDEX_CONSOLIDADO = [
  'Fecha', 'Hora', 'Tipo', 'Referencia', 'Marca', 'Modelo', 'Sabor', 'Entra piezas', 'Entra unitario', 'Entra total', 'Sale piezas', 'Sale unitario', 'Sale total',
  'Existencia piezas', 'Existencia valor', 'Costo promedio', 'Existencia del sabor', 'Valor del sabor (a costo del modelo)', 'Evento', 'Canal', 'Autor', 'Mensaje original', 'Reversa de',
] as const;

export function kardexConsolidadoCsv(k: KardexConsolidado, filas: FilaKardex[]): string {
  const cuerpo = filas.map((m) => [
    m.fecha_neg, m.hora, m.tipo.replaceAll('_', ' '), m.referencia, marcaMayus(m.marca), nombreVape(m.modelo), saborMayus(m.sabor), m.entra_piezas, pesos(m.entra_unit_cent), pesos(m.entra_total_cent), m.sale_piezas, pesos(m.sale_unit_cent), pesos(m.sale_total_cent),
    m.saldo_piezas, pesos(m.saldo_valor_cent), pesos(m.costo_prom_cent), m.saldo_sabor_piezas, pesos(m.saldo_sabor_valor_cent), m.evento, m.canal, m.autor, m.mensaje_origen, m.reversa_de,
  ].map((v) => celda(v)).join(','));
  const pie = ['', '', 'Totales del filtro', '', '', '', '', k.totales.entradas_piezas, '', pesos(k.totales.entradas_valor_cent), k.totales.salidas_piezas, '', pesos(k.totales.salidas_valor_cent), k.final.piezas, pesos(k.final.valor_cent)].map((v) => celda(v)).join(',');
  return [COLUMNAS_KARDEX_CONSOLIDADO.join(','), ...cuerpo, pie].join('\r\n') + '\r\n';
}
