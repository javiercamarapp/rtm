// Forma de lo que entregan api.historial_socio, api.acta_detalle y api.acta_periodo_sugerido. Todo `*_cent` es bigint (centavos); null = sin dato.
import type { CierreReparto } from '@/dominio/operacion/tipos';

export type Cent = bigint;
export type NombreSocio = 'Angelo' | 'Javier';

export interface FilaSerie {
  ini: string; fin: string; parcial: boolean;
  utilidad_cent: Cent; parte_cent: Cent; pedidos: number; piezas: Cent; ventas_cent: Cent;
  retiros_cent: Cent; reinversion_cent: Cent; aportaciones_cent: Cent; provisional: boolean;
}
export interface ActaLinea {
  id: number; folio: string; tipo: 'periodo' | 'contra'; periodo_ini: string; periodo_fin: string; utilidad_cent: Cent;
  parte_cent: Cent; retira_cent: Cent; reinvierte_cent: Cent; estado: 'propuesto' | 'firmado_por_uno' | 'cerrado'; corregida: boolean;
  firmas: { socio: string; firmado_at: string }[]; capital_contable_cent: Cent | null; valor_cent: Cent | null; huella: string | null;
}
export interface Flujo { fecha: string; monto_cent: Cent; tipo: 'aportacion' | 'retiro' | 'retiro_capital' }
export interface Cabecera {
  aportaciones_cent: Cent; reinversion_cent: Cent; invertido_cent: Cent; invertido_ambos_cent: Cent;
  retirado_utilidad_cent: Cent; retirado_capital_cent: Cent; retirado_cent: Cent; utilidad_asignada_cent: Cent; utilidad_por_distribuir_cent: Cent;
  capital_contable_cent: Cent | null; valor_cent: Cent | null; valor_bajo_cent: Cent | null; valor_alto_cent: Cent | null; por_cobrar_clientes_cent: Cent | null;
  neto_cent: Cent; reembolso_pendiente_cent: Cent; fondos_cent: Cent; efectivo_total_cent: Cent; efectivo_disponible_cent: Cent;
  primera_fecha: string | null; meses_activo: number;
}
export interface PorCliente { cliente_id: number; cliente: string; pedidos: number; piezas: Cent; utilidad_cent: Cent; parte_cent: Cent }
export interface PorModelo { modelo: string; piezas: Cent; venta_cent: Cent; costo_cent: Cent; utilidad_cent: Cent; parte_cent: Cent }
export interface HistorialSocio {
  socio: NombreSocio; otro: NombreSocio; hoy: string; hasta: string; con_historial: boolean;
  cabecera: Cabecera; flujos: Flujo[]; actas: ActaLinea[];
  totales: { utilidad_cent: Cent; parte_cent: Cent; pedidos: number; piezas: Cent; ventas_cent: Cent; provisional: boolean } | null;
  dias: FilaSerie[]; semanas: FilaSerie[]; meses: FilaSerie[]; por_cliente: PorCliente[]; por_modelo: PorModelo[];
}

export interface SelloActa {
  contenido: {
    periodo_ini: string; periodo_fin: string; utilidad_cent: Cent; decisiones: Record<string, { retira: Cent; reinvierte: Cent }>;
    valuacion_cent: Cent | null; deudas_cent: Cent | null; capital_contable_cent: Cent | null; valor_participacion_cent: Record<string, Cent> | null;
    por_socio: Record<string, { invertido_cent: Cent; retirado_cent: Cent; por_distribuir_cent: Cent; fondos_en_poder_cent: Cent; compensaciones_cent: Cent; neto_cent: Cent }>;
  };
  huella: string; sellado_at: string;
}
export interface ActaDetalle { cierre: CierreReparto; sello: SelloActa | null; corrige_folio: string | null; contra_acta_folio: string | null }
export interface PeriodoSugerido { ini: string; fin: string; hoy: string; ultimo_corte: string | null; listo: boolean; disponible_desde: string; acta_pendiente_id: number | null; hay_actividad: boolean }
