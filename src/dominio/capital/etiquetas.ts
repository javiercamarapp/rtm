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

/** Turno de aportar: el socio con menos aportacion neta aporta el siguiente pago por la diferencia; sin diferencia, Igualados. Sin lenguaje de deuda. */
export function textoTurno(turno: NombreSocio | null, diferenciaCent: bigint, formato: (c: bigint) => string): string {
  return turno === null || diferenciaCent === 0n ? 'Igualados' : `Le toca aportar el siguiente pago: ${turno} por ${formato(diferenciaCent)}`;
}

export const NOTA_IGUALACION = 'Aportar más no da más participación: la diferencia a igualar no es una deuda ni un reembolso a favor del otro, se resuelve con las siguientes aportaciones del que tiene menos, y así ambos tienen el mismo dinero invertido.';

/** Reinversion del mes: igual para los dos o alerta informativa. null = nadie reinvirtio por acta. */
export function textoReinversion(angeloCent: bigint, javierCent: bigint, formato: (c: bigint) => string): { igual: boolean; texto: string } | null {
  if (angeloCent === 0n && javierCent === 0n) return null;
  return angeloCent === javierCent
    ? { igual: true, texto: 'Reinvertido este mes: igual para los dos' }
    : { igual: false, texto: `Reinversión distinta en el acta: Angelo ${formato(angeloCent)} y Javier ${formato(javierCent)}. Se busca reinvertir lo mismo cada mes.` };
}
