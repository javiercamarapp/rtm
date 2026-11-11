// Presupuesto de IA: US$1 al dia y US$30 al mes, alerta al 80 %. Se RESERVA el peor caso antes de cada llamada y se LIQUIDA con el costo real.
// Micro-USD como bigint. "Comprometido" = gastado + reservado. El estado es un valor puro: el almacen lo persiste en transaccion.

export const TOPE_DIA_MICRO = 1_000_000n;
export const TOPE_MES_MICRO = 30_000_000n;
export const ALERTA_PORCENTAJE = 80n;

export type RolPresupuesto = 'texto' | 'vision' | 'audio' | 'redaccion' | 'resumen';

/**
 * Reparto del dia. La politica 19 elimino el escalamiento (R6, US$0.15): esa parte pasa al rol de texto.
 * El rol "resumen" (8 pm) tiene su reserva propia, que ningun otro rol puede gastar.
 */
export const REPARTO_DIA_MICRO: Readonly<Record<RolPresupuesto, bigint>> = {
  texto: 550_000n,
  vision: 250_000n,
  audio: 50_000n,
  redaccion: 100_000n,
  resumen: 50_000n,
};

export interface EstadoPresupuesto {
  fechaDia: string;
  mes: string;
  diaMicro: bigint;
  mesMicro: bigint;
  porRolDiaMicro: Readonly<Record<RolPresupuesto, bigint>>;
  alertaDiaEnviada: boolean;
  alertaMesEnviada: boolean;
}

const CEROS: Record<RolPresupuesto, bigint> = { texto: 0n, vision: 0n, audio: 0n, redaccion: 0n, resumen: 0n };

export function estadoInicial(fechaNeg: string): EstadoPresupuesto {
  return {
    fechaDia: fechaNeg,
    mes: fechaNeg.slice(0, 7),
    diaMicro: 0n,
    mesMicro: 0n,
    porRolDiaMicro: { ...CEROS },
    alertaDiaEnviada: false,
    alertaMesEnviada: false,
  };
}

/** Cambio de dia o de mes (fecha de negocio de Merida): reinicia lo que corresponda. */
export function rotar(estado: EstadoPresupuesto, fechaNeg: string): EstadoPresupuesto {
  const mes = fechaNeg.slice(0, 7);
  let e = estado;
  if (e.mes !== mes) e = { ...e, mes, mesMicro: 0n, alertaMesEnviada: false };
  if (e.fechaDia !== fechaNeg) e = { ...e, fechaDia: fechaNeg, diaMicro: 0n, porRolDiaMicro: { ...CEROS }, alertaDiaEnviada: false };
  return e;
}

export type MotivoCorte = 'tope_diario' | 'tope_mensual' | 'tope_rol' | 'monto_invalido';
export type AvisoPresupuesto = 'alerta_dia' | 'alerta_mes' | null;

export type DecisionReserva =
  | { ok: true; estado: EstadoPresupuesto; avisos: AvisoPresupuesto[] }
  | { ok: false; motivo: MotivoCorte };

function umbral(tope: bigint): bigint {
  return (tope * ALERTA_PORCENTAJE) / 100n;
}

function conAvisos(e: EstadoPresupuesto): { estado: EstadoPresupuesto; avisos: AvisoPresupuesto[] } {
  const avisos: AvisoPresupuesto[] = [];
  let estado = e;
  if (!estado.alertaDiaEnviada && estado.diaMicro >= umbral(TOPE_DIA_MICRO)) {
    estado = { ...estado, alertaDiaEnviada: true };
    avisos.push('alerta_dia');
  }
  if (!estado.alertaMesEnviada && estado.mesMicro >= umbral(TOPE_MES_MICRO)) {
    estado = { ...estado, alertaMesEnviada: true };
    avisos.push('alerta_mes');
  }
  return { estado, avisos };
}

/**
 * Decide si cabe una reserva. Corta al tope: nunca se compromete mas de US$1 al dia ni US$30 al mes.
 * El tope diario de los demas roles deja libre la reserva del resumen de las 8 pm.
 */
export function evaluarReserva(actual: EstadoPresupuesto, rol: RolPresupuesto, montoMicro: bigint, fechaNeg: string): DecisionReserva {
  if (montoMicro <= 0n) return { ok: false, motivo: 'monto_invalido' };
  const estado = rotar(actual, fechaNeg);
  const topeDia = rol === 'resumen' ? TOPE_DIA_MICRO : TOPE_DIA_MICRO - REPARTO_DIA_MICRO.resumen;
  const diaSinResumen = estado.diaMicro - estado.porRolDiaMicro.resumen;
  const base = rol === 'resumen' ? estado.diaMicro : diaSinResumen;
  if (base + montoMicro > topeDia) return { ok: false, motivo: 'tope_diario' };
  if (estado.mesMicro + montoMicro > TOPE_MES_MICRO) return { ok: false, motivo: 'tope_mensual' };
  if (estado.porRolDiaMicro[rol] + montoMicro > REPARTO_DIA_MICRO[rol]) return { ok: false, motivo: 'tope_rol' };
  const siguiente: EstadoPresupuesto = {
    ...estado,
    diaMicro: estado.diaMicro + montoMicro,
    mesMicro: estado.mesMicro + montoMicro,
    porRolDiaMicro: { ...estado.porRolDiaMicro, [rol]: estado.porRolDiaMicro[rol] + montoMicro },
  };
  const { estado: conAlerta, avisos } = conAvisos(siguiente);
  return { ok: true, estado: conAlerta, avisos };
}

/** Sustituye la reserva por el costo real que devolvio el proveedor (puede ser menor; nunca deja el comprometido negativo). */
export function aplicarLiquidacion(actual: EstadoPresupuesto, rol: RolPresupuesto, reservadoMicro: bigint, realMicro: bigint): { estado: EstadoPresupuesto; avisos: AvisoPresupuesto[] } {
  const delta = realMicro - reservadoMicro;
  const nz = (x: bigint) => (x < 0n ? 0n : x);
  const siguiente: EstadoPresupuesto = {
    ...actual,
    diaMicro: nz(actual.diaMicro + delta),
    mesMicro: nz(actual.mesMicro + delta),
    porRolDiaMicro: { ...actual.porRolDiaMicro, [rol]: nz(actual.porRolDiaMicro[rol] + delta) },
  };
  return conAvisos(siguiente);
}

/** Devuelve una reserva completa (la llamada fallo antes de gastar). */
export function aplicarLiberacion(actual: EstadoPresupuesto, rol: RolPresupuesto, reservadoMicro: bigint): EstadoPresupuesto {
  return aplicarLiquidacion(actual, rol, reservadoMicro, 0n).estado;
}
