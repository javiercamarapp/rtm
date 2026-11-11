import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg } from '@/dominio/calendario';
import { rangoDeConsulta } from '@/dominio/contabilidad/rangos';
import { formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SelectorRango } from '../selector-rango';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Flujo de efectivo' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const { ini, fin } = rangoDeConsulta(hoy, q.ini, q.fin);
  const f = await (await contabilidadDeSocio()).flujo(ini, fin);
  const seccion = (clave: 'operacion' | 'financiamiento', titulo: string, total: bigint) => (
    <section className="rtm-seccion rtm-entra rtm-i-2" aria-label={titulo}>
      <h2>{titulo}</h2>
      <DataTable
        etiqueta={titulo}
        clave={(x) => x.categoria}
        filas={f.directo.filter((x) => x.seccion === clave)}
        vacio={{ titulo: 'Sin movimientos de fondos', texto: 'No entró ni salió dinero de la sociedad por este concepto en el periodo.' }}
        columnas={[
          { id: 'c', titulo: 'Concepto', celda: (x) => x.categoria },
          { id: 'm', titulo: 'Importe', numerica: true, celda: (x) => formatearMoneda(x.monto_cent, { conSigno: true }) },
        ]}
      />
      <p className="rtm-nota"><strong>{titulo}: {formatearMoneda(total, { conSigno: true })}</strong></p>
    </section>
  );
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · flujo de efectivo"
        antes="Los fondos de la sociedad cambiaron en"
        enfasis={f.con_movimientos ? formatearMoneda(f.variacion_cent, { conSigno: true }) : 'sin dato'}
        contexto="Fondos de la sociedad = caja más lo que cada socio tiene en su cuenta. Método directo por tipo de movimiento, conciliado con el método indirecto desde la utilidad neta."
      />
      <SelectorRango base="/contabilidad/flujo" hoy={hoy} ini={ini} fin={fin} />
      {!f.con_movimientos ? (
        <DataTable etiqueta="Flujo de efectivo" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin dato en este periodo', texto: 'Aún no hay movimientos de dinero registrados en el periodo elegido.' }} />
      ) : (
        <>
          <div className="rtm-kpis rtm-entra rtm-i-1">
            <div className="rtm-kpi"><span>Saldo inicial de fondos</span><strong>{formatearMoneda(f.saldo_inicial_cent)}</strong></div>
            <div className="rtm-kpi"><span>Variación neta</span><strong>{formatearMoneda(f.variacion_cent, { conSigno: true })}</strong></div>
            <div className="rtm-kpi"><span>Saldo final de fondos</span><strong>{formatearMoneda(f.saldo_final_cent)}</strong></div>
          </div>
          {seccion('operacion', 'Actividades de operación', f.flujo_operacion_cent)}
          {seccion('financiamiento', 'Actividades de financiamiento', f.flujo_financiamiento_cent)}
          <section className="rtm-seccion" aria-label="Conciliación indirecta">
            <h2>Conciliación indirecta</h2>
            <DataTable
              etiqueta="Conciliación indirecta"
              clave={(x) => x.n}
              filas={[
                { n: 'Utilidad neta del periodo', v: f.indirecto.utilidad_neta_cent },
                { n: 'Cambio en activos de operación (clientes, inventario, tránsito, faltantes)', v: f.indirecto.cambio_activos_cent },
                { n: 'Cambio en pasivos de operación (proveedores, Omar, saldos a favor)', v: f.indirecto.cambio_pasivos_cent },
                { n: 'Financiamiento (aportaciones, pagos de socios, retiros)', v: f.indirecto.financiamiento_cent },
                { n: 'Variación neta de fondos', v: f.indirecto.variacion_cent },
              ]}
              columnas={[{ id: 'n', titulo: 'Concepto', celda: (x) => x.n }, { id: 'v', titulo: 'Importe', numerica: true, celda: (x) => formatearMoneda(x.v, { conSigno: true }) }]}
            />
            <p className="rtm-nota">
              <EstadoTexto tono={f.comprobacion.cuadra ? 'ok' : 'malo'}>{f.comprobacion.cuadra ? 'Cuadra por las dos vías' : 'No cuadra'}</EstadoTexto>{' '}
              Directo {formatearMoneda(f.comprobacion.via1_cent, { conSigno: true })}; indirecto {formatearMoneda(f.comprobacion.via2_cent, { conSigno: true })}; saldos final menos inicial {formatearMoneda(f.comprobacion.saldo_cent, { conSigno: true })}.
              {' '}Cobros pagados directo a un proveedor, que no pasan por los fondos: {formatearMoneda(f.cobros_directo_proveedor_cent)}.
            </p>
          </section>
        </>
      )}
    </>
  );
}
