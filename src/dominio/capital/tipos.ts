// Tipos de api.capital_por_mes (migracion 20261113500000). Todo dinero en centavos bigint; la base ya calculo cada cifra, aqui solo se nombran.
// Los porcentajes vienen en puntos base (10000 = 100 %) o null cuando no hay base para calcularlos (sin dato, nunca un cero inventado).

export type NombreSocio = 'Angelo' | 'Javier';

export interface RenglonDetalle {
  fecha: string;
  concepto: string;
  origen?: string;
  motivo?: string;
  cliente?: string | null;
  monto_cent: bigint;
  fuente: string;
}

export interface FilaCapitalSocio {
  socio: NombreSocio;
  valuacion_libro_inicial_cent: bigint;
  aportaciones_capital_cent: bigint;
  aportaciones_detalle: RenglonDetalle[];
  utilidad_generada_cent: bigint;
  utilidad_reinvertida_acta_cent: bigint;
  utilidad_reinvertida_acta_detalle: RenglonDetalle[];
  utilidad_reinvertida_proveedor_cent: bigint;
  utilidad_reinvertida_cent: bigint;
  utilidad_retirada_cent: bigint;
  utilidad_retirada_detalle: RenglonDetalle[];
  devoluciones_capital_cent: bigint;
  utilidad_retenida_cent: bigint;
  otros_cent: bigint;
  /** Valuacion personal: capital aportado + su 50 % de la utilidad - fondos de la sociedad en su poder. */
  valuacion_cent: bigint;
  /** La misma antes de restar los fondos en su poder (alimenta K1 y K7). */
  valuacion_libro_cent: bigint;
  /** Informativa: su valuacion si pusiera lo que le falta para igualar las aportaciones. */
  valuacion_si_igualados_cent: bigint;
  /** Siempre 5000 (50 %): aportar mas no da mas participacion. */
  participacion_bp: number;
  le_toca_aportar: boolean;
  fondos_en_poder_cent: bigint;
  fondos_detalle: RenglonDetalle[];
  capital_aportado_acum_cent: bigint;
  reembolso_puesto_acum_cent: bigint;
  aportado_cent: bigint;
  aportacion_neta_cent: bigint;
  diferencia_a_igualar_cent: bigint;
}

export interface TotalCapital {
  valuacion_libro_inicial_cent: bigint;
  aportaciones_capital_cent: bigint;
  utilidad_generada_cent: bigint;
  utilidad_reinvertida_acta_cent: bigint;
  utilidad_reinvertida_proveedor_cent: bigint;
  utilidad_reinvertida_cent: bigint;
  utilidad_retirada_cent: bigint;
  devoluciones_capital_cent: bigint;
  utilidad_retenida_cent: bigint;
  otros_cent: bigint;
  valuacion_cent: bigint;
  valuacion_libro_cent: bigint;
  valuacion_si_igualados_cent: bigint;
  fondos_en_poder_cent: bigint;
  capital_aportado_acum_cent: bigint;
  aportado_cent: bigint;
  aportacion_neta_cent: bigint;
}

export interface ProveedorCapital {
  proveedor: string;
  cuenta: string;
  saldo_cent: bigint;
  saldo_inicial_cent: bigint;
  compras_cent: bigint;
  pagos_cent: bigint;
  por_clasificar_cent: bigint;
  saldo_sin_clasificar_cent: bigint;
  estado: 'se_debe' | 'a_favor' | 'sin_saldo';
  fuente: string;
}

export interface ComprobacionCapital {
  id: string;
  nombre: string;
  a_nombre: string;
  a_cent: bigint;
  b_nombre: string;
  b_cent: bigint;
  unidad?: 'n';
  ok: boolean;
}

export interface PeriodoCapital {
  ini: string;
  fin: string;
  parcial: boolean;
  hay_movimientos: boolean;
  socios: FilaCapitalSocio[];
  /** Socio al que le toca aportar el siguiente pago (el de menor aportacion neta); null = igualados. */
  turno_aportar: NombreSocio | null;
  diferencia_a_igualar_cent: bigint;
  igualados: boolean;
  capital_contable_neto_cent: bigint;
  reinversion_igual: boolean;
  reinversion_acta_angelo_cent: bigint;
  reinversion_acta_javier_cent: bigint;
  nota_igualacion: string;
  total: TotalCapital;
  proveedores: ProveedorCapital[];
  anticipo_proveedor_cent: bigint;
  saldo_a_favor_reconocido_cent: bigint;
  por_clasificar_cent: bigint;
  saldo_a_favor_proveedores_cent?: bigint;
  balance: { total_activo_cent: bigint; total_pasivo_cent: bigint; total_capital_cent: bigint; cuadra: boolean };
  estado_resultados: { utilidad_neta_cent: bigint; angelo_cent: bigint; javier_cent: bigint; con_movimientos: boolean };
  comprobaciones: ComprobacionCapital[];
}

export interface CapitalPorMes {
  desde: string;
  hasta: string;
  meses: { mes: string; periodo: PeriodoCapital }[];
  acumulado: PeriodoCapital;
  fuentes: Record<string, string>;
}

/** Campos que una cifra del reporte puede explicar (identificador en `capital:<desde>:<hasta>:<mes|acum>:<campo>:<socio|total>`). */
export const CAMPOS_CAPITAL = ['aportaciones', 'utilidad', 'reinvertida', 'retirada', 'valuacion', 'fondos', 'neta', 'igualar', 'turno', 'prov', 'clasif', 'comp'] as const;
export type CampoCapital = (typeof CAMPOS_CAPITAL)[number];
