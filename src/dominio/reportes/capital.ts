// Tabla de capital por socio para el reporte mensual (correo y PDF, que llegan a LOS DOS socios): por eso las etiquetas usan el nombre de cada socio
// («Fondos de la sociedad retirados por Angelo»), nunca la segunda persona de la pantalla. Cada cifra sale de rep.capital_mensual (misma fuente que api.capital_por_mes).
import { ESTADO_PROVEEDOR, NOTA_IGUALACION, etiquetaFondos, textoReinversion, textoTurno } from '../capital/etiquetas';
import type { PeriodoCapital } from '../capital/tipos';
import { formatearMoneda } from '../formato';
import type { LibroCifras } from './cifras';
import type { CapitalInsumo } from './insumos';
import { PARAMETROS } from './parametros';
import type { CeldaTabla, Tabla } from './tipos';
import { sumaBig } from './util';

const t = (v: string): CeldaTabla => ({ t: 'texto', v });
const c = (v: bigint): CeldaTabla => ({ t: 'cent', v });

const COLUMNAS = ['Socio', 'Aportaciones de capital', 'Utilidad generada', 'Reinvertida', 'Retirada', 'Valuación al cierre'];

const COLUMNAS_ACUM = ['Socio', 'Capital aportado', 'Utilidades acumuladas', 'Retirado', 'Fondos de la sociedad en su poder', 'Valuación'];

/** Acumulado con los rotulos de la Cuenta de socios (mismas definiciones de api.cuenta_socios_valuacion): valuacion = capital aportado + utilidades acumuladas - retirado - fondos.
 *  Utilidades acumuladas = valuacion del libro + retirado - capital aportado (la parte de la utilidad que ni se retiro ni se capitalizo por acta). Siempre 50 % y 50 %. */
function tablaAcumulado(p: PeriodoCapital): Tabla {
  const fila = (f: PeriodoCapital['socios'][number]) => {
    const ret = f.utilidad_retirada_cent + f.devoluciones_capital_cent;
    return [t(f.socio), c(f.capital_aportado_acum_cent), c(f.valuacion_libro_cent + ret - f.capital_aportado_acum_cent), c(ret), c(f.fondos_en_poder_cent), c(f.valuacion_cent)];
  };
  const tot = p.total;
  const ret = tot.utilidad_retirada_cent + tot.devoluciones_capital_cent;
  return {
    id: 'capitalAcum', titulo: 'Capital acumulado desde el primer movimiento', columnas: COLUMNAS_ACUM,
    filas: [...p.socios.map(fila), [t('Total de los socios'), c(tot.capital_aportado_acum_cent), c(tot.valuacion_libro_cent + ret - tot.capital_aportado_acum_cent), c(ret), c(tot.fondos_en_poder_cent), c(tot.valuacion_cent)]],
    nota: 'La valuación sube con cada utilidad y baja solo cuando un socio se paga un retiro.',
  };
}

function tablaSocios(id: string, titulo: string, p: PeriodoCapital): Tabla {
  return {
    id, titulo, columnas: COLUMNAS,
    filas: [
      ...p.socios.map((f) => [t(f.socio), c(f.aportaciones_capital_cent), c(f.utilidad_generada_cent), c(f.utilidad_reinvertida_cent), c(f.utilidad_retirada_cent), c(f.valuacion_cent)]),
      [t('Total de los socios'), c(p.total.aportaciones_capital_cent), c(p.total.utilidad_generada_cent), c(p.total.utilidad_reinvertida_cent), c(p.total.utilidad_retirada_cent), c(p.total.valuacion_cent)],
    ],
  };
}

export function capitalTablas(ins: CapitalInsumo, L: LibroCifras, base: { periodo: string }): Record<string, Tabla> {
  const m = ins.mes;
  const a = ins.acumulado;
  const o = { ...base, clase: 'Calculado' as const, n: m.socios.length };
  const sumaDetalle = (r: readonly { monto_cent: bigint }[]) => sumaBig(r.map((x) => x.monto_cent));
  L.agregar('cap.valuacion', 'Valuación de los socios', m.total.valuacion_cent, 'cent', { ...o, fuente: 'capital contable del balance menos fondos en poder', via2: m.balance.total_capital_cent - m.total.fondos_en_poder_cent });
  L.agregar('cap.utilidad', 'Utilidad generada en el mes', m.total.utilidad_generada_cent, 'cent', { ...o, fuente: 'estado de resultados', via2: m.estado_resultados.utilidad_neta_cent });
  L.agregar('cap.aportaciones', 'Aportaciones de capital del mes', m.total.aportaciones_capital_cent, 'cent', { ...o, fuente: 'mayor, cuentas 3110 y 3120', via2: sumaBig(m.socios.map((f) => sumaDetalle(f.aportaciones_detalle))) });
  L.agregar('cap.reinvertida', 'Utilidad reinvertida del mes', m.total.utilidad_reinvertida_cent, 'cent', { ...o, fuente: 'actas de corte y saldo a favor con proveedores', via2: m.total.utilidad_reinvertida_acta_cent + m.total.utilidad_reinvertida_proveedor_cent });
  L.agregar('cap.retirada', 'Utilidad retirada del mes', m.total.utilidad_retirada_cent, 'cent', { ...o, fuente: 'libro del socio', via2: sumaBig(m.socios.map((f) => sumaDetalle(f.utilidad_retirada_detalle))) });
  L.agregar('cap.fondos', 'Fondos de la sociedad en poder de los socios', m.total.fondos_en_poder_cent, 'cent', { ...o, fuente: 'mayor, cuentas 1150 y 1160', via2: sumaBig(m.socios.map((f) => sumaDetalle(f.fondos_detalle))) });
  L.agregar('cap.acumValuacion', 'Valuación acumulada', a.total.valuacion_cent, 'cent', { ...o, fuente: 'capital contable del balance menos fondos en poder', via2: a.balance.total_capital_cent - a.total.fondos_en_poder_cent });

  const rei = textoReinversion(m.reinversion_acta_angelo_cent, m.reinversion_acta_javier_cent, formatearMoneda);
  const fondos = m.socios.flatMap((f) => f.fondos_detalle.map((r) => [t(etiquetaFondos(f.socio, null)), t([r.motivo, r.cliente].filter(Boolean).join(' · ')), c(r.monto_cent)]));
  const max = PARAMETROS.maxRenglonesTabla;
  const tablas: Record<string, Tabla> = {
    capital: { ...tablaSocios('capital', 'Capital por socio del mes', m), ...(rei ? { nota: rei.texto, valoresNota: rei.igual ? [] : [m.reinversion_acta_angelo_cent, m.reinversion_acta_javier_cent] } : {}) },
    capitalAcum: tablaAcumulado(a),
    aportacionNeta: {
      id: 'aportacionNeta', titulo: 'Aportación neta y diferencia a igualar',
      columnas: ['Socio', 'Aportado', 'Fondos de la sociedad en su poder', 'Aportación neta', 'Diferencia a igualar'],
      filas: m.socios.map((f) => [t(f.socio), c(f.aportado_cent), c(f.fondos_en_poder_cent), c(f.aportacion_neta_cent), f.diferencia_a_igualar_cent === 0n ? t('Sin diferencia') : c(f.diferencia_a_igualar_cent)]),
      nota: `${textoTurno(m.turno_aportar, m.diferencia_a_igualar_cent, formatearMoneda)}. Los fondos que un socio tiene en su poder reducen su aportación neta. ${NOTA_IGUALACION}`,
      valoresNota: [m.diferencia_a_igualar_cent],
    },
    fondos: {
      id: 'fondos', titulo: 'Fondos de la sociedad en poder de socios', columnas: ['Quién', 'Motivo', 'Importe'],
      filas: fondos.slice(0, max),
      ...(fondos.length > max ? { nota: `Y ${fondos.length - max} renglones más en la pantalla Capital por socio.`, valoresNota: [fondos.length - max] } : {}),
    },
    proveedores: {
      id: 'proveedores', titulo: 'Cuenta con proveedores',
      columnas: ['Proveedor', 'Situación', 'Importe'],
      filas: m.proveedores.flatMap((p) => [
        [t(p.proveedor), t(ESTADO_PROVEEDOR[p.estado]), c(p.saldo_sin_clasificar_cent < 0n ? -p.saldo_sin_clasificar_cent : p.saldo_sin_clasificar_cent)],
        ...(p.por_clasificar_cent > 0n ? [[t(`${p.proveedor} · Por clasificar`), t('Pagado por un socio, destino sin confirmar'), c(p.por_clasificar_cent)]] : []),
      ]),
      nota: 'Lo pagado por un socio sin destino confirmado queda por clasificar: no cuenta como inventario, saldo a favor ni utilidad reinvertida.',
    },
  };
  return tablas;
}
