// Datos ILUSTRATIVOS para las pruebas de la vista de Omar (ninguna cifra real).
import type { LiquidacionOmar, MovimientoCuenta, PaqueteOmar, PiezaDisponible } from '@/dominio/omar/tipos';

export const DISPONIBLE: PiezaDisponible[] = [
  { modelo: 'Elux Legend 3.5K', sabor: 'Sandía', piezas: 12 },
  { modelo: 'Elux Legend 3.5K', sabor: 'Uva', piezas: 4 },
  { modelo: 'Waka Blast 50K', sabor: 'Mango', piezas: 30 },
];

// hoy = miercoles 2026-11-11; semana 2026-11-09 a 2026-11-15
export const CUENTA: MovimientoCuenta[] = [
  { concepto: 'renta', fecha: '2026-11-03', referencia: 'P-0100', modelo: 'Waka Blast 50K', piezas: 10, tarifa: 200n, importe: 2000n },
  { concepto: 'renta', fecha: '2026-11-09', referencia: 'P-0101', modelo: 'Elux Legend 3.5K', piezas: 20, tarifa: 200n, importe: 4000n },
  { concepto: 'renta', fecha: '2026-11-10', referencia: 'P-0102', modelo: 'Waka Blast 50K', piezas: 5, tarifa: 200n, importe: 1000n },
  { concepto: 'renta', fecha: '2026-11-10', referencia: 'P-0103', modelo: 'Waka Blast 50K', piezas: -5, tarifa: 200n, importe: -1000n },
  { concepto: 'toma', fecha: '2026-11-10', referencia: 'T-0001', modelo: 'Elux Legend 3.5K', piezas: 3, tarifa: 15000n, importe: -45000n },
  { concepto: 'pago', fecha: '2026-11-10', referencia: 'PO-0001', modelo: null, piezas: null, tarifa: null, importe: 3000n },
];

export const LIQUIDACIONES: LiquidacionOmar[] = [
  { folio: 'L-0001', semana_ini: '2026-11-02', semana_fin: '2026-11-08', renta_cent: 2000n, tomas_cent: 0n, compensado_cent: 0n, neto_cent: 2000n, pagado_cent: 0n, fecha_cierre: '2026-11-09' },
];

export const PAQUETES: PaqueteOmar[] = [
  { consecutivo: 1, tipo: 'salida', estado: 'por_empacar', horas: 5, llegada_estimada: null, renglones: [{ modelo: 'Waka Blast 50K', sabor: 'Mango', piezas: 8 }] },
  { consecutivo: 2, tipo: 'salida', estado: 'empacado', horas: 20, llegada_estimada: null, renglones: [{ modelo: 'Elux Legend 3.5K', sabor: 'Uva', piezas: 2 }] },
  { consecutivo: 3, tipo: 'entrada', estado: 'en_trayecto', horas: null, llegada_estimada: '2026-11-14', renglones: [{ modelo: 'Waka Blast 50K', sabor: 'Mango', piezas: 100 }] },
];
