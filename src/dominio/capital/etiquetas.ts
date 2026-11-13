// Etiquetas de la tabla de capital (decision del dueno, 13-nov): la linea de fondos de la sociedad en poder de un socio se llama literalmente
//   «Fondos de la sociedad retirados por ti»            cuando la ve el socio que tiene la sesion (segunda persona, como 'Mi desglose'), y
//   «Fondos de la sociedad retirados por <otro socio>»  para el otro.
// En el reporte por correo y PDF, que va a ambos, se usa el nombre de cada socio. Sin lenguaje de deuda: no dice «debe» ni «adeuda».
import type { NombreSocio } from './tipos';

/** `mio` = socio de la sesion (null en el reporte, que llega a los dos). */
export function etiquetaFondos(socio: NombreSocio, mio: NombreSocio | null): string {
  return mio !== null && socio === mio ? 'Fondos de la sociedad retirados por ti' : `Fondos de la sociedad retirados por ${socio}`;
}

export function etiquetaSocio(socio: NombreSocio, mio: NombreSocio | null): string {
  return mio !== null && socio === mio ? `${socio} (tú)` : socio;
}

/** Aportacion neta y diferencia a igualar: ambos seguiran aportando por partes iguales. */
export function textoIgualar(diferenciaCent: bigint, formato: (c: bigint) => string): string {
  return diferenciaCent === 0n ? 'Sin diferencia que igualar' : `Para igualar: ${formato(diferenciaCent)}`;
}

export const ESTADO_PROVEEDOR: Record<'se_debe' | 'a_favor' | 'sin_saldo', string> = { se_debe: 'Se le debe', a_favor: 'Saldo a favor', sin_saldo: 'Sin saldo' };

/** Mes AAAA-MM a texto "noviembre 2026". */
export function etiquetaMesCapital(mes: string): string {
  const n = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${n[Number(mes.slice(5, 7)) - 1] ?? mes} ${mes.slice(0, 4)}`;
}

/** Puntos base a texto ("52.8 %"); null = sin dato. */
export function pctBp(bp: number | null): string | null {
  return bp === null ? null : `${(bp / 100).toFixed(1)} %`;
}
