// Resumen "Costo mensual total" (spec 17, seccion 0): total exacto y total redondeado SIEMPRE por separado.
// El total redondeado es la suma de los cargos ya redondeados (no el total en USD por el tipo de cambio).

import { atribuidoOrigMicro } from './cargo';
import type { CargoCosto } from './tipos';

export interface Totales {
  /** Centavos x 1e6, suma de los exactos (con el porcentaje ya techado al punto). */
  exactoE6: bigint;
  /** Centavos x 1e6, suma de los exactos con el porcentaje exacto (antes del techo al punto). */
  exactoPuroE6: bigint;
  /** Centavos, suma de los montos redondeados por cargo. */
  redondeadoCent: bigint;
  /** redondeado - exacto, en centavos x 1e6 (>= 0 cuando solo hay cargos positivos). */
  diferenciaE6: bigint;
  /** Dolares atribuidos (millonesimas), solo de cargos en USD; informativo. */
  usdMicro: bigint;
}

export interface OpcionesResumen {
  /** Suma la construccion (fase) al total. Por omision se muestra aparte. */
  incluirConstruccion?: boolean;
  /** Servicios con dato faltante: el total dice "al menos". */
  faltantes?: readonly string[];
}

export interface ResumenMes {
  mes: string;
  /** Mantenimiento no opcional: lo que cuesta operar. */
  operar: Totales;
  /** Mantenimiento opcional (Claude, Higgsfield). */
  opcionales: Totales;
  /** Fase de construccion (una vez). */
  construccion: Totales;
  /** operar + opcionales (+ construccion si el interruptor esta encendido). */
  total: Totales;
  alMenos: boolean;
  faltantes: readonly string[];
}

function cero(): Totales {
  return { exactoE6: 0n, exactoPuroE6: 0n, redondeadoCent: 0n, diferenciaE6: 0n, usdMicro: 0n };
}

function sumar(cargos: readonly CargoCosto[]): Totales {
  const t = cero();
  for (const c of cargos) {
    t.exactoE6 += c.exactoMxnE6;
    t.exactoPuroE6 += c.exactoPuroMxnE6;
    t.redondeadoCent += c.montoCent;
    if (c.moneda === 'USD') t.usdMicro += atribuidoOrigMicro(c.baseOrigMicro, c.pctAplicadoPpm);
  }
  t.diferenciaE6 = t.redondeadoCent * 1_000_000n - t.exactoE6;
  return t;
}

function unir(...partes: Totales[]): Totales {
  const t = cero();
  for (const p of partes) {
    t.exactoE6 += p.exactoE6;
    t.exactoPuroE6 += p.exactoPuroE6;
    t.redondeadoCent += p.redondeadoCent;
    t.usdMicro += p.usdMicro;
  }
  t.diferenciaE6 = t.redondeadoCent * 1_000_000n - t.exactoE6;
  return t;
}

/** Los cargos anulados por reversa se netean solos: la reversa trae montos con signo contrario. */
export function resumenDelMes(mes: string, cargos: readonly CargoCosto[], opciones: OpcionesResumen = {}): ResumenMes {
  const delMes = cargos.filter((c) => c.mes === mes);
  const operar = sumar(delMes.filter((c) => c.fase === 'mantenimiento' && !esOpcional(c)));
  const opcionales = sumar(delMes.filter((c) => c.fase === 'mantenimiento' && esOpcional(c)));
  const construccion = sumar(delMes.filter((c) => c.fase === 'construccion'));
  const total = opciones.incluirConstruccion ? unir(operar, opcionales, construccion) : unir(operar, opcionales);
  const faltantes = opciones.faltantes ?? [];
  return { mes, operar, opcionales, construccion, total, alMenos: faltantes.length > 0, faltantes };
}

/** Claude e Higgsfield son opcionales (ocultables del total de operar). */
const SERVICIOS_OPCIONALES: ReadonlySet<string> = new Set(['claude_max', 'higgsfield']);
function esOpcional(c: CargoCosto): boolean {
  return SERVICIOS_OPCIONALES.has(c.servicioSlug);
}
