// Registros inmutables del apartado "Costos de mantenimiento del sistema".
// Un cargo y un reembolso son hechos de solo insercion: corregir = contramovimiento enlazado, nunca editar.

import type { FuenteTipoCambio, Moneda } from './cargo';

export type CategoriaCosto = 'nube' | 'ia' | 'software' | 'dominio';
export type FaseCosto = 'construccion' | 'mantenimiento';
export type EtiquetaCosto = 'medido' | 'recibo' | 'capturado' | 'atribuido' | 'estimado_prorrateado' | 'proyeccion';
export type EstadoCargo = 'provisional' | 'confirmado' | 'disputado' | 'anulado';
export type SocioId = 'angelo' | 'javier';
export type TipoEvidencia = 'api' | 'recibo' | 'libro' | 'captura' | 'script_local';

export interface CargoCosto {
  readonly id: string;
  /** Folio K sin huecos. */
  readonly folio: string;
  readonly servicioSlug: string;
  readonly categoria: CategoriaCosto;
  /** AAAA-MM en America/Merida. */
  readonly mes: string;
  readonly fechaNeg: string;
  readonly fase: FaseCosto;
  /** Factura o consumo total del proveedor atribuido, en millonesimas de la moneda original (puede ser negativo en notas de credito). */
  readonly baseOrigMicro: bigint;
  readonly moneda: Moneda;
  readonly pctExactoPpm: bigint;
  readonly pctAplicadoPpm: bigint;
  readonly tcMicro: bigint;
  readonly tcFecha: string;
  readonly tcFuente: FuenteTipoCambio;
  readonly exactoMxnE6: bigint;
  /** MXN exacto (centavos x 1e6) con el porcentaje exacto, antes del techo al punto porcentual. Igual a exactoMxnE6 si no hubo participacion. */
  readonly exactoPuroMxnE6: bigint;
  /** Gasto en centavos MXN, redondeado hacia arriba. Nunca menor que el exacto (salvo reversa, que copia con signo contrario). */
  readonly montoCent: bigint;
  /** Columnas de plataformas compartidas (decision 20, punto 2): "como seria" y "como deberia ser" en centavos redondeados. Null si no aplica la regla del mayor. */
  readonly comoSeriaCent: bigint | null;
  readonly comoDeberiaCent: bigint | null;
  readonly pagadoPor: SocioId;
  /** Si es cobrable, es gasto de la sociedad y genera cuenta por pagar al socio que pago. */
  readonly cobrable: boolean;
  readonly etiqueta: EtiquetaCosto;
  readonly estado: EstadoCargo;
  readonly evidenciaTipo: TipoEvidencia;
  readonly evidenciaSha256: string | null;
  readonly nota: string;
  readonly reversaDe: string | null;
  readonly claveIdem: string;
}

export interface ReembolsoCosto {
  readonly id: string;
  readonly folio: string;
  /** Quien recibe el reembolso (el socio que pago). */
  readonly aSocio: SocioId;
  readonly montoCent: bigint;
  readonly fechaNeg: string;
  readonly medio: string;
  readonly comprobanteSha256: string | null;
  readonly claveIdem: string;
  /** Cuenta de fondos de la sociedad de donde sale el pago. */
  readonly fondosDe: SocioId;
}

export const NOMBRE_GASTO = 'Costos de mantenimiento del sistema';
export const NOMBRE_CUENTA_POR_PAGAR = 'Reembolso de costos del sistema';
