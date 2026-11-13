// Calculos deterministas de dropshipping (espejo exacto de las funciones SQL; la base manda: esto solo sirve para la vista previa antes de guardar).
// Ninguna cifra la calcula un modelo de IA.
import { redondearMedioArriba } from '@/dominio/dinero';
import type { Origen } from '@/dominio/operacion/tipos';
import type { ModoInteres, OrigenSurtido } from './tipos';

/** Espejo de operacion.origen_surtido: bodega y Castores = inventario en Merida; todo directo (Karen, Karen via Isaac, Isaac) = dropshipping. */
export function origenSurtido(origen: Origen): OrigenSurtido {
  return origen === 'bodega_omar' || origen === 'castores' ? 'inventario_merida' : 'dropshipping';
}

/**
 * Interes de un credito (espejo de operacion.interes_credito). Simple (por omision; el dueno no ha confirmado simple vs compuesto):
 * base x tasa semanal x semanas. Compuesto: base x ((1 + tasa) ^ semanas - 1). Medio hacia arriba al centavo.
 * Ejemplo del dueno: 26,000.00 a una semana al 10 % => 2,600.00 y total 28,600.00.
 */
export function interesCredito(baseCent: bigint, tasaBp: number, semanas: number, modo: Exclude<ModoInteres, 'fijo'> = 'simple'): bigint {
  if (baseCent < 0n) throw new RangeError('la base del credito no puede ser negativa');
  if (!Number.isInteger(tasaBp) || tasaBp < 0 || tasaBp > 10000) throw new RangeError('porcentaje semanal invalido (0 a 100 %)');
  if (!Number.isInteger(semanas) || semanas < 0 || semanas > 260) throw new RangeError('semanas invalidas (0 a 260)');
  if (modo === 'simple') return redondearMedioArriba(baseCent * BigInt(tasaBp) * BigInt(semanas), 10000n);
  // Compuesto: (10000 + tasa)^n / 10000^n con enteros exactos.
  const num = BigInt(10000 + tasaBp) ** BigInt(semanas);
  const den = 10000n ** BigInt(semanas);
  return redondearMedioArriba(baseCent * (num - den), den);
}

/** Semanas (hacia arriba, minimo 1) entre la fecha de venta y la fecha de pago pactada. Fechas AAAA-MM-DD. */
export function semanasHasta(fechaVenta: string, fechaPago: string): number {
  const dias = Math.round((Date.parse(`${fechaPago}T00:00:00Z`) - Date.parse(`${fechaVenta}T00:00:00Z`)) / 86_400_000);
  if (dias < 0) throw new RangeError('la fecha de pago no puede ser anterior a la venta');
  return Math.max(Math.ceil(dias / 7), 1);
}

export interface RenglonPreview { piezas: number; precioCent: bigint; costoCent: bigint | null }
export interface CreditoPreview { tasaBp: number; semanas: number; modo: Exclude<ModoInteres, 'fijo'>; interesFijoCent?: bigint | null }
export interface Preview {
  piezas: number; ventaMercanciaCent: bigint; costoCent: bigint | null; margenCent: bigint | null; interesCent: bigint; totalCent: bigint; margenPct: number | null; sinCosto: number;
  /** UTILIDAD (definicion del dueno): venta total (con envio cobrado e interes) menos TODO el costo (producto y envio del proveedor). null si falta algun costo. */
  utilidadCent: bigint | null;
}

/** Vista previa del pedido (margen = precio - costo del producto; utilidad = todo el ingreso menos todo el costo): costo a Karen (catalogo del proveedor), margen = precio - costo, e interes del credito sobre la mercancia menos el descuento (sin envio). */
export function previewPedido(renglones: RenglonPreview[], envioCent: bigint, descuentoCent: bigint, credito: CreditoPreview | null, envioProveedorCent: bigint = 0n): Preview {
  let venta = 0n;
  let costo = 0n;
  let piezas = 0;
  let sinCosto = 0;
  for (const r of renglones) {
    piezas += r.piezas;
    venta += BigInt(r.piezas) * r.precioCent;
    if (r.costoCent === null) sinCosto += 1;
    else costo += BigInt(r.piezas) * r.costoCent;
  }
  const base = venta - descuentoCent > 0n ? venta - descuentoCent : 0n;
  const interes = credito ? (credito.interesFijoCent ?? interesCredito(base, credito.tasaBp, credito.semanas, credito.modo)) : 0n;
  const completo = sinCosto === 0;
  const margen = completo ? base - costo : null;
  return {
    piezas, ventaMercanciaCent: venta, costoCent: completo ? costo : null, margenCent: margen, interesCent: interes, totalCent: base + envioCent + interes,
    utilidadCent: completo ? base + envioCent + interes - costo - envioProveedorCent : null,
    margenPct: margen !== null && base > 0n ? Number((margen * 10000n) / base) / 100 : null, sinCosto,
  };
}

export interface ParteReparto { socio: string; ppm: number }
/** Reparto de un monto segun la participacion (espejo de operacion.ds_reparto): el primero recibe el redondeo medio hacia arriba y el ultimo el resto, asi que la suma cuadra siempre. */
export function repartoSocios(montoCent: bigint, partes: ParteReparto[]): { socio: string; montoCent: bigint }[] {
  const signo = montoCent < 0n ? -1n : 1n;
  const abs = montoCent < 0n ? -montoCent : montoCent;
  let acum = 0n;
  return partes.map((p, i) => {
    const m = i === partes.length - 1 ? montoCent - acum : signo * redondearMedioArriba(abs * BigInt(p.ppm), 1_000_000n);
    acum += m;
    return { socio: p.socio, montoCent: m };
  });
}

/** Utilidad reinvertida en el proveedor: lo depositado por el cliente en la cuenta del proveedor por encima del costo (los pagos parciales amortizan primero el costo). Una venta a costo no genera utilidad. */
export function utilidadReinvertida(ventaCent: bigint, costoCent: bigint, depositadoCent: bigint, aCosto: boolean): { utilidadCent: bigint; reinvertidaCent: bigint } {
  const utilidad = aCosto ? 0n : ventaCent - costoCent;
  if (utilidad <= 0n) return { utilidadCent: utilidad, reinvertidaCent: 0n };
  const sobre = (depositadoCent < ventaCent ? depositadoCent : ventaCent) - costoCent;
  const reinv = sobre > 0n ? sobre : 0n;
  return { utilidadCent: utilidad, reinvertidaCent: reinv < utilidad ? reinv : utilidad };
}
