// OpenRouter: consumo de RTM desde el libro propio de llamadas de IA y comision de recarga (spec 17, secciones 2 y 4).
// Solo cuenta lo que RTM consumio (libro), nunca el saldo ni el gasto de otros productos de la cuenta.

import { fechaNeg } from '../calendario';
import { type MontoCalculado, calcularMonto } from './cargo';
import { ErrorCostos } from './errores';

export type RolIa = 'texto_simple' | 'respaldo' | 'casos_dificiles' | 'audio' | 'reportes' | 'evaluacion';
export type EstadoLlamada = 'liquidada' | 'reservada' | 'fallida';

export interface LlamadaIa {
  /** Instante UTC ISO 8601 (termina en Z). */
  ts: string;
  rol: RolIa;
  modelo: string;
  /** Costo real (`usage.cost`) en millonesimas de dolar. */
  costoUsdMicro: bigint;
  estado: EstadoLlamada;
}

export interface ConsumoDelMes {
  mes: string;
  totalUsdMicro: bigint;
  porRol: Partial<Record<RolIa, bigint>>;
  porModelo: Record<string, bigint>;
  llamadas: number;
}

/** Mes civil AAAA-MM en America/Merida de un instante UTC ISO. */
export function mesDeInstante(tsUtc: string): string {
  const d = new Date(tsUtc);
  if (Number.isNaN(d.getTime())) throw new ErrorCostos('monto_invalido', 'Instante invalido en el libro de IA.');
  return fechaNeg(d).slice(0, 7);
}

/** Suma del libro del mes. Solo llamadas liquidadas; las reservas y las fallidas no son consumo. */
export function consumoDelMes(llamadas: readonly LlamadaIa[], mes: string): ConsumoDelMes {
  const out: ConsumoDelMes = { mes, totalUsdMicro: 0n, porRol: {}, porModelo: {}, llamadas: 0 };
  for (const l of llamadas) {
    if (l.estado !== 'liquidada') continue;
    if (l.costoUsdMicro < 0n) throw new ErrorCostos('monto_invalido', 'Una llamada del libro tiene costo negativo.');
    if (mesDeInstante(l.ts) !== mes) continue;
    out.totalUsdMicro += l.costoUsdMicro;
    out.porRol[l.rol] = (out.porRol[l.rol] ?? 0n) + l.costoUsdMicro;
    out.porModelo[l.modelo] = (out.porModelo[l.modelo] ?? 0n) + l.costoUsdMicro;
    out.llamadas += 1;
  }
  return out;
}

export interface ResultadoComision {
  calculo: MontoCalculado;
  /** Con el interruptor apagado queda como memo: sin asiento ni efecto en la cuenta de los socios. */
  enAsiento: boolean;
}

/** Comision de recarga proporcional al consumo de RTM (5.5 % = 55_000 ppm). Tasa exacta, sin techo al punto. */
export function comisionDeRecarga(consumoUsdMicro: bigint, comisionPpm: bigint, incluir: boolean, tcMicro: bigint): ResultadoComision {
  return { calculo: calcularMonto({ baseOrigMicro: consumoUsdMicro, moneda: 'USD', pctAplicadoPpm: comisionPpm, tcMicro }), enAsiento: incluir };
}
