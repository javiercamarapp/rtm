// "Explicar este numero" de la tabla de capital. Se arma con lo que ya calculo la base (api.capital_por_mes): aqui solo se ordena y se nombra.
// Identificador: capital:<desde>:<hasta>:<mes|acum>:<campo>:<socio|total>   (mes = AAAA-MM; para proveedores el sujeto es Isaac o Karen; para comprobaciones, K1 a K9).
import { formatearMoneda } from '../formato';
import type { Explicacion } from '../catalogo/tipos';
import { ESTADO_PROVEEDOR, NOTA_IGUALACION, etiquetaFondos, etiquetaMesCapital } from './etiquetas';
import type { CampoCapital, CapitalPorMes, FilaCapitalSocio, NombreSocio, PeriodoCapital, RenglonDetalle } from './tipos';
import { CAMPOS_CAPITAL } from './tipos';

export interface CifraCapital { desde: string; hasta: string; mes: string; campo: CampoCapital; sujeto: string }

const RE = /^capital:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):(acum|\d{4}-\d{2}):([a-z]+):(Angelo|Javier|total|Isaac|Karen|K[1-9])$/;

export function idCifraCapital(c: CifraCapital): string {
  return `capital:${c.desde}:${c.hasta}:${c.mes}:${c.campo}:${c.sujeto}`;
}

export function leerCifraCapital(cifra: string): CifraCapital | null {
  const m = RE.exec(cifra);
  if (!m) return null;
  const campo = m[4] as CampoCapital;
  if (!(CAMPOS_CAPITAL as readonly string[]).includes(campo)) return null;
  return { desde: m[1]!, hasta: m[2]!, mes: m[3]!, campo, sujeto: m[5]! };
}

const suma = (xs: readonly bigint[]) => xs.reduce((a, x) => a + x, 0n);
const n = (c: bigint) => Number(c);
const detalle = (r: readonly RenglonDetalle[]): Explicacion['renglones'] =>
  r.map((x) => ({ concepto: [x.motivo ?? x.concepto, x.origen, x.cliente ? `cliente ${x.cliente}` : null].filter(Boolean).join(' · '), montoCent: x.monto_cent, saldoCent: null, hora: null, fechaNeg: x.fecha, evento: x.fuente, canal: null, autor: null, mensajeOrigen: null }));

function base(cifra: string, titulo: string, valor: bigint | null, fuente: string, comp: { via1: string; v1: bigint; via2: string; v2: bigint; tol?: bigint } | null, renglones: Explicacion['renglones']): Explicacion {
  return {
    cifra, titulo, unidad: 'mxn', valor: valor === null ? null : n(valor), fuente,
    comprobacion: comp ? { via1: comp.via1, via1Valor: n(comp.v1), via2: comp.via2, via2Valor: n(comp.v2), cuadra: (comp.v1 > comp.v2 ? comp.v1 - comp.v2 : comp.v2 - comp.v1) <= (comp.tol ?? 0n) } : null,
    movimientos: [], precioCent: null, costos: [], renglones,
  };
}

export function periodoDeCifra(d: CapitalPorMes, mes: string): PeriodoCapital | null {
  return mes === 'acum' ? d.acumulado : d.meses.find((x) => x.mes === mes)?.periodo ?? null;
}

/** Devuelve la explicacion de una cifra de la tabla, o null si el periodo, el socio o el campo no existen en los datos. */
export function explicarCapital(d: CapitalPorMes, cifra: string, miSocio: NombreSocio | null): Explicacion | null {
  const c = leerCifraCapital(cifra);
  if (!c) return null;
  const p = periodoDeCifra(d, c.mes);
  if (!p) return null;
  const cuando = c.mes === 'acum' ? `acumulado del ${p.ini} al ${p.fin}` : etiquetaMesCapital(c.mes);
  const fm = formatearMoneda;
  const fila = (): FilaCapitalSocio | null => p.socios.find((s) => s.socio === c.sujeto) ?? null;
  const esTotal = c.sujeto === 'total';
  const filas = esTotal ? p.socios : fila() ? [fila()!] : [];
  if (c.campo !== 'prov' && c.campo !== 'clasif' && c.campo !== 'comp' && filas.length === 0) return null;
  const quien = esTotal ? 'de los socios' : `de ${c.sujeto}`;
  const f = d.fuentes;

  switch (c.campo) {
    case 'aportaciones': {
      const v = suma(filas.map((x) => x.aportaciones_capital_cent));
      const det = filas.flatMap((x) => x.aportaciones_detalle);
      const sd = suma(det.map((x) => x.monto_cent));
      return base(cifra, `Aportaciones de capital ${quien}, ${cuando}`, v, f.aportaciones_capital ?? '', { via1: 'Cifra de la tabla', v1: v, via2: 'Suma de los asientos del Mayor', v2: sd }, detalle(det));
    }
    case 'utilidad': {
      const v = suma(filas.map((x) => x.utilidad_generada_cent));
      const er = p.estado_resultados.utilidad_neta_cent;
      return base(cifra, `Utilidad generada ${quien}, ${cuando}`, v, f.utilidad_generada ?? '',
        esTotal ? { via1: 'Suma de los dos socios', v1: v, via2: 'Utilidad neta del Estado de resultados', v2: er } : { via1: 'Su mitad (Estado de resultados)', v1: v, via2: 'Mitad del Estado de resultados', v2: c.sujeto === 'Angelo' ? p.estado_resultados.angelo_cent : p.estado_resultados.javier_cent },
        [{ concepto: `Utilidad neta del Estado de resultados ${cuando}: ${fm(er)}`, montoCent: er, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null }]);
    }
    case 'reinvertida': {
      const acta = suma(filas.map((x) => x.utilidad_reinvertida_acta_cent));
      const prov = suma(filas.map((x) => x.utilidad_reinvertida_proveedor_cent));
      const tot = suma(filas.map((x) => x.utilidad_reinvertida_cent));
      return base(cifra, `Utilidad reinvertida ${quien}, ${cuando}`, tot, `${f.utilidad_reinvertida_acta ?? ''} ${f.utilidad_reinvertida_proveedor ?? ''}`.trim(), { via1: 'Cifra de la tabla', v1: tot, via2: 'Acta + reinvertida en el proveedor', v2: acta + prov }, [
        ...detalle(filas.flatMap((x) => x.utilidad_reinvertida_acta_detalle)),
        { concepto: `Reinvertida en el proveedor (calculada, saldo a favor respaldado por utilidad): ${fm(prov)}`, montoCent: prov, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null },
        ...(p.anticipo_proveedor_cent > 0n ? [{ concepto: `Anticipo al proveedor (excede la utilidad que lo respalda, no es utilidad): ${fm(p.anticipo_proveedor_cent)}`, montoCent: p.anticipo_proveedor_cent, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null }] : []),
      ]);
    }
    case 'retirada': {
      const v = suma(filas.map((x) => x.utilidad_retirada_cent));
      const det = filas.flatMap((x) => x.utilidad_retirada_detalle);
      return base(cifra, `Utilidad retirada ${quien}, ${cuando}`, v, f.utilidad_retirada ?? '', { via1: 'Cifra de la tabla', v1: v, via2: 'Suma de los movimientos', v2: suma(det.map((x) => x.monto_cent)) }, detalle(det));
    }
    case 'fondos': {
      const v = suma(filas.map((x) => x.fondos_en_poder_cent));
      const det = filas.flatMap((x) => x.fondos_detalle);
      const etiqueta = esTotal ? 'Fondos de la sociedad en poder de los socios' : etiquetaFondos(c.sujeto as NombreSocio, miSocio);
      return base(cifra, `${etiqueta}, al ${p.fin}`, v, f.fondos_en_poder ?? '', { via1: 'Cifra de la tabla', v1: v, via2: 'Suma de los movimientos de su cuenta', v2: suma(det.map((x) => x.monto_cent)) }, detalle(det));
    }
    case 'neta': {
      const v = suma(filas.map((x) => x.aportacion_neta_cent));
      const aportado = suma(filas.map((x) => x.aportado_cent));
      const fondos = suma(filas.map((x) => x.fondos_en_poder_cent));
      return base(cifra, `Aportación neta ${quien}, al ${p.fin}`, v, f.aportacion_neta ?? '', { via1: 'Aportación neta', v1: v, via2: 'Aportado menos fondos en su poder', v2: aportado - fondos }, [
        { concepto: `Capital aportado (apertura, declarado y reinversión por acta): ${fm(suma(filas.map((x) => x.capital_aportado_acum_cent)))}`, montoCent: suma(filas.map((x) => x.capital_aportado_acum_cent)), saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null },
        { concepto: 'Dinero propio puesto como reembolso', montoCent: suma(filas.map((x) => x.reembolso_puesto_acum_cent)), saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null },
        { concepto: 'Fondos de la sociedad en su poder (reducen la aportación neta)', montoCent: -fondos, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null },
      ]);
    }
    case 'igualar': {
      const v = suma(filas.map((x) => x.diferencia_a_igualar_cent));
      const max = p.socios.reduce((a, x) => (x.aportacion_neta_cent > a ? x.aportacion_neta_cent : a), p.socios[0]?.aportacion_neta_cent ?? 0n);
      return base(cifra, `Diferencia a igualar ${quien}, al ${p.fin}`, v, f.diferencia_a_igualar ?? '', { via1: 'Mayor aportación neta menos la de él', v1: v, via2: 'Cifra de la tabla', v2: v }, [
        ...p.socios.map((x) => ({ concepto: `Aportación neta de ${x.socio}`, montoCent: x.aportacion_neta_cent, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null })),
        { concepto: 'Mayor aportación neta', montoCent: max, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null },
      ]);
    }
    case 'valuacion': {
      const v = suma(filas.map((x) => x.valuacion_cent));
      const libro = suma(filas.map((x) => x.valuacion_libro_cent));
      const ini = suma(filas.map((x) => x.valuacion_libro_inicial_cent));
      const fondos = suma(filas.map((x) => x.fondos_en_poder_cent));
      const roll = ini + suma(filas.map((x) => x.aportaciones_capital_cent + x.utilidad_generada_cent - x.utilidad_retirada_cent - x.devoluciones_capital_cent));
      const lin = (concepto: string, monto: bigint) => ({ concepto, montoCent: monto, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null });
      return base(cifra, `Valuación ${quien}, al ${p.fin}`, v, f.valuacion ?? '',
        esTotal ? { via1: 'Valuaciones personales + fondos en poder', v1: v + fondos, via2: 'Capital contable (Balance)', v2: p.balance.total_capital_cent }
                : { via1: 'Capital + utilidad antes de fondos', v1: libro, via2: 'Inicial + aportaciones + utilidad − retiros', v2: roll, tol: 1n },
        [lin('Valuación al inicio (antes de fondos)', ini), lin('Aportaciones de capital', suma(filas.map((x) => x.aportaciones_capital_cent))), lin('Su parte de la utilidad generada', suma(filas.map((x) => x.utilidad_generada_cent))),
         lin('Utilidad retirada', -suma(filas.map((x) => x.utilidad_retirada_cent))), lin('Devoluciones de capital', -suma(filas.map((x) => x.devoluciones_capital_cent))), lin('Redondeo y otros', suma(filas.map((x) => x.otros_cent))),
         lin('Fondos de la sociedad en su poder', -fondos), lin('Valuación al cierre', v),
         lin('Informativa: valuación si se igualaran las aportaciones', suma(filas.map((x) => x.valuacion_si_igualados_cent)))]);
    }
    case 'turno': {
      const dif = p.diferencia_a_igualar_cent;
      const lin = (concepto: string, monto: bigint) => ({ concepto, montoCent: monto, saldoCent: null, hora: null, fechaNeg: p.fin, evento: null, canal: null, autor: null, mensajeOrigen: null });
      const nets = p.socios.map((x) => x.aportacion_neta_cent);
      const mx = nets.reduce((a, x) => (x > a ? x : a), nets[0] ?? 0n);
      const mn = nets.reduce((a, x) => (x < a ? x : a), nets[0] ?? 0n);
      return base(cifra, p.turno_aportar === null ? 'Igualados: ambos tienen la misma aportación neta' : `Le toca aportar el siguiente pago: ${p.turno_aportar} por ${fm(dif)}`, dif, `${f.turno ?? ''} ${NOTA_IGUALACION}`.trim(),
        { via1: 'Diferencia a igualar', v1: dif, via2: 'Mayor aportación neta − menor', v2: mx - mn },
        p.socios.map((x) => lin(`Aportación neta de ${x.socio}${x.le_toca_aportar ? ' (le toca aportar)' : ''}`, x.aportacion_neta_cent)));
    }
    case 'prov':
    case 'clasif': {
      const pr = p.proveedores.find((x) => x.proveedor === c.sujeto);
      if (!pr) return null;
      const lin = (concepto: string, monto: bigint) => ({ concepto, montoCent: monto, saldoCent: null, hora: null, fechaNeg: p.fin, evento: pr.fuente, canal: null, autor: null, mensajeOrigen: null });
      if (c.campo === 'clasif') {
        return base(cifra, `${c.sujeto}: pagos de un socio por clasificar, al ${p.fin}`, pr.por_clasificar_cent, f.por_clasificar ?? '', null, [lin('Pagado por un socio, destino sin confirmar (no es inventario ni saldo a favor)', pr.por_clasificar_cent)]);
      }
      return base(cifra, `${c.sujeto}: ${ESTADO_PROVEEDOR[pr.estado].toLowerCase()}, al ${p.fin}`, pr.saldo_sin_clasificar_cent, f.proveedores ?? '', { via1: 'Saldo contable menos lo por clasificar', v1: pr.saldo_cent + pr.por_clasificar_cent, via2: 'Saldo sin clasificar', v2: pr.saldo_sin_clasificar_cent }, [
        lin('Saldo al inicio del periodo', pr.saldo_inicial_cent), lin('Compras y costos del periodo', pr.compras_cent), lin('Pagos del periodo', -pr.pagos_cent), lin('Saldo contable al cierre (Mayor)', pr.saldo_cent),
        lin('Pagado por socios, por clasificar', -pr.por_clasificar_cent), lin('Saldo sin lo por clasificar (positivo se le debe; negativo, a favor)', pr.saldo_sin_clasificar_cent),
      ]);
    }
    case 'comp': {
      const k = p.comprobaciones.find((x) => x.id === c.sujeto);
      if (!k) return null;
      return { ...base(cifra, `${k.id}: ${k.nombre}`, null, 'Identidad contable calculada por la base.', { via1: k.a_nombre, v1: k.a_cent, via2: k.b_nombre, v2: k.b_cent }, []), unidad: k.unidad === 'n' ? 'ident' : 'mxn' };
    }
  }
}
