// Fixture SINTETICO de capital por mes (misma estructura que el escenario de pgTAP a5_001; cifras ilustrativas, sin personas ni datos reales).
import type { CapitalPorMes, FilaCapitalSocio, PeriodoCapital, ProveedorCapital, RenglonDetalle } from '@/dominio/capital/tipos';

const r = (fecha: string, concepto: string, monto: bigint, extra: Partial<RenglonDetalle> = {}): RenglonDetalle => ({ fecha, concepto, monto_cent: monto, fuente: 'Mayor, cuenta de prueba', ...extra });

function fila(o: Partial<FilaCapitalSocio> & { socio: 'Angelo' | 'Javier' }): FilaCapitalSocio {
  return {
    valuacion_inicial_cent: 0n, aportaciones_capital_cent: 0n, aportaciones_detalle: [], utilidad_generada_cent: 0n, utilidad_reinvertida_acta_cent: 0n, utilidad_reinvertida_acta_detalle: [],
    utilidad_reinvertida_proveedor_cent: 0n, utilidad_reinvertida_cent: 0n, utilidad_retirada_cent: 0n, utilidad_retirada_detalle: [], devoluciones_capital_cent: 0n, utilidad_retenida_cent: 0n,
    otros_cent: 0n, valuacion_cent: 0n, fondos_en_poder_cent: 0n, fondos_detalle: [], capital_aportado_acum_cent: 0n, reembolso_puesto_acum_cent: 0n, aportado_cent: 0n, aportacion_neta_cent: 0n,
    diferencia_a_igualar_cent: 0n, pct_valuacion_bp: null, pct_capital_bp: null, pct_aportacion_neta_bp: null, ...o,
  };
}

const prov = (o: Partial<ProveedorCapital> & { proveedor: string }): ProveedorCapital => ({ cuenta: '2110', saldo_cent: 0n, saldo_inicial_cent: 0n, compras_cent: 0n, pagos_cent: 0n, por_clasificar_cent: 0n, saldo_sin_clasificar_cent: 0n, estado: 'sin_saldo', fuente: 'Mayor, cuenta de prueba', ...o });

/** Octubre: capital desigual (118,161.91 y 105,715.00), 62,161.91 de un socio a Isaac por clasificar. */
export function periodoOctubre(): PeriodoCapital {
  const a = fila({ socio: 'Angelo', aportaciones_capital_cent: 11816191n, aportaciones_detalle: [r('2026-10-15', 'Capital inicial', 11816191n, { origen: 'Caja: Caja de la empresa' })], valuacion_cent: 11816191n, capital_aportado_acum_cent: 11816191n, aportado_cent: 11816191n, aportacion_neta_cent: 11816191n, diferencia_a_igualar_cent: 4971500n, pct_valuacion_bp: 5278, pct_capital_bp: 5278, pct_aportacion_neta_bp: 4131 });
  const j = fila({ socio: 'Javier', aportaciones_capital_cent: 10571500n, aportaciones_detalle: [r('2026-10-19', 'Capital inicial', 10571500n, { origen: 'Caja: Caja de la empresa' })], valuacion_cent: 10571500n, capital_aportado_acum_cent: 10571500n, reembolso_puesto_acum_cent: 6216191n, aportado_cent: 16787691n, aportacion_neta_cent: 16787691n, pct_valuacion_bp: 4722, pct_capital_bp: 4722, pct_aportacion_neta_bp: 5869 });
  return {
    ini: '2026-10-01', fin: '2026-10-31', parcial: false, hay_movimientos: true, socios: [a, j],
    total: { valuacion_inicial_cent: 0n, aportaciones_capital_cent: 22387691n, utilidad_generada_cent: 0n, utilidad_reinvertida_acta_cent: 0n, utilidad_reinvertida_proveedor_cent: 0n, utilidad_reinvertida_cent: 0n, utilidad_retirada_cent: 0n, devoluciones_capital_cent: 0n, utilidad_retenida_cent: 0n, otros_cent: 0n, valuacion_cent: 22387691n, fondos_en_poder_cent: 0n, capital_aportado_acum_cent: 22387691n, aportado_cent: 28603882n, aportacion_neta_cent: 28603882n },
    proveedores: [prov({ proveedor: 'Isaac', saldo_cent: -6216191n, pagos_cent: 6216191n, por_clasificar_cent: 6216191n }), prov({ proveedor: 'Karen', cuenta: '2120' })],
    anticipo_proveedor_cent: 0n, saldo_a_favor_reconocido_cent: 0n, por_clasificar_cent: 6216191n,
    balance: { total_activo_cent: 22387691n, total_pasivo_cent: 0n, total_capital_cent: 22387691n, cuadra: true },
    estado_resultados: { utilidad_neta_cent: 0n, angelo_cent: 0n, javier_cent: 0n, con_movimientos: false }, comprobaciones: [],
  };
}

/** Noviembre: utilidad 53,660.73 50/50, reinversion parcial, un retiro, fondos en poder de Javier (35,475.00), Karen se le debe e Isaac con saldo a favor. */
export function periodoNoviembre(): PeriodoCapital {
  const a = fila({ socio: 'Angelo', valuacion_inicial_cent: 11816191n, utilidad_generada_cent: 2683037n, utilidad_reinvertida_acta_cent: 500000n, utilidad_reinvertida_acta_detalle: [r('2026-11-11', 'CR-0001', 500000n, { origen: 'Acta de corte' })], utilidad_reinvertida_proveedor_cent: 250000n, utilidad_reinvertida_cent: 750000n, utilidad_retirada_cent: 300000n, utilidad_retirada_detalle: [r('2026-11-12', 'Retiro de utilidad', 300000n, { origen: 'Libro del socio' })], utilidad_retenida_cent: 2383037n, otros_cent: -1n, valuacion_cent: 14199227n, capital_aportado_acum_cent: 12316191n, aportado_cent: 12316191n, aportacion_neta_cent: 12316191n, diferencia_a_igualar_cent: 1124000n, pct_valuacion_bp: 5172, pct_capital_bp: 5335, pct_aportacion_neta_bp: 4782 });
  const j = fila({ socio: 'Javier', valuacion_inicial_cent: 10571500n, utilidad_generada_cent: 2683036n, utilidad_reinvertida_acta_cent: 200000n, utilidad_reinvertida_acta_detalle: [r('2026-11-11', 'CR-0001', 200000n, { origen: 'Acta de corte' })], utilidad_reinvertida_proveedor_cent: 250000n, utilidad_reinvertida_cent: 450000n, utilidad_retenida_cent: 2683036n, otros_cent: 1n, valuacion_cent: 13254537n, fondos_en_poder_cent: 3547500n, fondos_detalle: [r('2026-11-12', 'fondos en poder', 3547500n, { motivo: 'Pago PG-0001 en la cuenta de Javier', cliente: 'Cliente Demo' })], capital_aportado_acum_cent: 10771500n, reembolso_puesto_acum_cent: 6216191n, aportado_cent: 16987691n, aportacion_neta_cent: 13440191n, pct_valuacion_bp: 4828, pct_capital_bp: 4665, pct_aportacion_neta_bp: 5218 });
  return {
    ini: '2026-11-01', fin: '2026-11-30', parcial: false, hay_movimientos: true, socios: [a, j],
    total: { valuacion_inicial_cent: 22387691n, aportaciones_capital_cent: 0n, utilidad_generada_cent: 5366073n, utilidad_reinvertida_acta_cent: 700000n, utilidad_reinvertida_proveedor_cent: 500000n, utilidad_reinvertida_cent: 1200000n, utilidad_retirada_cent: 300000n, devoluciones_capital_cent: 0n, utilidad_retenida_cent: 5066073n, otros_cent: 0n, valuacion_cent: 27453764n, fondos_en_poder_cent: 3547500n, capital_aportado_acum_cent: 23087691n, aportado_cent: 29303882n, aportacion_neta_cent: 25756382n },
    proveedores: [prov({ proveedor: 'Isaac', saldo_cent: -6716191n, saldo_inicial_cent: -6216191n, compras_cent: 4000000n, pagos_cent: 4500000n, por_clasificar_cent: 6216191n, saldo_sin_clasificar_cent: -500000n, estado: 'a_favor' }),
                  prov({ proveedor: 'Karen', cuenta: '2120', saldo_cent: 1200000n, compras_cent: 1200000n, saldo_sin_clasificar_cent: 1200000n, estado: 'se_debe' })],
    anticipo_proveedor_cent: 0n, saldo_a_favor_reconocido_cent: 500000n, por_clasificar_cent: 6216191n,
    balance: { total_activo_cent: 27453764n + 1200000n, total_pasivo_cent: 1200000n, total_capital_cent: 27453764n, cuadra: true },
    estado_resultados: { utilidad_neta_cent: 5366073n, angelo_cent: 2683037n, javier_cent: 2683036n, con_movimientos: true },
    comprobaciones: [{ id: 'K1', nombre: 'La suma de las valuaciones personales es el capital contable del Balance', a_nombre: 'Suma de valuaciones personales', a_cent: 27453764n, b_nombre: 'Capital contable (Balance)', b_cent: 27453764n, ok: true }],
  };
}

export function capitalFixture(): CapitalPorMes {
  const oct = periodoOctubre();
  const nov = periodoNoviembre();
  return { desde: '2026-10-01', hasta: '2026-11-30', meses: [{ mes: '2026-10', periodo: oct }, { mes: '2026-11', periodo: nov }], acumulado: { ...nov, ini: '2026-10-01', total: { ...nov.total, valuacion_inicial_cent: 0n, aportaciones_capital_cent: 22387691n } }, fuentes: { aportaciones_capital: 'Mayor, cuentas 3110 y 3120.', utilidad_generada: 'Estado de resultados del periodo.', fondos_en_poder: 'Mayor, cuentas 1150 y 1160.' } };
}
