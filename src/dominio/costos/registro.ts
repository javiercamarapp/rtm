// Armado de cargos y reversas a partir de un comando ya validado. Puro: ids, folios y reloj entran como parametros.

import { sumarDias } from '../calendario';
import { participacionPorConsumo, reglaDelMayor } from './atribucion';
import { calcularMonto, PPM_CIEN, TC_UNO, type Moneda, type TipoCambioFechado } from './cargo';
import { ErrorCostos } from './errores';
import { lineasDeEvento, type LineaAsiento } from './eventos';
import type { CargoCosto, CategoriaCosto, EstadoCargo, EtiquetaCosto, FaseCosto, SocioId, TipoEvidencia } from './tipos';

export type Atribucion =
  | { tipo: 'directa' }
  | { tipo: 'tasa'; ppm: bigint }
  | { tipo: 'participacion'; consumoRtm: bigint; consumoTotal: bigint }
  | { tipo: 'mayor'; cuotaDocumentoOrigMicro: bigint; consumoRtm: bigint; consumoTotal: bigint };

export interface ComandoCargo {
  claveIdem: string;
  servicioSlug: string;
  categoria: CategoriaCosto;
  mes: string;
  fechaNeg: string;
  fase: FaseCosto;
  baseOrigMicro: bigint;
  moneda: Moneda;
  atribucion: Atribucion;
  pagadoPor: SocioId;
  cobrable: boolean;
  etiqueta: EtiquetaCosto;
  evidenciaTipo: TipoEvidencia;
  evidenciaSha256: string | null;
  nota: string;
  /** Si es true, exige evidencia (un cargo confirmado sin evidencia se rechaza). */
  confirmar?: boolean;
}

/** Dias de tolerancia de Banxico antes de marcar el cargo como provisional (spec 17, 3.6). */
export const DIAS_TC_VIGENTE = 4;

export function tipoCambioDeCargo(moneda: Moneda, fechaNeg: string, tc: TipoCambioFechado | null): TipoCambioFechado {
  if (moneda === 'MXN') return { tcMicro: TC_UNO, fecha: fechaNeg, fuente: 'manual' };
  if (!tc) throw new ErrorCostos('sin_dato', 'Sin tipo de cambio: no se inventa uno; el cargo queda como dato faltante.');
  return tc;
}

export type CargoSinIdentidad = Omit<CargoCosto, 'id' | 'folio'>;

export interface CargoArmado {
  cargo: CargoCosto;
  lineas: LineaAsiento[];
}

/** Pone id y folio (se consumen solo cuando el cargo ya es valido, para que los folios no tengan huecos). */
export function identificar(base: CargoSinIdentidad, id: string, folio: string): CargoArmado {
  const cargo: CargoCosto = Object.freeze({ ...base, id, folio });
  return { cargo, lineas: lineasDeCargo(cargo) };
}

/** Valida y calcula el cargo completo, sin id ni folio. */
export function calcularCargo(cmd: ComandoCargo, tc: TipoCambioFechado | null): CargoSinIdentidad {
  if (!cmd.claveIdem) throw new ErrorCostos('monto_invalido', 'Falta la clave de idempotencia.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cmd.mes)) throw new ErrorCostos('monto_invalido', 'Mes invalido (AAAA-MM).');
  if (cmd.confirmar && !cmd.evidenciaSha256) throw new ErrorCostos('evidencia_requerida', 'Un cargo confirmado exige evidencia.');
  const t = tipoCambioDeCargo(cmd.moneda, cmd.fechaNeg, tc);

  let base = cmd.baseOrigMicro;
  let pctExacto = PPM_CIEN;
  let pctAplicado = PPM_CIEN;
  let comoSeria: bigint | null = null;
  let comoDeberia: bigint | null = null;
  const a = cmd.atribucion;
  switch (a.tipo) {
    case 'directa':
      break;
    case 'tasa':
      pctExacto = a.ppm;
      pctAplicado = a.ppm;
      break;
    case 'participacion': {
      const p = participacionPorConsumo(a.consumoRtm, a.consumoTotal);
      pctExacto = p.exactoPpm;
      pctAplicado = p.aplicadoPpm;
      break;
    }
    case 'mayor': {
      const p = participacionPorConsumo(a.consumoRtm, a.consumoTotal);
      const r = reglaDelMayor({ facturaOrigMicro: cmd.baseOrigMicro, cuotaDocumentoOrigMicro: a.cuotaDocumentoOrigMicro, participacionAplicadaPpm: p.aplicadoPpm, tcMicro: t.tcMicro });
      comoSeria = r.comoSeria.montoCent;
      comoDeberia = r.comoDeberia.montoCent;
      if (r.base === 'cuota_documento') {
        base = a.cuotaDocumentoOrigMicro;
      } else {
        pctExacto = p.exactoPpm;
        pctAplicado = p.aplicadoPpm;
      }
      break;
    }
  }

  const m = calcularMonto({ baseOrigMicro: base, moneda: cmd.moneda, pctAplicadoPpm: pctAplicado, tcMicro: t.tcMicro });
  const puro = pctExacto === pctAplicado ? m : calcularMonto({ baseOrigMicro: base, moneda: cmd.moneda, pctAplicadoPpm: pctExacto, tcMicro: t.tcMicro });
  const tcVencido = cmd.moneda === 'USD' && sumarDias(t.fecha, DIAS_TC_VIGENTE) < cmd.fechaNeg;
  const estado: EstadoCargo = cmd.evidenciaSha256 && !tcVencido ? 'confirmado' : 'provisional';

  return {
    servicioSlug: cmd.servicioSlug,
    categoria: cmd.categoria,
    mes: cmd.mes,
    fechaNeg: cmd.fechaNeg,
    fase: cmd.fase,
    baseOrigMicro: base,
    moneda: cmd.moneda,
    pctExactoPpm: pctExacto,
    pctAplicadoPpm: pctAplicado,
    tcMicro: t.tcMicro,
    tcFecha: t.fecha,
    tcFuente: t.fuente,
    exactoMxnE6: m.exactoMxnE6,
    exactoPuroMxnE6: puro.exactoMxnE6,
    montoCent: m.montoCent,
    comoSeriaCent: comoSeria,
    comoDeberiaCent: comoDeberia,
    pagadoPor: cmd.pagadoPor,
    cobrable: cmd.cobrable,
    etiqueta: cmd.etiqueta,
    estado,
    evidenciaTipo: cmd.evidenciaTipo,
    evidenciaSha256: cmd.evidenciaSha256,
    nota: cmd.nota,
    reversaDe: null,
    claveIdem: cmd.claveIdem,
  };
}

export function lineasDeCargo(c: CargoCosto): LineaAsiento[] {
  if (!c.cobrable) return [];
  return lineasDeEvento({ tipo: 'costo_cargo_registrado', categoria: c.categoria, montoCent: c.montoCent, pagadoPor: c.pagadoPor });
}

/** Reversa: copia exacta de los montos guardados con signo contrario (no recalcula) y lados invertidos. */
export function calcularReversa(original: CargoCosto, claveIdem: string, fechaNeg: string, nota: string): CargoSinIdentidad {
  if (original.reversaDe !== null) throw new ErrorCostos('cargo_ya_anulado', 'Una reversa no se anula.');
  const { id, folio: _folio, ...resto } = original;
  return {
    ...resto,
    fechaNeg,
    baseOrigMicro: -original.baseOrigMicro,
    exactoMxnE6: -original.exactoMxnE6,
    exactoPuroMxnE6: -original.exactoPuroMxnE6,
    montoCent: -original.montoCent,
    comoSeriaCent: original.comoSeriaCent === null ? null : -original.comoSeriaCent,
    comoDeberiaCent: original.comoDeberiaCent === null ? null : -original.comoDeberiaCent,
    estado: 'anulado',
    nota,
    reversaDe: id,
    claveIdem,
  };
}
