import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { AmbitoHoja } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { BotonAccion } from '../../operacion/formulario-accion';
import { CopiarTexto } from '../../operacion/copiar-texto';
import { CONCEPTO_CUENTA, ORIGEN } from '../../operacion/etiquetas';
import { FormularioDicho } from './formulario-dicho';

export const metadata: Metadata = { title: 'Liquidación con el proveedor' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ p?: string; semana?: string; ambito?: string }> }) {
  const q = await searchParams;
  const proveedor = q.p === 'Karen' ? 'Karen' : 'Isaac';
  const ambito: AmbitoHoja = q.ambito === 'todo' ? 'todo' : 'sociedad';
  const semana = q.semana && /^\d{4}-\d{2}-\d{2}$/.test(q.semana) ? q.semana : null;
  const lector = await operacionDeSocio();
  const [h, cierres] = await Promise.all([lector.hojaProveedor(proveedor, semana, ambito), lector.liquidacionesProveedor(proveedor)]);
  const t = h.totales;
  const c = h.comprobaciones;
  const enlace = (extra: Record<string, string>) => `/proveedores/liquidacion?${new URLSearchParams({ p: proveedor, semana: h.semana_ini, ambito, ...extra }).toString()}`;
  const guias = h.renglones.filter((r) => r.guia_cent > 0n || r.guia_pendiente);
  const cerrada = h.cierre !== null;

  return (
    <>
      <p className="rtm-migaja"><Link href={`/proveedores?p=${proveedor}`}>Proveedores</Link> / Liquidación</p>
      <EncabezadoPagina
        eyebrow={`Liquidación con ${proveedor} · ${etiquetaHoy()}`}
        antes="Lo que falta por saldar con"
        enfasis={proveedor}
        contexto={`Semana del ${etiquetaFecha(h.semana_ini)} al ${etiquetaFecha(h.semana_fin)} (lo enviado el fin de semana entra a la siguiente). Isaac y Karen nunca se mezclan. Se liquida a partir del viernes.`}
      />
      <div className="rtm-acciones-fila">
        <div className="rtm-segmentado" role="group" aria-label="Proveedor">
          <Link href={enlace({ p: 'Isaac' })} aria-current={proveedor === 'Isaac'}>Isaac</Link>
          <Link href={enlace({ p: 'Karen' })} aria-current={proveedor === 'Karen'}>Karen</Link>
        </div>
        <div className="rtm-segmentado" role="group" aria-label="Ámbito de la hoja">
          <Link href={enlace({ ambito: 'sociedad' })} aria-current={ambito === 'sociedad'} data-testid="ambito-sociedad">Solo de la sociedad</Link>
          <Link href={enlace({ ambito: 'todo' })} aria-current={ambito === 'todo'} data-testid="ambito-todo">Todo</Link>
        </div>
        <div className="rtm-segmentado" role="group" aria-label="Semana">
          <Link href={enlace({ semana: sumarDias(h.semana_ini, -7) })}>Semana anterior</Link>
          <Link href={enlace({ semana: sumarDias(h.semana_ini, 7) })}>Semana siguiente</Link>
        </div>
      </div>

      <section className="rtm-bloque rtm-entra rtm-i-1" aria-label="Falta por saldar">
        <p className="rtm-nota">Falta por saldar = saldo anterior + costo total con guías − pagos − ajustes</p>
        <p className="rtm-hero-cifra" data-testid="falta-por-saldar"><CifraComprobada texto={formatearMoneda(t.falta_por_saldar_cent)} cifra={`proveedor:falta:${proveedor}:${h.semana_ini}:${ambito}`} comprobacion={c.cuadra ? 'cuadra' : 'no_cuadra'} /></p>
        <p data-testid="comprobacion"><EstadoTexto tono={c.cuadra ? 'ok' : 'malo'}>{c.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto></p>
        <ul className="rtm-cascada" aria-label="Comprobaciones">
          <li><span>Cada renglón = piezas × costo vigente</span><EstadoTexto tono={c.renglon_igual_detalle ? 'ok' : 'malo'}>{c.renglon_igual_detalle ? 'Cuadra' : 'No cuadra'}</EstadoTexto></li>
          <li><span>Suma de renglones = total de mercancía ({formatearMoneda(c.mercancia_independiente_cent)})</span><EstadoTexto tono={c.renglones_igual_mercancia ? 'ok' : 'malo'}>{c.renglones_igual_mercancia ? 'Cuadra' : 'No cuadra'}</EstadoTexto></li>
          <li><span>Suma de guías = envíos ({formatearMoneda(c.guias_independiente_cent)})</span><EstadoTexto tono={c.guias_igual_envios ? 'ok' : 'malo'}>{c.guias_igual_envios ? 'Cuadra' : 'No cuadra'}</EstadoTexto></li>
          <li><span>Cada abono = un depósito ({formatearMoneda(c.depositos_independiente_cent)})</span><EstadoTexto tono={c.abonos_igual_depositos ? 'ok' : 'malo'}>{c.abonos_igual_depositos ? 'Cuadra' : 'No cuadra'}</EstadoTexto></li>
        </ul>
        {h.guias_pendientes > 0 && <p className="rtm-nota">{h.guias_pendientes} guías sin costo real: la cifra es provisional hasta costearlas.</p>}
      </section>

      <div className="rtm-kpis rtm-entra rtm-i-2">
        <div className="rtm-kpi"><span>Costo de pedidos y órdenes</span><strong>{formatearMoneda(t.mercancia_cent)}</strong></div>
        <div className="rtm-kpi"><span>Guías y seguros</span><strong>{formatearMoneda(t.guias_cent + t.seguros_cent)}</strong></div>
        <div className="rtm-kpi"><span>Depósitos de clientes</span><strong>{formatearMoneda(h.pagos_por_concepto_cent['pago_cliente_redirigido'] ?? 0n)}</strong></div>
        <div className="rtm-kpi"><span>Pagos de socios y de la sociedad</span><strong>{formatearMoneda((h.pagos_por_concepto_cent['pago_socio'] ?? 0n) + (h.pagos_por_concepto_cent['pago_sociedad'] ?? 0n))}</strong></div>
        <div className="rtm-kpi"><span>Lo que dice {proveedor}</span><strong data-testid="dicho">{h.conciliacion ? formatearMoneda(h.conciliacion.dicho_cent) : <SinDato />}</strong></div>
        <div className="rtm-kpi"><span>Diferencia</span><strong data-testid="diferencia">{h.conciliacion ? formatearMoneda(h.conciliacion.diferencia_cent, { conSigno: true }) : <SinDato />}</strong></div>
      </div>

      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Nota por pedido a costo">
        <h2>1. Nota por pedido a costo</h2>
        <DataTable
          etiqueta="Renglones de la hoja"
          clave={(r) => `${r.tipo}-${r.id}`}
          filas={h.renglones}
          vacio={{ titulo: 'Sin renglones', texto: 'No hay pedidos directos ni órdenes de compra de este proveedor en la semana.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (r) => <>{r.tipo === 'oc' ? <Link className="rtm-mono" href={`/proveedores/compras/${r.id}`}>{r.folio}</Link> : <Link className="rtm-mono" href={`/pedidos/${r.id}`}>{r.folio}</Link>}<br /><span className="rtm-nota">{r.tipo === 'oc' ? 'Orden de compra' : ORIGEN[r.origen as keyof typeof ORIGEN] ?? r.origen}</span></> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (r) => etiquetaFecha(r.fecha) },
            { id: 'p', titulo: 'Piezas', numerica: true, secundaria: true, celda: (r) => formatearPiezas(r.piezas) },
            { id: 'm', titulo: 'Detalle a costo', secundaria: true, celda: (r) => r.detalle.map((x) => `${x.modelo}: ${x.piezas} × ${formatearMoneda(x.costo_unit_cent)}`).join(' · ') },
            { id: 'c', titulo: 'Costo', numerica: true, celda: (r) => formatearMoneda(r.mercancia_cent + r.seguro_cent) },
            { id: 'a', titulo: 'Alcance', secundaria: true, celda: (r) => (r.es_de_sociedad ? 'Sociedad' : 'Propio') },
            { id: 'k', titulo: 'Cuadra', secundaria: true, celda: (r) => <EstadoTexto tono={r.cuadra ? 'ok' : 'malo'}>{r.cuadra ? 'Sí' : 'No'}</EstadoTexto> },
          ]}
        />
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Cuenta de la semana">
        <h2>2. Cuenta: abonos y ajustes</h2>
        <DataTable
          etiqueta="Abonos de la semana"
          clave={(a) => a.id}
          filas={[...h.abonos, ...h.ajustes.map((x) => ({ ...x, cliente: null, pedido: null, cuenta_origen: null }))]}
          vacio={{ titulo: 'Sin abonos', texto: 'Los depósitos de clientes al proveedor, los pagos de socios y los ajustes de la semana aparecen aquí.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', celda: (a) => etiquetaFecha(a.fecha_neg) },
            { id: 'c', titulo: 'Concepto', celda: (a) => <>{CONCEPTO_CUENTA[a.concepto] ?? a.concepto}{a.deshecho ? ' (deshecho)' : ''}{a.cliente ? <><br /><span className="rtm-nota">Cliente: {a.cliente}{a.pedido ? ` · ${a.pedido}` : ''}</span></> : null}{a.nota ? <><br /><span className="rtm-nota">{a.nota}</span></> : null}</> },
            { id: 'm', titulo: 'Monto', numerica: true, celda: (a) => formatearMoneda(a.monto_cent, { conSigno: true }) },
            { id: 'q', titulo: 'Quién', secundaria: true, celda: (a) => <>{a.autor ?? a.canal}<br /><span className="rtm-nota rtm-mono">{a.evento}</span></> },
            { id: 'x', titulo: '', celda: (a) => ((a.concepto === 'ajuste' || a.concepto === 'pago_sociedad') && !a.deshecho ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_proveedor" args={{ p_movimiento: a.id }} motivo="Motivo" titulo="Deshacer movimiento" /> : null) },
          ]}
        />
        <p className="rtm-nota">Saldo anterior {formatearMoneda(t.saldo_anterior_cent)} · pagos {formatearMoneda(t.pagos_cent)} · ajustes a favor {formatearMoneda(t.ajustes_cent)}.</p>
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-5" aria-label="Costo de guías por pedido">
        <h2>3. Costo de guías por pedido</h2>
        <DataTable
          etiqueta="Guías por pedido"
          clave={(r) => `${r.tipo}-${r.id}`}
          filas={guias}
          vacio={{ titulo: 'Sin guías', texto: 'Ningún renglón de la semana tiene guía a cargo de este proveedor.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (r) => <span className="rtm-mono">{r.folio}</span> },
            { id: 'g', titulo: 'Guía', numerica: true, celda: (r) => (r.guia_pendiente ? <EstadoTexto tono="atencion">Sin costo real</EstadoTexto> : formatearMoneda(r.guia_cent)) },
          ]}
        />
      </section>

      <section className="rtm-seccion" aria-label="Conciliación">
        <h2>Conciliación contra lo que dice {proveedor}</h2>
        <p className="rtm-nota">No se toma por verdad ni la cifra del proveedor ni la nuestra: se explica renglón por renglón.</p>
        {h.conciliacion && h.conciliacion.renglones.length > 0 && (
          <DataTable
            etiqueta="Conciliación por renglón"
            clave={(r) => r.folio}
            filas={h.conciliacion.renglones}
            columnas={[
              { id: 'f', titulo: 'Folio', celda: (r) => <span className="rtm-mono">{r.folio}</span> },
              { id: 'a', titulo: 'Dice el proveedor', numerica: true, celda: (r) => (r.dice_cent === null ? <SinDato /> : formatearMoneda(r.dice_cent)) },
              { id: 'n', titulo: 'Nuestra cuenta', numerica: true, celda: (r) => (r.nuestro_cent === null ? <SinDato /> : formatearMoneda(r.nuestro_cent)) },
              { id: 'd', titulo: 'Diferencia', numerica: true, celda: (r) => formatearMoneda(r.diferencia_cent, { conSigno: true }) },
            ]}
          />
        )}
        {!cerrada && <div className="rtm-acciones-fila"><FormularioDicho proveedor={proveedor} semana={h.semana_ini} ambito={ambito} /></div>}
      </section>

      <section className="rtm-seccion" aria-label="Acciones de la liquidación">
        <h2>Cerrar la semana</h2>
        {cerrada ? (
          <p data-testid="cerrada"><EstadoTexto tono="ok">Liquidada</EstadoTexto> {h.cierre!.folio} el {etiquetaFecha(h.cierre!.fecha_cierre)}: falta por saldar {formatearMoneda(h.cierre!.falta_por_saldar_cent)}.</p>
        ) : (
          <p className="rtm-nota">{h.viernes_cerrado ? 'Ya se puede liquidar. Quedan congeladas la hoja, lo que dijo el proveedor y la diferencia.' : `Se podrá liquidar a partir del viernes ${etiquetaFecha(h.semana_fin)}.`}</p>
        )}
        <div className="rtm-acciones-fila">
          {!cerrada && <BotonAccion primario texto="Cerrar liquidación" titulo={`Cerrar liquidación de ${proveedor}`} confirmarTexto="Cerrar liquidación" accion="cerrar_liquidacion_proveedor"
            args={{ p_proveedor: proveedor, p_semana_ini: h.semana_ini, p_ambito: ambito }} desactivado={!h.viernes_cerrado || !c.cuadra} testid="cerrar-liquidacion" />}
          <CopiarTexto etiqueta="Copiar nota para el proveedor" fuente={{ tipo: 'proveedor', proveedor, semana: h.semana_ini, ambito }} />
        </div>
      </section>

      <section className="rtm-seccion" aria-label="Liquidaciones cerradas">
        <h2>Liquidaciones cerradas</h2>
        <DataTable
          etiqueta="Historial de liquidaciones"
          clave={(l) => l.id}
          filas={cierres}
          vacio={{ titulo: 'Sin liquidaciones', texto: 'Todavía no se cierra ninguna semana con este proveedor.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (l) => <span className="rtm-mono">{l.folio}</span> },
            { id: 's', titulo: 'Semana', celda: (l) => `${etiquetaFecha(l.semana_ini)} al ${etiquetaFecha(l.semana_fin)}` },
            { id: 'a', titulo: 'Alcance', secundaria: true, celda: (l) => (l.ambito === 'todo' ? 'Todo' : 'Solo de la sociedad') },
            { id: 'c', titulo: 'Costo con guías', numerica: true, secundaria: true, celda: (l) => formatearMoneda(l.mercancia_cent + l.seguros_cent + l.guias_cent) },
            { id: 'p', titulo: 'Pagos', numerica: true, secundaria: true, celda: (l) => formatearMoneda(l.pagos_cent) },
            { id: 'v', titulo: 'Falta por saldar', numerica: true, celda: (l) => formatearMoneda(l.falta_por_saldar_cent) },
            { id: 'd', titulo: 'Dijo el proveedor', numerica: true, secundaria: true, celda: (l) => (l.dicho_cent === null ? <SinDato /> : formatearMoneda(l.dicho_cent)) },
          ]}
        />
      </section>
    </>
  );
}
