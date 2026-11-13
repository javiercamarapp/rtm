// Forma de lo que entregan api.historial_socio, api.acta_detalle y api.acta_periodo_sugerido. Todo `*_cent` es bigint (centavos); null = sin dato.
import type { CierreReparto } from '@/dominio/operacion/tipos';

export type Cent = bigint;
export type NombreSocio = 'Angelo' | 'Javier';

export interface FilaSerie {
  ini: string; fin: string; parcial: boolean;
  utilidad_cent: Cent; parte_cent: Cent; pedidos: number; piezas: number; ventas_cent: Cent;
  retiros_cent: Cent; reinversion_cent: Cent; aportaciones_cent: Cent; provisional: boolean;
}
export interface ActaLinea {
  id: number; folio: string; tipo: 'periodo' | 'contra'; periodo_ini: string; periodo_fin: string; utilidad_cent: Cent;
  parte_cent: Cent; retira_cent: Cent; reinvierte_cent: Cent; estado: 'propuesto' | 'firmado_por_uno' | 'cerrado'; corregida: boolean; /** Hay una contra-acta propuesta que aun no firman los dos: el acta sigue vigente. */ contra_propuesta: boolean;
  firmas: { socio: string; firmado_at: string }[]; capital_contable_cent: Cent | null; valor_cent: Cent | null; huella: string | null;
}
export interface Flujo { fecha: string; monto_cent: Cent; tipo: 'aportacion' | 'retiro' | 'retiro_capital' }
export interface Cabecera {
  /** Capital aportado acumulado (la cifra de Capital por mes): aportaciones declaradas, reinversion por acta y apertura. */
  aportaciones_cent: Cent; reinversion_cent: Cent; invertido_cent: Cent; invertido_ambos_cent: Cent;
  /** Retirado = retiros de utilidad + devolucion de aportaciones (una sola definicion en la base: operacion.retirado_socio). */
  retirado_utilidad_cent: Cent; retirado_capital_cent: Cent; retirado_cent: Cent; utilidad_asignada_cent: Cent; utilidad_por_distribuir_cent: Cent;
  capital_contable_cent: Cent | null;
  /** Valuacion personal (la de Capital por mes): capital aportado + su 50 % de la utilidad sin acta - fondos de la sociedad en su poder. null = sin asientos. */
  valor_cent: Cent | null; valor_libro_cent: Cent | null;
  /** La participacion es siempre 50/50 (5000 puntos base). */
  participacion_bp: number;
  aportado_cent: Cent; fondos_cent: Cent;
  /** Aportacion neta = aportado (capital + dinero propio como reembolso) - fondos de la sociedad en su poder. */
  aportacion_neta_cent: Cent;
  /** La mayor aportacion neta menos la suya; NO es una deuda ni un reembolso a favor del otro. */
  diferencia_a_igualar_cent: Cent; le_toca_aportar: boolean; turno_aportar: NombreSocio | null; igualados: boolean;
  reembolso_pendiente_cent: Cent; efectivo_total_cent: Cent; efectivo_disponible_cent: Cent;
  /** Resultado de la comprobacion por dos vias de cada cifra; null = sin dato o sin segunda via. */
  comprobaciones: Record<'invertido' | 'retirado' | 'utilidad' | 'valor' | 'neta', boolean | null>;
  primera_fecha: string | null; meses_activo: number;
}
export interface PorCliente { cliente_id: number; cliente: string; pedidos: number; piezas: number; utilidad_cent: Cent; parte_cent: Cent }
export interface PorModelo { modelo: string; piezas: number; venta_cent: Cent; costo_cent: Cent; utilidad_cent: Cent; parte_cent: Cent }
export interface HistorialSocio {
  socio: NombreSocio; otro: NombreSocio; hoy: string; hasta: string; con_historial: boolean;
  cabecera: Cabecera; flujos: Flujo[]; actas: ActaLinea[];
  totales: { utilidad_cent: Cent; parte_cent: Cent; pedidos: number; piezas: number; ventas_cent: Cent; provisional: boolean } | null;
  dias: FilaSerie[]; semanas: FilaSerie[]; meses: FilaSerie[]; por_cliente: PorCliente[]; por_modelo: PorModelo[];
}

export interface SelloActa {
  contenido: {
    periodo_ini: string; periodo_fin: string; utilidad_cent: Cent; decisiones: Record<string, { retira: Cent; reinvierte: Cent }>;
    valuacion_cent: Cent | null; deudas_cent: Cent | null; capital_contable_cent: Cent | null; valor_participacion_cent: Record<string, Cent> | null;
    /** Fecha unica del sello: todas las cifras de valuacion son al corte del acta (periodo_fin). */
    al_corte?: string;
    /** Cifras AL CORTE (null si el sello se tomo sin asientos). `*_tras_acta` suma la decision del acta (se asienta despues del corte). */
    por_socio: Record<string, { invertido_cent: Cent | null; aportacion_neta_cent: Cent | null; fondos_en_poder_cent: Cent | null; valuacion_cent: Cent | null; retirado_cent: Cent;
      invertido_tras_acta_cent: Cent | null; retirado_tras_acta_cent: Cent; queda_cent: Cent; compensaciones_cent: Cent }>;
  };
  huella: string; sellado_at: string;
}
export interface ActaDetalle { cierre: CierreReparto; sello: SelloActa | null; /** Disponible y lo que queda por distribuir por socio, calculados por la base (ausente en una contra-acta). */ por_socio_acta: Record<string, { disponible_cent: Cent; queda_cent: Cent; /** Resultado de la comprobacion por dos vias del disponible (null = sin comprobar). */ cuadra: boolean | null }>; /** Idem, de la utilidad neta del periodo. */ utilidad_cuadra: boolean | null; corrige_folio: string | null; contra_acta_folio: string | null }
export interface ReinversionSugerida { ini: string; fin: string; monto_comun_cent: Cent; por_socio: Record<string, { disponible_cent: Cent; reinvierte_sugerido_cent: Cent }>; regla: string }
export interface PeriodoSugerido { ini: string; fin: string; hoy: string; ultimo_corte: string | null; listo: boolean; disponible_desde: string; acta_pendiente_id: number | null; hay_actividad: boolean }

/** Las decisiones de un acta viajan como {retira, reinvierte} (sin sufijo _cent), asi que la conversion general de centavos no las toca: se convierten aqui. */
export function decisionesABigint(d: Record<string, { retira: unknown; reinvierte: unknown }> | null | undefined): Record<string, { retira: Cent; reinvierte: Cent }> {
  const salida: Record<string, { retira: Cent; reinvierte: Cent }> = {};
  for (const [socio, x] of Object.entries(d ?? {})) salida[socio] = { retira: BigInt(x.retira as number | bigint), reinvierte: BigInt(x.reinvierte as number | bigint) };
  return salida;
}
