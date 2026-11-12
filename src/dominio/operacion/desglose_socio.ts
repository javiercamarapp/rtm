import type { Cent, EstadoCuentaSocio } from './tipos';

/** Una cifra del desglose de un socio, con su explicacion y su comprobacion. cent = null significa "Sin dato" (sin movimientos). */
export interface LineaDesglose {
  id: string;
  etiqueta: string;
  cent: Cent | null;
  conSigno?: boolean;
  explicacion: string;
  /** Id para "Explicar este numero" en el servidor, cuando la cifra ya tiene explicacion alla. */
  cifra?: string;
  comprobacion: 'cuadra' | 'no_cuadra' | 'sin_comprobar';
}
export interface GrupoDesglose { id: string; titulo: string; lineas: LineaDesglose[] }
export interface Desglose {
  socio: 'Angelo' | 'Javier';
  grupos: GrupoDesglose[];
  /** Diferencia entre la posicion neta y la suma de sus partes; debe ser cero. */
  residuo_cent: Cent;
  cuadra: boolean;
}

/**
 * Desglose ordenado de la cuenta de un socio. Regla de la sociedad (adenda 21): un gasto pagado por un socio es gasto de la sociedad y baja la utilidad antes de repartir;
 * la sociedad le debe ese dinero (cuenta por pagar al socio) y el reembolso solo liquida esa deuda: no vuelve a restarse de la utilidad.
 * Por eso el gasto pagado suma UNA vez a la posicion del socio y el reembolso la resta UNA vez; la utilidad asignada ya viene neta de gastos.
 */
export function desglosarSocio(e: EstadoCuentaSocio): Desglose {
  const sinMovimientos = e.movimientos.length === 0;
  const v = (c: Cent): Cent | null => (c === 0n && sinMovimientos ? null : c);
  // Posicion neta = lo que puso (capital + gastos) - lo que ya recibio (reembolsos, devoluciones, retiros) + utilidad asignada - lo que debe a la sociedad.
  const partes = e.aportaciones_capital_cent + e.gastos_pagados_cent - e.reembolsos_recibidos_cent - e.devoluciones_recibidas_cent - e.retiros_cent + e.utilidad_asignada_cent - e.debe_cent;
  const residuo = e.neto_cent - partes;
  const cuadra = residuo === 0n;
  const cmp = cuadra ? 'cuadra' : 'no_cuadra';
  return {
    socio: e.socio,
    residuo_cent: residuo,
    cuadra,
    grupos: [
      {
        id: 'puso', titulo: 'Lo que puso',
        lineas: [
          { id: 'capital', etiqueta: 'Aportaciones de capital', cent: v(e.aportaciones_capital_cent), explicacion: 'Dinero que el socio puso como capital de la sociedad. La sociedad se lo devuelve con efectivo, antes de repartir utilidad.', comprobacion: 'sin_comprobar' },
          { id: 'gastos', etiqueta: 'Gastos pagados por el socio', cent: v(e.gastos_pagados_cent), explicacion: 'Gastos de la sociedad pagados de su cuenta personal. Bajan la utilidad antes de repartir y la sociedad se los debe al socio (cuenta por pagar al socio, no deuda del otro socio).', comprobacion: 'sin_comprobar' },
        ],
      },
      {
        id: 'recibio', titulo: 'Lo que ya recibió',
        lineas: [
          { id: 'reembolsos', etiqueta: 'Reembolsos recibidos', cent: v(e.reembolsos_recibidos_cent), explicacion: 'Efectivo de la sociedad que liquidó gastos pagados por el socio. Solo liquida esa deuda: no es otro gasto ni se resta otra vez de la utilidad.', comprobacion: 'sin_comprobar' },
          { id: 'devoluciones', etiqueta: 'Capital devuelto', cent: v(e.devoluciones_recibidas_cent), explicacion: 'Aportaciones de capital que la sociedad ya le regresó.', comprobacion: 'sin_comprobar' },
          { id: 'retiros', etiqueta: 'Retiros y liquidaciones', cent: v(e.retiros_cent), explicacion: 'Utilidad pagada, retiros y liquidaciones recibidas del otro socio.', comprobacion: 'sin_comprobar' },
        ],
      },
      {
        id: 'pendiente', titulo: 'Lo que la sociedad le debe',
        lineas: [
          { id: 'reembolso_pendiente', etiqueta: 'Pendiente de reembolso', cent: v(e.reembolso_pendiente_cent), explicacion: 'Gastos pagados por el socio menos reembolsos recibidos. Se paga primero con el efectivo de la sociedad.', comprobacion: 'sin_comprobar' },
          { id: 'capital_pendiente', etiqueta: 'Capital por devolver', cent: v(e.aportacion_pendiente_cent), explicacion: 'Capital aportado menos capital devuelto. Se devuelve después de los reembolsos y antes de repartir.', comprobacion: 'sin_comprobar' },
        ],
      },
      {
        id: 'utilidad', titulo: 'Utilidad que le corresponde',
        lineas: [
          { id: 'utilidad', etiqueta: 'Utilidad asignada (50 %)', cent: v(e.utilidad_asignada_cent), conSigno: true, explicacion: 'La mitad de la utilidad neta, ya descontados todos los gastos (incluidos los que pagaron los socios), según la cascada de reparto. El redondeo de un centavo va a favor de Javier.', comprobacion: 'sin_comprobar' },
        ],
      },
      {
        id: 'entre_socios', titulo: 'Con la sociedad y entre socios',
        lineas: [
          { id: 'fondos', etiqueta: 'Fondos de la sociedad en su poder', cent: v(e.fondos_cent), explicacion: 'Dinero de la sociedad que el socio tiene y aún no entrega.', cifra: `socio:fondos:${e.socio}`, comprobacion: 'cuadra' },
          { id: 'faltantes', etiqueta: 'Faltantes y diferencias asignados', cent: v(e.faltantes_cent), explicacion: 'Faltantes que se asignaron al socio y que debe a la sociedad.', cifra: `socio:diferencia:${e.socio}`, comprobacion: 'cuadra' },
          { id: 'debe', etiqueta: 'Total que debe a la sociedad', cent: v(e.debe_cent), explicacion: 'Fondos en su poder más faltantes y otras deudas con la sociedad.', cifra: `socio:deuda:${e.socio}`, comprobacion: 'cuadra' },
        ],
      },
      {
        id: 'neto', titulo: 'Saldo neto',
        lineas: [
          { id: 'neto', etiqueta: 'Posición neta con la sociedad', cent: e.neto_cent, conSigno: true, explicacion: 'Capital + gastos pagados − reembolsos − capital devuelto − retiros + utilidad asignada − lo que debe. Positivo: la sociedad le debe. Negativo: él debe.', cifra: `socio:neto:${e.socio}`, comprobacion: cmp },
        ],
      },
    ],
  };
}

/**
 * Identidad de la sociedad: la suma de las posiciones netas de los socios es lo que la sociedad les debe, y debe igualar sus activos netos
 * (efectivo + fondos en poder de socios - lo que ya esta comprometido fuera de los socios). Devuelve la diferencia; cero = cuadra.
 */
export function diferenciaIdentidadSocios(estados: readonly EstadoCuentaSocio[], activosNetosCent: Cent): Cent {
  return estados.reduce((s, e) => s + e.neto_cent, 0n) - activosNetosCent;
}
