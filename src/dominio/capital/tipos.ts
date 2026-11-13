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
  valuacion_inicial_cent: bigint;
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
  valuacion_cent: bigint;
  fondos_en_poder_cent: bigint;
  fondos_detalle: RenglonDetalle[];
  capital_aportado_acum_cent: bigint;
  reembolso_puesto_acum_cent: bigint;
  aportado_cent: bigint;
  aportacion_neta_cent: bigint;
  diferencia_a_igualar_cent: bigint;
  pct_valuacion_bp: number | null;
  pct_capital_bp: number | null;
  pct_aportacion_neta_bp: number | null;
}

export interface TotalCapital {
  valuacion_inicial_cent: bigint;
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
export const CAMPOS_CAPITAL = ['aportaciones', 'utilidad', 'reinvertida', 'retirada', 'valuacion', 'fondos', 'neta', 'igualar', 'participacion', 'prov', 'clasif', 'comp'] as const;
export type CampoCapital = (typeof CAMPOS_CAPITAL)[number];
