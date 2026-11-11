// Atribucion por consumo (spec 17, secciones 2 y 3.3; decisiones 20).
// A cada servicio solo se atribuye lo que RTM consume. Todo en enteros, redondeo hacia arriba.

import { ppmExactoTruncado, techoPctDeFraccion } from '../dinero/techo';
import { ErrorCostos } from './errores';
import { type MontoCalculado, montoDesdeNumerador, numeradorMxn, PPM_CIEN, validarPorcentaje, validarTipoCambio } from './cargo';

export interface Participacion {
  /** Truncada, solo para mostrar ("exacta 16.67 %"). */
  exactoPpm: bigint;
  /** Techo al punto porcentual entero: la que se cobra. */
  aplicadoPpm: bigint;
}

/** Participacion de RTM = consumo de RTM / consumo total, techo al punto porcentual. */
export function participacionPorConsumo(consumoRtm: bigint, consumoTotal: bigint): Participacion {
  if (consumoTotal <= 0n) throw new ErrorCostos('sin_dato', 'Sin consumo total del periodo: no hay participacion calculable.');
  if (consumoRtm < 0n || consumoRtm > consumoTotal) throw new ErrorCostos('porcentaje_invalido', 'El consumo de RTM debe estar entre 0 y el total.');
  return { exactoPpm: ppmExactoTruncado(consumoRtm, consumoTotal), aplicadoPpm: techoPctDeFraccion(consumoRtm, consumoTotal) };
}

export type BaseDelCobro = 'cuota_documento' | 'consumo_real';

export interface EntradaMayor {
  /** Factura del mes de la plataforma compartida (micro de la moneda original). */
  facturaOrigMicro: bigint;
  /** Cuota del documento de Angelo ("como seria"), p. ej. Vercel ~US$20, Supabase hasta US$25. */
  cuotaDocumentoOrigMicro: bigint;
  /** Participacion real por consumo ("como deberia ser"), ya con techo al punto. */
  participacionAplicadaPpm: bigint;
  tcMicro: bigint;
}

export interface ResultadoMayor {
  comoSeria: MontoCalculado;
  comoDeberia: MontoCalculado;
  /** El mayor de ambos; en empate gana el consumo real. */
  cobrado: MontoCalculado;
  base: BaseDelCobro;
  /** Cobrado menos "como deberia ser", en centavos redondeados: lo que la sociedad asume de mas. */
  diferenciaCent: bigint;
}

/**
 * Plataformas de cuota fija compartidas (decision 20, punto 2): se cobra el MAYOR entre la cuota del
 * documento y la participacion real por consumo, redondeado hacia arriba. Se devuelven las dos columnas.
 */
export function reglaDelMayor(e: EntradaMayor): ResultadoMayor {
  validarTipoCambio(e.tcMicro);
  validarPorcentaje(e.participacionAplicadaPpm);
  if (e.facturaOrigMicro < 0n || e.cuotaDocumentoOrigMicro < 0n) throw new ErrorCostos('monto_invalido', 'Factura y cuota no pueden ser negativas.');
  const nSeria = numeradorMxn(e.cuotaDocumentoOrigMicro, PPM_CIEN, e.tcMicro);
  const nDeberia = numeradorMxn(e.facturaOrigMicro, e.participacionAplicadaPpm, e.tcMicro);
  const comoSeria = montoDesdeNumerador(nSeria);
  const comoDeberia = montoDesdeNumerador(nDeberia);
  const gana: BaseDelCobro = nSeria > nDeberia ? 'cuota_documento' : 'consumo_real';
  const cobrado = gana === 'cuota_documento' ? comoSeria : comoDeberia;
  return { comoSeria, comoDeberia, cobrado, base: gana, diferenciaCent: cobrado.montoCent - comoDeberia.montoCent };
}
