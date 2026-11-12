// Serie semanal de contabilidad (lectura de api.conta_serie_semanal). Dinero en centavos bigint; la web solo la dibuja.
export interface SemanaSerie {
  ini: string;
  fin: string;
  /** Semana en curso: sin variacion y con trama. */
  parcial: boolean;
  con_movimientos: boolean;
  ventas_netas_cent: bigint;
  ingresos_operativos_cent: bigint;
  costo_ventas_cent: bigint;
  utilidad_bruta_cent: bigint;
  gastos_cent: bigint;
  utilidad_neta_cent: bigint;
  piezas_vendidas: number;
  flujo_operacion_cent: bigint;
  flujo_financiamiento_cent: bigint;
  variacion_cent: bigint;
  saldo_final_cent: bigint;
  cobros_clientes_cent: bigint;
  pagos_proveedores_cent: bigint;
}
export interface SerieSemanal {
  hoy: string;
  semanas: SemanaSerie[];
}
