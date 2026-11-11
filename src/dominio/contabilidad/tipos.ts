// Tipos de lectura de la seccion Contabilidad (lo que la web recibe de las funciones api.conta_*). Dinero en centavos bigint; la web no calcula dinero.

export interface LineaAsiento {
  n: number;
  cuenta: string;
  nombre: string;
  debe_cent: bigint;
  haber_cent: bigint;
  nota: string | null;
  cliente: string | null;
  proveedor: string | null;
  socio: string | null;
}

export interface AsientoDiario {
  id: number;
  folio: string;
  fecha_neg: string;
  fecha_contable: string;
  descripcion: string;
  origen_tipo: string;
  evento: string;
  evento_id: number;
  canal: string;
  autor: string | null;
  mensaje_origen: string | null;
  periodo_afectado: string | null;
  reversa_de: string | null;
  reversado_por: string | null;
  es_manual: boolean;
  hash: string;
  total_cent: bigint;
  lineas: LineaAsiento[];
}

export interface Diario {
  total: number;
  limite: number;
  ini: string | null;
  fin: string | null;
  asientos: AsientoDiario[];
}

export interface VerificacionAsiento {
  asiento: string;
  hash: string;
  cuadra: { nombre: string; debe_cent: bigint; haber_cent: bigint; ok: boolean };
  determinismo: { nombre: string; ok: boolean };
  cadena: { nombre: string; ok: boolean; cadena_integra: boolean };
  saldos: { nombre: string; ok: boolean; detalle: { clave: string; ok: boolean }[] };
}

export interface CuentaConSaldo {
  codigo: string;
  nombre: string;
  tipo: 'A' | 'P' | 'K' | 'I' | 'C' | 'G';
  naturaleza: 'D' | 'A';
  debe_cent: bigint;
  haber_cent: bigint;
  saldo_cent: bigint;
  activa: boolean;
}

export interface ListaCuentas {
  hasta: string;
  cuentas: CuentaConSaldo[];
}

export interface MovimientoMayor {
  asiento_id: number;
  folio: string;
  fecha_neg: string;
  fecha_contable: string;
  hora: string;
  descripcion: string;
  evento: string;
  canal: string;
  autor: string | null;
  mensaje_origen: string | null;
  nota: string | null;
  debe_cent: bigint;
  haber_cent: bigint;
  saldo_cent: bigint;
}

export interface Mayor {
  cuenta: { codigo: string; nombre: string; tipo: string; naturaleza: 'D' | 'A'; nota: string | null };
  ini: string | null;
  fin: string;
  saldo_inicial_cent: bigint;
  saldo_final_cent: bigint;
  movimientos: MovimientoMayor[];
}

export interface RenglonEstado {
  codigo: string;
  nombre: string;
  tipo: string;
  monto_cent: bigint;
}

export interface EstadoResultados {
  ini: string;
  fin: string;
  con_movimientos: boolean;
  lineas: RenglonEstado[];
  ventas_brutas_cent: bigint;
  devoluciones_cent: bigint;
  descuentos_cent: bigint;
  ventas_netas_cent: bigint;
  envio_cent: bigint;
  ingresos_operativos_cent: bigint;
  costo_ventas_cent: bigint;
  utilidad_bruta_cent: bigint;
  gastos_variables_cent: bigint;
  utilidad_contribucion_cent: bigint;
  gastos_fijos_cent: bigint;
  otros_cent: bigint;
  utilidad_neta_cent: bigint;
  angelo_cent: bigint;
  javier_cent: bigint;
  piezas_vendidas: number;
  ajustes_periodos_anteriores_cent: bigint;
  comprobacion: { via1_cent: bigint; via2_cent: bigint; cuadra: boolean };
}

export interface RenglonBalance {
  codigo: string;
  nombre: string;
  monto_cent: bigint;
}

export interface Balance {
  hasta: string;
  con_movimientos: boolean;
  activo: RenglonBalance[];
  pasivo: RenglonBalance[];
  capital: RenglonBalance[];
  total_activo_cent: bigint;
  total_pasivo_cent: bigint;
  total_capital_cent: bigint;
  diferencia_cent: bigint;
  cuadra: boolean;
  fuera_de_libros: { socio: string; concepto: string; estado: string; monto_cent: bigint }[];
}

export interface Flujo {
  ini: string;
  fin: string;
  con_movimientos: boolean;
  saldo_inicial_cent: bigint;
  saldo_final_cent: bigint;
  directo: { categoria: string; seccion: 'operacion' | 'financiamiento'; monto_cent: bigint }[];
  flujo_operacion_cent: bigint;
  flujo_financiamiento_cent: bigint;
  variacion_cent: bigint;
  cobros_directo_proveedor_cent: bigint;
  indirecto: { utilidad_neta_cent: bigint; cambio_activos_cent: bigint; cambio_pasivos_cent: bigint; operacion_cent: bigint; financiamiento_cent: bigint; variacion_cent: bigint };
  comprobacion: { via1_cent: bigint; via2_cent: bigint; saldo_cent: bigint; cuadra: boolean };
}

export interface Identidad {
  nombre: string;
  via1_cent: bigint;
  via2_cent: bigint;
  cuadra: boolean;
}

export interface Valuacion {
  hasta: string;
  con_movimientos: boolean;
  v01_valuacion_cent: bigint;
  v02_deudas_cent: bigint;
  v03_diferencia_cent: bigint;
  v04_utilidad_empresa_cent: bigint;
  v05_utilidades_retenidas_cent: bigint;
  v06_capital_aportado_cent: bigint;
  inventario_cent: bigint;
  clientes_cent: bigint;
  omar_cent: bigint;
  l01_liquidez_cent: bigint | null;
  l02_liquidez_total_cent: bigint | null;
  l03_pago_semana_cent: bigint | null;
  l04_despues_de_pago_cent: bigint | null;
  l04c_conservadora_cent: bigint | null;
  identidades: { i1: Identidad; i2: Identidad };
}

export interface Comprobacion {
  codigo: string;
  nombre: string;
  bloqueante: boolean;
  via_a_nombre: string;
  via_a_cent: bigint;
  via_b_nombre: string;
  via_b_cent: bigint;
  ok: boolean;
  unidad: 'mxn' | 'pz' | 'n';
}

export interface Comprobaciones {
  hoy: string;
  cadena_hash_cabecera: string | null;
  comprobaciones: Comprobacion[];
  auxiliares: { clave: string; descripcion: string; mayor_cent: bigint; operativo_cent: bigint; ok: boolean }[];
}

export interface PeriodoContable {
  id: number;
  tipo: 'semana' | 'mes';
  ini: string;
  fin: string;
  estado: 'abierto' | 'preparado' | 'aprobado' | 'publicado';
  preparado_at: string | null;
  aprobado_at: string | null;
  publicado_at: string | null;
  hash_cabecera: string | null;
  asientos: number;
  afectados: number;
}

export interface Periodos {
  hoy: string;
  periodos: PeriodoContable[];
}
