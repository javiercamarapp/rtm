// "Por pagar" de la empresa: Isaac + Karen + renta de Omar, cada renglon por separado y el total con todos. La base (api.por_pagar / api.pulso.por_pagar) calcula las cifras;
// aqui solo se arma el texto y las partes de la barra. La renta ya esta en el libro (2210): este renglon es solo presentacion, no un cargo nuevo.
import { formatearMoneda } from '../formato';

export interface RenglonPorPagar { clave: 'isaac' | 'karen' | 'renta_omar'; etiqueta: string; monto_cent: bigint; piezas?: number }
export interface PorPagar { total_cent: bigint; a_favor_cent: bigint; renglones: RenglonPorPagar[] }

export interface PresentacionPorPagar {
  /** Total con todos los renglones; null cuando no hay datos de la base. */
  texto: string | null;
  /** "Isaac $x · Karen $y · Renta de Omar $z". */
  detalle: string | null;
  partes: { etiqueta: string; valor: number }[];
}

export function presentarPorPagar(p: PorPagar | null | undefined): PresentacionPorPagar {
  if (!p) return { texto: null, detalle: null, partes: [] };
  return {
    texto: formatearMoneda(p.total_cent),
    detalle: p.renglones.map((r) => `${r.etiqueta} ${formatearMoneda(r.monto_cent)}`).join(' · '),
    partes: p.renglones.filter((r) => r.monto_cent > 0n).map((r) => ({ etiqueta: r.etiqueta, valor: Number(r.monto_cent) })),
  };
}
