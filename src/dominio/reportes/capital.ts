// Tabla de capital por socio para el reporte mensual (correo y PDF, que llegan a LOS DOS socios): por eso las etiquetas usan el nombre de cada socio
// («Fondos de la sociedad retirados por Angelo»), nunca la segunda persona de la pantalla. Cada cifra sale de rep.capital_mensual (misma fuente que api.capital_por_mes).
import { ESTADO_PROVEEDOR, etiquetaFondos, textoIgualar } from '../capital/etiquetas';
import type { PeriodoCapital } from '../capital/tipos';
import { formatearMoneda } from '../formato';
import type { LibroCifras } from './cifras';
import type { CapitalInsumo } from './insumos';
import { PARAMETROS } from './parametros';
import type { CeldaTabla, Tabla } from './tipos';
import { sumaBig } from './util';

const t = (v: string): CeldaTabla => ({ t: 'texto', v });
const c = (v: bigint): CeldaTabla => ({ t: 'cent', v });
const pct = (bp: number | null): CeldaTabla => (bp === null ? t('—') : { t: 'bp', v: BigInt(bp), f: 'pct1' });

const COLUMNAS = ['Socio', 'Aportaciones de capital', 'Utilidad generada', 'Reinvertida', 'Retirada', 'Valuación al cierre', '% en libros', '% de aportaciones'];

function tablaSocios(id: string, titulo: string, p: PeriodoCapital): Tabla {
  return {
    id, titulo, columnas: COLUMNAS,
    filas: [
      ...p.socios.map((f) => [t(f.socio), c(f.aportaciones_capital_cent), c(f.utilidad_generada_cent), c(f.utilidad_reinvertida_cent), c(f.utilidad_retirada_cent), c(f.valuacion_cent), pct(f.pct_valuacion_bp), pct(f.pct_capital_bp)]),
      [t('Total de los socios'), c(p.total.aportaciones_capital_cent), c(p.total.utilidad_generada_cent), c(p.total.utilidad_reinvertida_cent), c(p.total.utilidad_retirada_cent), c(p.total.valuacion_cent), t('—'), t('—')],
    ],
  };
}

export function capitalTablas(ins: CapitalInsumo, L: LibroCifras, base: { periodo: string }): Record<string, Tabla> {
  const m = ins.mes;
  const a = ins.acumulado;
  const o = { ...base, clase: 'Calculado' as const, n: m.socios.length };
  const sumaDetalle = (r: readonly { monto_cent: bigint }[]) => sumaBig(r.map((x) => x.monto_cent));
  L.agregar('cap.valuacion', 'Valuación de los socios', m.total.valuacion_cent, 'cent', { ...o, fuente: 'capital contable del balance', via2: m.balance.total_capital_cent });
  L.agregar('cap.utilidad', 'Utilidad generada en el mes', m.total.utilidad_generada_cent, 'cent', { ...o, fuente: 'estado de resultados', via2: m.estado_resultados.utilidad_neta_cent });
  L.agregar('cap.aportaciones', 'Aportaciones de capital del mes', m.total.aportaciones_capital_cent, 'cent', { ...o, fuente: 'mayor, cuentas 3110 y 3120', via2: sumaBig(m.socios.map((f) => sumaDetalle(f.aportaciones_detalle))) });
  L.agregar('cap.reinvertida', 'Utilidad reinvertida del mes', m.total.utilidad_reinvertida_cent, 'cent', { ...o, fuente: 'actas de corte y saldo a favor con proveedores', via2: m.total.utilidad_reinvertida_acta_cent + m.total.utilidad_reinvertida_proveedor_cent });
  L.agregar('cap.retirada', 'Utilidad retirada del mes', m.total.utilidad_retirada_cent, 'cent', { ...o, fuente: 'libro del socio', via2: sumaBig(m.socios.map((f) => sumaDetalle(f.utilidad_retirada_detalle))) });
  L.agregar('cap.fondos', 'Fondos de la sociedad en poder de los socios', m.total.fondos_en_poder_cent, 'cent', { ...o, fuente: 'mayor, cuentas 1150 y 1160', via2: sumaBig(m.socios.map((f) => sumaDetalle(f.fondos_detalle))) });
  L.agregar('cap.acumValuacion', 'Valuación acumulada', a.total.valuacion_cent, 'cent', { ...o, fuente: 'capital contable del balance', via2: a.balance.total_capital_cent });

  const fondos = m.socios.flatMap((f) => f.fondos_detalle.map((r) => [t(etiquetaFondos(f.socio, null)), t([r.motivo, r.cliente].filter(Boolean).join(' · ')), c(r.monto_cent)]));
  const max = PARAMETROS.maxRenglonesTabla;
  const tablas: Record<string, Tabla> = {
    capital: tablaSocios('capital', 'Capital por socio del mes', m),
    capitalAcum: tablaSocios('capitalAcum', 'Capital acumulado desde el primer movimiento', a),
    aportacionNeta: {
      id: 'aportacionNeta', titulo: 'Aportación neta y diferencia a igualar',
      columnas: ['Socio', 'Aportado', 'Fondos de la sociedad en su poder', 'Aportación neta', 'Diferencia a igualar'],
      filas: m.socios.map((f) => [t(f.socio), c(f.aportado_cent), c(f.fondos_en_poder_cent), c(f.aportacion_neta_cent), f.diferencia_a_igualar_cent === 0n ? t('Sin diferencia') : c(f.diferencia_a_igualar_cent)]),
      nota: `Los fondos que un socio tiene en su poder reducen su aportación neta; ambos seguirán aportando por partes iguales. ${m.socios.map((f) => `${f.socio}: ${textoIgualar(f.diferencia_a_igualar_cent, formatearMoneda)}`).join('; ')}.`,
      valoresNota: m.socios.map((f) => f.diferencia_a_igualar_cent),
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
