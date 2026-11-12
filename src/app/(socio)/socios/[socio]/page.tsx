import type { Metadata } from 'next';
import { AreaPesos } from '../../_a3/graficas-pesos';
import { notFound } from 'next/navigation';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';

import { BotonAccion } from '../../operacion/formulario-accion';
import { Dos, Estado, Pie, abs, m, pct, suma } from '../../_a3/util';

export const metadata: Metadata = { title: 'Estado de cuenta del socio' };

export default async function PaginaEstadoSocio({ params }: { params: Promise<{ socio: string }> }) {
  const { socio } = await params;
  if (socio !== 'Angelo' && socio !== 'Javier') notFound();
  const e = await (await operacionDeSocio()).socioCuenta(socio);
  const palabra = e.neto_cent > 0n ? 'La sociedad le debe' : e.neto_cent < 0n ? 'Debe a la sociedad' : 'En paz';
  const mov = [...e.movimientos].sort((a, b) => (a.fecha_neg === b.fecha_neg ? a.id - b.id : a.fecha_neg < b.fecha_neg ? -1 : 1));
  const puntos = mov.map((x) => ({ id: `${x.tipo}-${x.id}`, etiqueta: etiquetaFecha(x.fecha_neg), valor: Math.abs(Number(x.saldo_cent)), texto: `${m(x.saldo_cent, true)} · ${x.saldo_cent > 0n ? 'la sociedad le debe' : x.saldo_cent < 0n ? 'debe a la sociedad' : 'en paz'}`, detalle: x.concepto }));
  const flujo = [
    { id: 'ap', etiqueta: 'Aportaciones de capital', c: e.aportaciones_capital_cent },
    { id: 'ga', etiqueta: 'Gastos pagados', c: e.gastos_pagados_cent },
    { id: 're', etiqueta: 'Reembolsos recibidos', c: e.reembolsos_recibidos_cent },
    { id: 'de', etiqueta: 'Capital devuelto', c: e.devoluciones_recibidas_cent },
    { id: 'rt', etiqueta: 'Retiros y liquidaciones', c: e.retiros_cent },
    { id: 'ut', etiqueta: 'Utilidad asignada', c: e.utilidad_asignada_cent },
  ];
  const maxFlujo = flujo.reduce((a, x) => (abs(x.c) > a ? abs(x.c) : a), 0n);
  const sinMovs = e.movimientos.length === 0;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/socios', texto: 'Cuenta de socios' }}
        eyebrow="Estado de cuenta"
        titulo={`Estado de cuenta de ${socio}`}
        descripcion={`${palabra} ${m(abs(e.neto_cent))}${e.dias_fondos !== null ? ` · fondos de la sociedad en su poder desde hace ${e.dias_fondos} días` : ''}`}
      />
      {e.dias_fondos !== null && e.fondos_cent > 0n && <Aviso tono="atencion" titulo="Fondos sin entregar.">{socio} tiene {m(e.fondos_cent)} de la sociedad desde hace {e.dias_fondos} días.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores del socio"
        celdas={[
          { id: 'neto', etiqueta: 'Posición neta con la sociedad', testid: 'neto-socio', valor: <CifraComprobada texto={m(e.neto_cent, true)} cifra={`socio:neto:${socio}`} comprobacion="cuadra" />, categoria: 2, nota: <Estado tono={e.neto_cent === 0n ? 'ok' : 'atencion'}>{palabra}</Estado> },
          { id: 'ap', etiqueta: 'Aportaciones de capital', valor: m(e.aportaciones_capital_cent), categoria: 1, nota: `Por devolver ${m(e.aportacion_pendiente_cent)}` },
          { id: 'ga', etiqueta: 'Gastos pagados', valor: m(e.gastos_pagados_cent), categoria: 6, nota: `Reembolso pendiente ${m(e.reembolso_pendiente_cent)}` },
          { id: 'fo', etiqueta: 'Fondos en su poder', valor: <CifraComprobada texto={m(e.fondos_cent)} cifra={`socio:fondos:${socio}`} comprobacion="cuadra" />, categoria: 4, nota: e.dias_fondos === null ? 'Sin fondos pendientes' : `${e.dias_fondos} días sin entregar` },
          { id: 'fa', etiqueta: 'Faltantes asignados', valor: <CifraComprobada texto={m(e.faltantes_cent)} cifra={`socio:diferencia:${socio}`} comprobacion="cuadra" />, categoria: 7, nota: `Debe en total ${m(e.debe_cent)}` },
        ]}
      />
      <FilaRatios
        etiqueta="Resumen del socio"
        items={[
          { etiqueta: 'Reembolsos recibidos', valor: m(e.reembolsos_recibidos_cent) },
          { etiqueta: 'Capital devuelto', valor: m(e.devoluciones_recibidas_cent) },
          { etiqueta: 'Retiros y liquidaciones', valor: m(e.retiros_cent) },
          { etiqueta: 'Utilidad asignada', valor: m(e.utilidad_asignada_cent) },
        ]}
      />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Posición después de cada movimiento" descripcion="Magnitud de la posición neta; el signo va en el dato">
          {puntos.length >= 2 ? (
            <AreaPesos titulo={`Posición neta de ${socio}`} descripcion={`Posición neta de ${socio} tras cada uno de ${puntos.length} movimientos.`} procedencia="observado" pie="Fuente: libro de la cuenta de socios" puntos={puntos} />
          ) : <p className="a3-grafica-vacia"><strong>Pocos movimientos</strong>Con dos o más movimientos se dibuja la posición neta.</p>}
        </Tarjeta>
        <Tarjeta titulo="De dónde viene la posición" descripcion="Cada concepto, en su magnitud">
          {maxFlujo > 0n ? <BarList etiquetaAria="Conceptos de la cuenta del socio" items={flujo.map((x) => ({ id: x.id, etiqueta: x.etiqueta, texto: m(x.c), pct: pct(abs(x.c), maxFlujo) }))} /> : <p className="a3-grafica-vacia"><strong>Sin conceptos</strong>Aún no hay aportaciones, gastos ni reembolsos.</p>}
          <Pie>Cada movimiento se puede explicar y deshacer.</Pie>
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Movimientos" descripcion={`${e.movimientos.length} movimientos del socio`}>
        <DataTable
          etiqueta={`Movimientos de ${socio}`}
          densidad="libro" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar concepto', porPagina: 50, exportar: `estado-${socio}` }}
          clave={(x) => `${x.tipo}-${x.id}`}
          filas={e.movimientos}
          totales={sinMovs ? undefined : { etiqueta: `Efecto neto (${e.movimientos.length})`, celdas: { m: m(suma(e.movimientos.map((x) => x.efecto_cent)), true), s: m(e.neto_cent, true) } }}
          vacio={{ titulo: 'Sin movimientos', texto: 'Todavía no hay aportaciones, gastos ni fondos a nombre de este socio.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', ancho: 's', celda: (x) => etiquetaFecha(x.fecha_neg) },
            { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (x) => <Dos a={x.concepto} b={x.tipo === 'aportacion' ? 'Aportación o gasto pagado' : x.tipo === 'libro' ? 'Cuenta con la sociedad' : 'Dinero de la sociedad en su poder'} /> },
            { id: 'm', titulo: 'Efecto', numerica: true, ancho: 'm', celda: (x) => m(x.efecto_cent, true) },
            { id: 's', titulo: 'Posición', numerica: true, ancho: 'm', celda: (x) => m(x.saldo_cent, true) },
            { id: 'q', titulo: 'Quién', ancho: 'l', secundaria: true, celda: (x) => <Dos a={x.autor ?? x.canal} b={x.mensaje_origen ?? <span className="rtm-mono">{x.evento}</span>} /> },
            { id: 'x', titulo: '', ancho: 's', celda: (x) => (x.deshacible && x.tipo !== 'deuda' ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_socio" args={{ p_tipo: x.tipo, p_id: x.id }} motivo="Motivo" titulo="Deshacer captura" /> : null) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
