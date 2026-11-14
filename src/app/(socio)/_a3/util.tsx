// Utilidades de presentacion del lote A3 (cuentas por cobrar, proveedores, socios, Omar y contabilidad). Nada aqui calcula reglas de negocio:
// solo proporciones para barras, sumas de columnas ya entregadas por la base y la traduccion de tonos a chips.
import type { ReactNode } from 'react';
import '@/ui/estilos/paginas-a3.css';
import '@/ui/estilos/barrido-c.css';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { ChipEstado } from '@/ui/componentes/controles';

export const m = (c: bigint, conSigno = false) => formatearMoneda(c, conSigno ? { conSigno: true } : {});
export const suma = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
export const abs = (c: bigint): bigint => (c < 0n ? -c : c);

/** Porcentaje 0 a 100 de una parte sobre un total (para barras y razones). null si el total no es positivo: sin dato, nunca 0. */
export function pct(parte: bigint, total: bigint): number | null {
  if (total <= 0n) return null;
  const v = Number((parte * 10000n) / total) / 100;
  return Math.min(100, Math.max(0, v));
}
export const pctTexto = (p: number | null): string => (p === null ? 'Sin dato' : `${p.toFixed(1)} %`);

export type TonoViejo = 'ok' | 'atencion' | 'malo' | 'neutro' | 'info' | 'apagado';
/** Chip de estado en palabra (el tono "neutro" del sistema anterior es "apagado" en el catalogo nuevo). */
export function Estado({ tono, children }: { tono: TonoViejo; children: ReactNode }) {
  return <ChipEstado tono={tono === 'neutro' ? 'apagado' : tono}>{children}</ChipEstado>;
}

/** Procedencia de la tarjeta: "Corte: 12 nov · Fuente: ...". */
export function Pie({ children }: { children: ReactNode }) {
  return <p className="a3-pie">{children}</p>;
}

/** Texto de dos lineas para celdas densas. */
export function Dos({ a, b }: { a: ReactNode; b?: ReactNode }) {
  return <span className="a3-celda-2">{a}{b ? <small>{b}</small> : null}</span>;
}

/** "2026-11-09" -> "9 nov" (para ejes de graficas). */
export const fechaCorta = (f: string): string => etiquetaFecha(f).replace(/ \d{4}$/, '');

