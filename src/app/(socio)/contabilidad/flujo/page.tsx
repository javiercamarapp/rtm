import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { serieSemanalDeSocio } from '@/composicion/contabilidad-serie';
import { fechaNeg } from '@/dominio/calendario';
import { rangoDeConsulta } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha } from '@/dominio/formato';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { GraficaSemanas } from '../../_a3/serie';
import { Estado, Pie, abs, m, pct } from '../../_a3/util';
import { SelectorRango } from '../selector-rango';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Flujo de efectivo' };

export default async function PaginaFlujo({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const { ini, fin } = rangoDeConsulta(hoy, q.ini, q.fin);
  const [f, serie] = await Promise.all([(await contabilidadDeSocio()).flujo(ini, fin), serieSemanalDeSocio(12).catch(() => null)]);
  const dato = f.con_movimientos;
  const op = f.directo.filter((x) => x.seccion === 'operacion');
  const fi = f.directo.filter((x) => x.seccion === 'financiamiento');
  const maxMov = f.directo.reduce((a, x) => (abs(x.monto_cent) > a ? abs(x.monto_cent) : a), 0n);
  const pasos = [
    { id: 'i', etiqueta: 'Saldo inicial', valor: Number(f.saldo_inicial_cent), tipo: 'inicio' as const, texto: m(f.saldo_inicial_cent) },
    { id: 'o', etiqueta: 'Operación', valor: Number(f.flujo_operacion_cent), tipo: 'delta' as const, texto: m(f.flujo_operacion_cent, true) },
    { id: 'f', etiqueta: 'Financiamiento', valor: Number(f.flujo_financiamiento_cent), tipo: 'delta' as const, texto: m(f.flujo_financiamiento_cent, true) },
    { id: 's', etiqueta: 'Saldo final', valor: Number(f.saldo_final_cent), tipo: 'total' as const, texto: m(f.saldo_final_cent) },
  ];
  const semanas = serie?.semanas ?? [];

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · flujo de efectivo"
        titulo={`Los fondos de la sociedad cambiaron en ${dato ? m(f.variacion_cent, true) : 'sin dato'}`}
        descripcion={`Del ${etiquetaFecha(ini)} al ${etiquetaFecha(fin)}. Fondos = caja más lo que cada socio tiene en su cuenta; método directo conciliado con el indirecto.`}
        acciones={<SelectorRango base="/contabilidad/flujo" hoy={hoy} ini={ini} fin={fin} />}
      />
      {!dato ? (
        <DataTable etiqueta="Flujo de efectivo" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin dato en este periodo', texto: 'Aún no hay movimientos de dinero registrados en el periodo elegido.' }} />
      ) : (
        <>
          <KpiLinea
            etiquetaAria="Indicadores del flujo"
            celdas={[
              { id: 'i', etiqueta: 'Saldo inicial de fondos', valor: m(f.saldo_inicial_cent), categoria: 1, nota: `Al inicio del ${etiquetaFecha(ini)}` },
              { id: 'o', etiqueta: 'Flujo de operación', valor: m(f.flujo_operacion_cent, true), categoria: 2, nota: `${op.length} ${op.length === 1 ? 'concepto' : 'conceptos'}` },
              { id: 'f', etiqueta: 'Flujo de financiamiento', valor: m(f.flujo_financiamiento_cent, true), categoria: 6, nota: `${fi.length} ${fi.length === 1 ? 'concepto' : 'conceptos'}` },
              { id: 'v', etiqueta: 'Variación neta', valor: m(f.variacion_cent, true), categoria: 7, nota: <Estado tono={f.comprobacion.cuadra ? 'ok' : 'malo'}>{f.comprobacion.cuadra ? 'Cuadra por las dos vías' : 'No cuadra'}</Estado> },
              { id: 's', etiqueta: 'Saldo final de fondos', valor: m(f.saldo_final_cent), categoria: 4, nota: `Al ${etiquetaFecha(fin)}` },
            ]}
          />
          <FilaRatios
            etiqueta="Memorando"
            items={[
              { etiqueta: 'Cobros pagados directo a un proveedor', valor: m(f.cobros_directo_proveedor_cent) },
              { etiqueta: 'Utilidad neta del periodo', valor: m(f.indirecto.utilidad_neta_cent, true) },
              { etiqueta: 'Cambio en activos de operación', valor: m(f.indirecto.cambio_activos_cent, true) },
              { etiqueta: 'Cambio en pasivos de operación', valor: m(f.indirecto.cambio_pasivos_cent, true) },
            ]}
          />
          <Rejilla dividir="6-6">
            <Tarjeta titulo="Del saldo inicial al final" descripcion="Operación y financiamiento">
              <Cascada titulo="Cascada del flujo de efectivo" descripcion={`Saldo inicial ${m(f.saldo_inicial_cent)}; operación ${m(f.flujo_operacion_cent, true)}; financiamiento ${m(f.flujo_financiamiento_cent, true)}; saldo final ${m(f.saldo_final_cent)}.`} pasos={pasos} unidad="Pesos" />
            </Tarjeta>
            <Tarjeta titulo="Por concepto" descripcion="Magnitud de cada concepto de fondos">
              <BarList etiquetaAria="Conceptos de fondos" items={f.directo.map((x) => ({ id: x.categoria, etiqueta: x.categoria, texto: m(x.monto_cent, true), pct: maxMov > 0n ? pct(abs(x.monto_cent), maxMov) : null, tono: x.monto_cent < 0n ? ('malo' as const) : undefined }))} />
              <p className="a3-sub">Por actividad</p>
              <BarList etiquetaAria="Flujo por actividad" items={[
                { id: 'op', etiqueta: 'Actividades de operación', texto: m(f.flujo_operacion_cent, true), pct: maxMov > 0n ? pct(abs(f.flujo_operacion_cent), abs(f.flujo_operacion_cent) > abs(f.flujo_financiamiento_cent) ? abs(f.flujo_operacion_cent) : abs(f.flujo_financiamiento_cent)) : null, tono: f.flujo_operacion_cent < 0n ? 'malo' : undefined },
                { id: 'fi', etiqueta: 'Actividades de financiamiento', texto: m(f.flujo_financiamiento_cent, true), pct: maxMov > 0n ? pct(abs(f.flujo_financiamiento_cent), abs(f.flujo_operacion_cent) > abs(f.flujo_financiamiento_cent) ? abs(f.flujo_operacion_cent) : abs(f.flujo_financiamiento_cent)) : null, tono: f.flujo_financiamiento_cent < 0n ? 'malo' : undefined },
              ]} />
            </Tarjeta>
          </Rejilla>
          <Rejilla dividir="6-6">
            <Tarjeta plana titulo="Método directo" descripcion="Por tipo de movimiento de fondos">
              <DataTable
                etiqueta="Flujo directo por concepto"
                densidad="libro" plana primeraFija
                agrupar={{ clave: (x) => (x.seccion === 'operacion' ? 'Actividades de operación' : 'Actividades de financiamiento'), cabecera: (k, fs) => ({ titulo: k, subtotales: { m: m(fs.reduce((a, x) => a + x.monto_cent, 0n), true) } }) }}
                clave={(x) => x.categoria}
                filas={f.directo}
                totales={{ etiqueta: 'Variación neta', celdas: { m: m(f.variacion_cent, true) } }}
                vacio={{ titulo: 'Sin movimientos de fondos', texto: 'No entró ni salió dinero de la sociedad en el periodo.' }}
                columnas={[{ id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (x) => x.categoria }, { id: 'm', titulo: 'Importe', numerica: true, ancho: 'm', celda: (x) => m(x.monto_cent, true) }]}
              />
            </Tarjeta>
            <Tarjeta plana titulo="Conciliación indirecta" descripcion="De la utilidad neta a la variación de fondos">
              <DataTable
                etiqueta="Conciliación indirecta"
                densidad="libro" plana
                clave={(x) => x.n}
                filas={[
                  { n: 'Utilidad neta del periodo', v: f.indirecto.utilidad_neta_cent },
                  { n: 'Cambio en activos de operación (clientes, inventario, tránsito, faltantes)', v: f.indirecto.cambio_activos_cent },
                  { n: 'Cambio en pasivos de operación (proveedores, Omar, saldos a favor)', v: f.indirecto.cambio_pasivos_cent },
                  { n: 'Financiamiento (aportaciones, pagos de socios, retiros)', v: f.indirecto.financiamiento_cent },
                ]}
                totales={{ etiqueta: 'Variación neta de fondos', celdas: { v: m(f.indirecto.variacion_cent, true) } }}
                columnas={[{ id: 'n', titulo: 'Concepto', ancho: 'xl', celda: (x) => x.n }, { id: 'v', titulo: 'Importe', numerica: true, ancho: 'm', celda: (x) => m(x.v, true) }]}
              />
              <div className="a3-pie-tarjeta"><Pie>Directo {m(f.comprobacion.via1_cent, true)}; indirecto {m(f.comprobacion.via2_cent, true)}; saldos final menos inicial {m(f.comprobacion.saldo_cent, true)}.</Pie></div>
            </Tarjeta>
          </Rejilla>
        </>
      )}
      <Rejilla dividir="6-6">
        <Tarjeta titulo="Variación de fondos por semana" descripcion="Últimas 12 semanas; la semana en curso es parcial">
          <GraficaSemanas titulo="Variación de fondos por semana" descripcion="Variación neta de los fondos de la sociedad en las últimas semanas." semanas={semanas} valor={(s) => s.variacion_cent} pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: libro de asientos`} alto={140} />
        </Tarjeta>
        <Tarjeta titulo="Cobros de clientes por semana" descripcion="Entradas por cobranza">
          <GraficaSemanas titulo="Cobros de clientes por semana" descripcion="Cobros de clientes de cada una de las últimas semanas." semanas={semanas} valor={(s) => s.cobros_clientes_cent} pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: libro de asientos`} alto={140} />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
