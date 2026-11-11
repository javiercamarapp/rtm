// Puente de utilidad (spec 16, 3.1). Descompone U1 - U0 en volumen, mezcla, precio, costo, guia y otros, y SUMA EXACTAMENTE la diferencia.
//   Volumen = (Q1 - Q0) * u0medio        Mezcla = sum(q1m * u0m) - Q1 * u0medio        Tasa = sum(q1m * (u1m - u0m)) abierta en 4 renglones.
// Los racionales se redondean con reparto de mayor residuo: la suma de los pasos en centavos es identica a U1 - U0.
import type { PedidoInsumo } from './insumos';
import { PARAMETROS } from './parametros';
import { ErrorReporte } from './tipos';
import { type Rac, RAC_CERO, cmpTexto, prorratear, rac, repartirExacto, restaRac, sumaBig, sumaRac, sumarRacs, porRac } from './util';

export interface AgregadoModelo {
  readonly modelo: string;
  readonly piezas: number;
  readonly ventaCent: bigint;
  readonly costoCent: bigint;
  readonly guiaCent: bigint;
  /** Renta de bodega y mensajeros prorrateados. */
  readonly otrosCent: bigint;
}

export type IdPaso = 'volumen' | 'mezcla' | 'precio' | 'costo' | 'guia' | 'otros';
export interface PasoPuente {
  readonly id: IdPaso;
  readonly etiqueta: string;
  readonly deltaCent: bigint;
}
export interface Puente {
  readonly inicioCent: bigint;
  readonly pasos: readonly PasoPuente[];
  readonly finCent: bigint;
}

export const contribucionModelo = (a: AgregadoModelo): bigint => a.ventaCent - a.costoCent - a.guiaCent - a.otrosCent;

/** Agrega pedidos por modelo prorrateando guia y otros por piezas de la linea (residuo exacto en la ultima). */
export function agregarPorModelo(pedidos: readonly PedidoInsumo[]): AgregadoModelo[] {
  const acc = new Map<string, { piezas: number; venta: bigint; costo: bigint; guia: bigint; otros: bigint }>();
  for (const p of pedidos) {
    for (const l of p.lineas) if (!Number.isInteger(l.piezas) || l.piezas < 0) throw new ErrorReporte('DATOS_INVALIDOS', `piezas invalidas en ${p.folio}`);
    const pesos = p.lineas.map((l) => l.piezas);
    const piezasPedido = pesos.reduce((a, b) => a + b, 0);
    const guias = prorratear(p.guiaCent, pesos);
    const mensajeros = prorratear(p.mensajeroCent, pesos);
    const renta = p.origen === 'bodega' ? PARAMETROS.rentaBodegaCentPorPz : 0n;
    p.lineas.forEach((l, i) => {
      const otros = mensajeros[i]! + renta * BigInt(l.piezas);
      const a = acc.get(l.modelo) ?? { piezas: 0, venta: 0n, costo: 0n, guia: 0n, otros: 0n };
      a.piezas += l.piezas;
      a.venta += l.precioCent * BigInt(l.piezas);
      a.costo += l.costoCent * BigInt(l.piezas);
      a.guia += guias[i]!;
      a.otros += otros;
      acc.set(l.modelo, a);
    });
    if (piezasPedido === 0 && (p.guiaCent !== 0n || p.mensajeroCent !== 0n)) throw new ErrorReporte('DATOS_INVALIDOS', `pedido ${p.folio} sin piezas con gastos`);
  }
  return [...acc.entries()]
    .map(([modelo, a]) => ({ modelo, piezas: a.piezas, ventaCent: a.venta, costoCent: a.costo, guiaCent: a.guia, otrosCent: a.otros }))
    .sort((x, y) => cmpTexto(x.modelo, y.modelo));
}

const ETIQUETAS: Record<IdPaso, string> = { volumen: 'Volumen', mezcla: 'Mezcla', precio: 'Precio', costo: 'Costo', guia: 'Guía', otros: 'Otros' };

/** Devuelve null si no hay periodo previo comparable (Q0 = 0): la spec exige 2 periodos. */
export function calcularPuente(previo: readonly AgregadoModelo[], actual: readonly AgregadoModelo[]): Puente | null {
  for (const a of [...previo, ...actual]) {
    if (a.piezas === 0 && (a.ventaCent !== 0n || a.costoCent !== 0n || a.guiaCent !== 0n || a.otrosCent !== 0n)) throw new ErrorReporte('DATOS_INVALIDOS', `modelo ${a.modelo} con importes y sin piezas`);
  }
  const q0 = previo.reduce((s, a) => s + a.piezas, 0);
  const q1 = actual.reduce((s, a) => s + a.piezas, 0);
  if (q0 === 0) return null;
  const u0 = sumaBig(previo.map(contribucionModelo));
  const u1 = sumaBig(actual.map(contribucionModelo));
  const uBar0 = rac(u0, BigInt(q0));
  const volumen = porRac(rac(BigInt(q1 - q0)), uBar0);

  const previoPorModelo = new Map(previo.filter((a) => a.piezas > 0).map((a) => [a.modelo, a]));
  let sumQ1U0: Rac = RAC_CERO;
  let precio: Rac = RAC_CERO;
  let costo: Rac = RAC_CERO;
  let guia: Rac = RAC_CERO;
  let otros: Rac = RAC_CERO;
  for (const a of actual) {
    if (a.piezas === 0) continue;
    const q = rac(BigInt(a.piezas));
    const p0 = previoPorModelo.get(a.modelo);
    if (!p0) {
      // Modelo nuevo: u0m = u1m, su contribucion entra por mezcla y no por tasa.
      sumQ1U0 = sumaRac(sumQ1U0, rac(contribucionModelo(a)));
      continue;
    }
    const por = (n1: bigint, n0: bigint, signo: bigint): Rac => porRac(q, restaRac(rac(signo * n1, BigInt(a.piezas)), rac(signo * n0, BigInt(p0.piezas))));
    sumQ1U0 = sumaRac(sumQ1U0, porRac(q, rac(contribucionModelo(p0), BigInt(p0.piezas))));
    precio = sumaRac(precio, por(a.ventaCent, p0.ventaCent, 1n));
    costo = sumaRac(costo, por(a.costoCent, p0.costoCent, -1n));
    guia = sumaRac(guia, por(a.guiaCent, p0.guiaCent, -1n));
    otros = sumaRac(otros, por(a.otrosCent, p0.otrosCent, -1n));
  }
  const mezcla = restaRac(sumQ1U0, porRac(rac(BigInt(q1)), uBar0));
  const racionales = [volumen, mezcla, precio, costo, guia, otros];
  const total = u1 - u0;
  if (sumarRacs(racionales).d !== 1n || sumarRacs(racionales).n !== total) throw new ErrorReporte('PUENTE_NO_CUADRA', 'los componentes racionales no suman la diferencia de utilidad');
  const ids: IdPaso[] = ['volumen', 'mezcla', 'precio', 'costo', 'guia', 'otros'];
  const enteros = repartirExacto(racionales, total);
  const pasos = ids.map((id, i) => ({ id, etiqueta: ETIQUETAS[id], deltaCent: enteros[i]! }));
  const puente: Puente = { inicioCent: u0, pasos, finCent: u1 };
  if (!puenteCuadra(puente)) throw new ErrorReporte('PUENTE_NO_CUADRA', 'inicio + suma de pasos no igual al final');
  return puente;
}

/** Invariante dibujable: inicio + suma de pasos = fin. Si no se cumple, el puente no se dibuja. */
export const puenteCuadra = (p: Puente): boolean => p.inicioCent + sumaBig(p.pasos.map((x) => x.deltaCent)) === p.finCent;

/** Causa dominante: el paso de mayor valor absoluto (empate por orden de la lista). */
export function causaDominante(p: Puente): PasoPuente {
  return p.pasos.reduce((m, x) => ((x.deltaCent < 0n ? -x.deltaCent : x.deltaCent) > (m.deltaCent < 0n ? -m.deltaCent : m.deltaCent) ? x : m), p.pasos[0]!);
}
