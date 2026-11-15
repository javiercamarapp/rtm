// Forma de lo que la base entrega a la pantalla de costos. Los montos en `*_cent` llegan como bigint; los `*_micro` y `*_e6` se leen como bigint con `aBig`.
export interface ServicioVista {
  id: number; slug: string; nombre: string; categoria: string; fase: 'construccion' | 'mantenimiento'; ciclo: string; dia_renovacion: number | null; moneda: 'USD' | 'MXN';
  metodo_atribucion: string; pagador_default: string; cobrable: boolean; opcional: boolean; activo: boolean; cuota_documento_orig_micro: number | null; logo_slug: string | null;
  cuota_base?: CuotaBaseVista | null;
}
export interface CuotaBaseVista { regla: 'menor' | 'mayor'; cuota_orig_micro: number; vigente_desde: string; nota: string }
export interface CargoVista {
  id: number; folio: string; servicio_slug: string; servicio: string; categoria: string; logo_slug: string | null; opcional: boolean; mes: string; fecha_neg: string; fase: string; moneda: string;
  base_orig_micro: number; pct_exacto_ppm: number; pct_aplicado_ppm: number; tc_micro: number; tc_fecha: string; tc_fuente: string; exacto_mxn_e6: number; exacto_puro_mxn_e6: number; monto_cent: bigint;
  como_seria_cent: bigint | null; como_deberia_cent: bigint | null; pagado_por: string; cobrable: boolean; etiqueta: string; estado: string; evidencia_tipo: string; tiene_evidencia: boolean; nota: string;
  reversa_de: number | null; anulado: boolean; gasto_folio: string | null; como_capital?: boolean; intencion?: string | null; aportacion_id?: number | null;
}
export interface ResumenServicio {
  slug: string; servicio: string; logo_slug: string | null; fase: string; opcional: boolean; categoria: string; redondeado_cent: bigint; exacto_e6: number; exacto_puro_e6: number; usd_micro: number; cargos: number;
  como_seria_cent: bigint | null; como_deberia_cent: bigint | null; ultima_etiqueta: string | null; ultimo_estado: string | null;
  acumulado_cent?: bigint; usd_sin_tc_micro?: number; cuota_base?: CuotaBaseVista | null;
}
export interface TotalesCostos { redondeado_cent: bigint; exacto_e6: number; exacto_puro_e6?: number }
export interface MovimientoCuenta { folio: string; fecha_neg: string; tipo: 'cargo' | 'reversa' | 'reembolso'; monto_cent: bigint; concepto: string }
export interface CuentaCostos { socio: string; aportado_capital_cent?: bigint; cargado_cent: bigint; reembolsado_cent: bigint; pendiente_cent: bigint; movimientos: MovimientoCuenta[] }
export interface ResumenMesVista {
  mes: string; servicios: ResumenServicio[]; operar: TotalesCostos; opcionales: TotalesCostos; construccion: TotalesCostos; total: TotalesCostos; al_menos: boolean;
  faltantes: { slug: string; servicio: string; motivo: string }[]; incluye_construccion: boolean; cuenta_javier: CuentaCostos; tipo_cambio: { fecha: string; tc_micro: number; fuente: string } | null;
  validacion?: ValidacionCostos; aportacion_javier?: { socio: string; total_cent: bigint; declaracion: DeclaracionCapital | null };
}
export interface DeclaracionCapital { socios: string[]; intencion: string; declarado_por: string; fecha: string }
export interface PendienteTc { slug: string; servicio: string; mes: string; usd_micro: number; fecha_neg: string; nota: string; motivo: string }
export interface ValidacionCostos {
  mes: string | null; cargos_cent: bigint; aportado_cent: bigint; mayor_cent: bigint; cargos: number; cuadra: boolean;
  por_servicio: { slug: string; servicio: string; cargos_cent: bigint; aportado_cent: bigint; cuadra: boolean }[]; pendientes_tc: PendienteTc[]; via1: string; via2: string; via3: string;
}
export interface AportacionVista {
  cargo_id: number; folio: string; fecha_neg: string; mes: string; servicio_slug: string; servicio: string; logo_slug: string | null; monto_cent: bigint; moneda: string; base_orig_micro: number;
  pct_aplicado_ppm: number; tc_micro: number; tc_fecha: string; tc_fuente: string; gasto_folio: string | null; aportacion_id: number | null; intencion: string | null; tipo: 'aportacion' | 'reversa';
}
export interface AportacionesSocio { socio: string; total_cent: bigint; aportaciones: AportacionVista[]; declaracion: DeclaracionCapital | null }
export interface ExplicacionCargo {
  cargo: CargoVista; metodo: string; atribuido_orig_micro: number;
  comprobacion: { via1: string; via1_cent: bigint; via2: string; via2_cent: bigint; cuadra: boolean };
}
export const aBig = (n: number | bigint): bigint => BigInt(n);
