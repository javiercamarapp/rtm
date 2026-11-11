import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { BotonAccion } from '../../operacion/formulario-accion';

export const metadata: Metadata = { title: 'Estado de cuenta del socio' };

export default async function Pagina({ params }: { params: Promise<{ socio: string }> }) {
  const { socio } = await params;
  if (socio !== 'Angelo' && socio !== 'Javier') notFound();
  const e = await (await operacionDeSocio()).socioCuenta(socio);
  const palabra = e.neto_cent > 0n ? 'La sociedad le debe' : e.neto_cent < 0n ? 'Debe a la sociedad' : 'En paz';

  return (
    <>
      <p className="rtm-migaja"><Link href="/socios">Cuenta de socios</Link> / {socio}</p>
      <EncabezadoPagina
        eyebrow={`Estado de cuenta · ${etiquetaHoy()}`}
        antes="Estado de cuenta de"
        enfasis={socio}
        contexto="Aportaciones, gastos pagados, reembolsos, retiros, fondos de la sociedad en su poder y utilidad asignada. Cada movimiento se puede explicar y deshacer."
      />
      <section className="rtm-bloque rtm-entra rtm-i-1" aria-label="Posición neta">
        <p className="rtm-nota">Posición neta con la sociedad</p>
        <p className="rtm-hero-cifra" data-testid="neto-socio"><CifraComprobada texto={formatearMoneda(e.neto_cent, { conSigno: true })} cifra={`socio:neto:${socio}`} comprobacion="cuadra" /></p>
        <p><EstadoTexto tono={e.neto_cent === 0n ? 'ok' : 'atencion'}>{palabra}</EstadoTexto></p>
        {e.dias_fondos !== null && <p className="rtm-nota">El dinero de la sociedad en su poder lleva {e.dias_fondos} días.</p>}
      </section>
      <div className="rtm-kpis rtm-entra rtm-i-2">
        <div className="rtm-kpi"><span>Aportaciones de capital</span><strong>{formatearMoneda(e.aportaciones_capital_cent)}</strong></div>
        <div className="rtm-kpi"><span>Gastos pagados</span><strong>{formatearMoneda(e.gastos_pagados_cent)}</strong></div>
        <div className="rtm-kpi"><span>Reembolsos recibidos</span><strong>{formatearMoneda(e.reembolsos_recibidos_cent)}</strong></div>
        <div className="rtm-kpi"><span>Capital devuelto</span><strong>{formatearMoneda(e.devoluciones_recibidas_cent)}</strong></div>
        <div className="rtm-kpi"><span>Retiros y liquidaciones</span><strong>{formatearMoneda(e.retiros_cent)}</strong></div>
        <div className="rtm-kpi"><span>Utilidad asignada</span><strong>{formatearMoneda(e.utilidad_asignada_cent)}</strong></div>
        <div className="rtm-kpi"><span>Fondos en su poder</span><strong><CifraComprobada texto={formatearMoneda(e.fondos_cent)} cifra={`socio:fondos:${socio}`} comprobacion="cuadra" /></strong></div>
        <div className="rtm-kpi"><span>Faltantes asignados</span><strong><CifraComprobada texto={formatearMoneda(e.faltantes_cent)} cifra={`socio:diferencia:${socio}`} comprobacion="cuadra" /></strong></div>
      </div>
      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Movimientos del socio">
        <h2>Movimientos</h2>
        <DataTable
          etiqueta={`Movimientos de ${socio}`}
          clave={(m) => `${m.tipo}-${m.id}`}
          filas={e.movimientos}
          vacio={{ titulo: 'Sin movimientos', texto: 'Todavía no hay aportaciones, gastos ni fondos a nombre de este socio.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 'c', titulo: 'Concepto', celda: (m) => <>{m.concepto}<span className="rtm-celda-sub">{m.tipo === 'aportacion' ? 'Aportación o gasto pagado' : m.tipo === 'libro' ? 'Cuenta con la sociedad' : 'Dinero de la sociedad en su poder'}</span></> },
            { id: 'm', titulo: 'Efecto', numerica: true, celda: (m) => formatearMoneda(m.efecto_cent, { conSigno: true }) },
            { id: 's', titulo: 'Posición', numerica: true, secundaria: true, celda: (m) => formatearMoneda(m.saldo_cent, { conSigno: true }) },
            { id: 'q', titulo: 'Quién', secundaria: true, celda: (m) => <>{m.autor ?? m.canal}<br /><span className="rtm-nota rtm-mono">{m.evento}</span>{m.mensaje_origen && <><br /><span className="rtm-nota">{m.mensaje_origen}</span></>}</> },
            { id: 'x', titulo: '', celda: (m) => (m.deshacible && m.tipo !== 'deuda' ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_socio" args={{ p_tipo: m.tipo, p_id: m.id }} motivo="Motivo" titulo="Deshacer captura" /> : null) },
          ]}
        />
      </section>
    </>
  );
}
