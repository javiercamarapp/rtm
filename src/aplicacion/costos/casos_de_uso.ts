// Casos de uso de costos del sistema. Hablan con puertos; no conocen la base ni la red.

import { ErrorCostos } from '@/dominio/costos/errores';
import { lineasDeEvento } from '@/dominio/costos/eventos';
import { calcularCargo, calcularReversa, identificar, type ComandoCargo } from '@/dominio/costos/registro';
import { type ResumenMes, resumenDelMes } from '@/dominio/costos/resumen';
import { saldoPorPagar, type SaldoPorPagar, validarReembolso } from '@/dominio/costos/cuenta';
import type { TipoCambioFechado } from '@/dominio/costos/cargo';
import type { CargoCosto, ReembolsoCosto, SocioId } from '@/dominio/costos/tipos';
import type { EventoRegistrado, PuertoIds, PuertoRepositorioCostos, PuertoTipoCambio } from './puertos';

export interface Dependencias {
  repo: PuertoRepositorioCostos;
  tipoCambio: PuertoTipoCambio;
  ids: PuertoIds;
}

export interface ResultadoCargo {
  cargo: CargoCosto;
  evento: EventoRegistrado | null;
  /** true si la clave de idempotencia (o la evidencia) ya existia: no se creo nada. */
  duplicado: boolean;
}

function mismoContenido(a: CargoCosto, cmd: ComandoCargo): boolean {
  return a.servicioSlug === cmd.servicioSlug && a.mes === cmd.mes && a.baseOrigMicro === cmd.baseOrigMicro && a.pagadoPor === cmd.pagadoPor;
}

export interface ComandoCargoConTc extends ComandoCargo {
  /** Tipo de cambio del recibo (gana sobre Banxico). */
  tcManual?: TipoCambioFechado;
}

export async function registrarCargo(d: Dependencias, cmd: ComandoCargoConTc): Promise<ResultadoCargo> {
  const previo = await d.repo.cargoPorClave(cmd.claveIdem);
  if (previo) {
    if (!mismoContenido(previo, cmd)) throw new ErrorCostos('clave_idem_reutilizada', 'La clave de idempotencia ya se uso con otro contenido.');
    return { cargo: previo, evento: null, duplicado: true };
  }
  if (cmd.evidenciaSha256) {
    const porEvidencia = await d.repo.cargoPorEvidencia(cmd.servicioSlug, cmd.mes, cmd.evidenciaSha256);
    if (porEvidencia) return { cargo: porEvidencia, evento: null, duplicado: true };
  }
  const tc = cmd.moneda === 'MXN' ? null : (cmd.tcManual ?? (await d.tipoCambio.delDia(cmd.fechaNeg).catch(() => null)));
  const base = calcularCargo(cmd, tc); // valida antes de consumir el folio: sin huecos
  const armado = identificar(base, d.ids.nuevoId(), await d.repo.siguienteFolio('K'));
  const evento = await d.repo.insertarCargo(armado.cargo, { tipo: 'costo_cargo_registrado', refId: armado.cargo.id, lineas: armado.lineas });
  return { cargo: armado.cargo, evento, duplicado: false };
}

export interface ComandoAnular {
  cargoId: string;
  claveIdem: string;
  fechaNeg: string;
  nota: string;
}

/** Anular = insertar una reversa. El cargo original no se toca. */
export async function anularCargo(d: Dependencias, cmd: ComandoAnular): Promise<ResultadoCargo> {
  const previa = await d.repo.cargoPorClave(cmd.claveIdem);
  if (previa) {
    if (previa.reversaDe !== cmd.cargoId) throw new ErrorCostos('clave_idem_reutilizada', 'La clave de idempotencia ya se uso con otro contenido.');
    return { cargo: previa, evento: null, duplicado: true };
  }
  const original = await d.repo.cargoPorId(cmd.cargoId);
  if (!original) throw new ErrorCostos('cargo_no_encontrado', 'El cargo no existe.');
  if (await d.repo.reversaDe(original.id)) throw new ErrorCostos('cargo_ya_anulado', 'El cargo ya fue anulado.');
  const base = calcularReversa(original, cmd.claveIdem, cmd.fechaNeg, cmd.nota);
  const armado = identificar(base, d.ids.nuevoId(), await d.repo.siguienteFolio('K'));
  const evento = await d.repo.insertarCargo(armado.cargo, { tipo: 'costo_cargo_registrado', refId: armado.cargo.id, lineas: armado.lineas });
  return { cargo: armado.cargo, evento, duplicado: false };
}

export interface ComandoReembolso {
  claveIdem: string;
  aSocio: SocioId;
  fondosDe: SocioId;
  montoCent: bigint;
  fechaNeg: string;
  medio: string;
  comprobanteSha256: string | null;
}

export interface ResultadoReembolso {
  reembolso: ReembolsoCosto;
  evento: EventoRegistrado | null;
  duplicado: boolean;
  saldo: SaldoPorPagar;
}

/** Reembolso de la sociedad al socio: movimiento aparte, idempotente por clave; jamas edita un cargo. */
export async function registrarReembolso(d: Dependencias, cmd: ComandoReembolso): Promise<ResultadoReembolso> {
  const [cargos, reembolsos] = await Promise.all([d.repo.listarCargos(), d.repo.listarReembolsos()]);
  const previo = await d.repo.reembolsoPorClave(cmd.claveIdem);
  if (previo) {
    if (previo.montoCent !== cmd.montoCent || previo.aSocio !== cmd.aSocio) throw new ErrorCostos('clave_idem_reutilizada', 'La clave de idempotencia ya se uso con otro contenido.');
    return { reembolso: previo, evento: null, duplicado: true, saldo: saldoPorPagar(cmd.aSocio, cargos, reembolsos) };
  }
  const antes = saldoPorPagar(cmd.aSocio, cargos, reembolsos);
  validarReembolso(cmd.montoCent, antes.pendienteCent);
  const folio = await d.repo.siguienteFolio('R');
  const reembolso: ReembolsoCosto = Object.freeze({
    id: d.ids.nuevoId(),
    folio,
    aSocio: cmd.aSocio,
    fondosDe: cmd.fondosDe,
    montoCent: cmd.montoCent,
    fechaNeg: cmd.fechaNeg,
    medio: cmd.medio,
    comprobanteSha256: cmd.comprobanteSha256,
    claveIdem: cmd.claveIdem,
  });
  const lineas = lineasDeEvento({ tipo: 'reembolso_costos', montoCent: cmd.montoCent, aSocio: cmd.aSocio, fondosDe: cmd.fondosDe });
  const evento = await d.repo.insertarReembolso(reembolso, { tipo: 'reembolso_costos', refId: reembolso.id, lineas });
  return { reembolso, evento, duplicado: false, saldo: saldoPorPagar(cmd.aSocio, cargos, [...reembolsos, reembolso]) };
}

export interface EstadoCostos {
  resumen: ResumenMes;
  saldoJavier: SaldoPorPagar;
}

export async function estadoDeCostos(d: Dependencias, mes: string, opciones: { incluirConstruccion?: boolean; faltantes?: readonly string[] } = {}): Promise<EstadoCostos> {
  const [cargos, reembolsos] = await Promise.all([d.repo.listarCargos(), d.repo.listarReembolsos()]);
  return { resumen: resumenDelMes(mes, cargos, opciones), saldoJavier: saldoPorPagar('javier', cargos, reembolsos) };
}
