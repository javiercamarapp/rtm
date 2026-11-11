import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../../contexto';
import { ESTADO_COMPRA } from '../../../operacion/etiquetas';
import { AccionesCompra, AsignarDiferencia, FormularioRecepcion, type SaborOpcion } from './acciones-compra';

export const metadata: Metadata = { title: 'Orden de compra' };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const lector = await operacionDeSocio();
  const c = await lector.compra(n);
  if (!c) notFound();
  const recibible = ['confirmada', 'enviada', 'en_trayecto', 'llego_merida'].includes(c.estado);
  const catalogo = recibible ? await lector.catalogoCompra(c.proveedor.nombre) : null;
  const sabores: Record<string, SaborOpcion[]> = {};
  for (const s of catalogo?.skus ?? []) (sabores[s.modelo] ??= []).push({ sku_id: s.sku_id, sabor: s.sabor });
  const palabra = c.saldo_proveedor_cent > 0n ? 'A favor' : c.saldo_proveedor_cent < 0n ? 'Se debe' : 'Saldo cero';

  return (
    <>
      <p className="rtm-migaja"><Link href={`/proveedores?p=${c.proveedor.nombre}`}>Proveedores</Link> / {c.folio}</p>
      <EncabezadoPagina
        eyebrow={`Orden de compra ${c.folio} · ${etiquetaHoy()}`}
        antes="Orden de compra a"
        enfasis={c.proveedor.nombre}
        contexto={`Creada el ${etiquetaFecha(c.fecha_neg)}. El dinero se aplica al confirmar; las piezas suman al inventario solo cuando un socio confirma la recepción en Mérida.`}
      />
      <div className="rtm-etiquetas" aria-label="Estado de la orden">
        <span className="rtm-etiqueta" data-testid="estado-oc"><EstadoTexto tono={ESTADO_COMPRA[c.estado].tono}>{ESTADO_COMPRA[c.estado].texto}</EstadoTexto></span>
        {c.guias.map((g) => <span key={g.id} className="rtm-etiqueta">Guía {g.paqueteria} {g.numero}</span>)}
        {c.llegada_estimada && <span className="rtm-etiqueta">Llegada estimada {etiquetaFecha(c.llegada_estimada)}</span>}
      </div>
      <AccionesCompra compra={c} />

      <div className="rtm-kpis">
        <div className="rtm-kpi"><span>Mercancía</span><strong>{formatearMoneda(c.mercancia_cent)}</strong></div>
        <div className="rtm-kpi"><span>Guía y seguro</span><strong>{formatearMoneda(c.guia_cent + c.seguro_cent)}</strong></div>
        <div className="rtm-kpi"><span>Total de la orden</span><strong>{formatearMoneda(c.total_cent)}</strong></div>
        <div className="rtm-kpi"><span>Cuenta con {c.proveedor.nombre} ({palabra})</span><strong><CifraComprobada texto={formatearMoneda(c.saldo_proveedor_cent)} cifra={`proveedor:saldo:${c.proveedor.id}`} comprobacion="cuadra" /></strong></div>
      </div>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Renglones">
        <h2>Pagadas, facturadas y recibidas</h2>
        <DataTable
          etiqueta={`Renglones de ${c.folio}`}
          clave={(l) => l.id}
          filas={c.lineas}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (l) => l.modelo },
            { id: 's', titulo: 'Sabor pedido', secundaria: true, celda: (l) => l.sabor },
            { id: 'p', titulo: 'Pagadas', numerica: true, celda: (l) => formatearPiezas(l.pagadas) },
            { id: 'f', titulo: 'Facturadas', numerica: true, celda: (l) => formatearPiezas(l.facturadas) },
            { id: 'r', titulo: 'Recibidas', numerica: true, celda: (l) => (l.recibidas === null ? <SinDato /> : formatearPiezas(l.recibidas)) },
            { id: 'c', titulo: 'Costo', numerica: true, celda: (l) => <>{formatearMoneda(l.costo_unit_cent)}{l.motivo_costo ? <><br /><span className="rtm-nota">Motivo: {l.motivo_costo}</span></> : null}</> },
            { id: 'cp', titulo: 'Costo puesto', numerica: true, secundaria: true, celda: (l) => (l.lote ? formatearMoneda(l.lote.costo_puesto_cent) : <SinDato />) },
          ]}
        />
        {c.partidas_fuera_sociedad.map((f, i) => <p key={i} className="rtm-aviso" role="status"><strong>Fuera de la sociedad</strong><span>{f.socio} pagó {formatearMoneda(f.monto_cent)}{f.piezas ? ` por ${formatearPiezas(f.piezas)} de más` : ''}. No entra al balance de la sociedad ni se mezcla con las diferencias de recepción.</span></p>)}
      </section>

      {recibible && <FormularioRecepcion compra={c} sabores={sabores} />}

      {c.recepciones.length > 0 && (
        <section className="rtm-seccion" aria-label="Recepción por sabor">
          <h2>Recepción por sabor</h2>
          <DataTable etiqueta="Recepción por sabor" clave={(r) => `${r.modelo}-${r.sabor}-${r.contado_at}`} filas={c.recepciones}
            columnas={[{ id: 'm', titulo: 'Modelo', celda: (r) => r.modelo }, { id: 's', titulo: 'Sabor', celda: (r) => r.sabor }, { id: 'p', titulo: 'Contadas', numerica: true, celda: (r) => formatearPiezas(r.piezas) }, { id: 'h', titulo: 'Contadas el', secundaria: true, celda: (r) => etiquetaFechaHora(r.contado_at) }]} />
        </section>
      )}

      {c.diferencias.length > 0 && (
        <section className="rtm-seccion" aria-label="Diferencias de recepción">
          <h2>Diferencias de recepción</h2>
          <DataTable
            etiqueta="Diferencias de recepción"
            clave={(d) => d.id}
            filas={c.diferencias}
            columnas={[
              { id: 'm', titulo: 'Modelo', celda: (d) => d.modelo },
              { id: 't', titulo: 'Tipo', celda: (d) => (d.tipo === 'faltante' ? 'Faltante' : 'Sobrante') },
              { id: 'p', titulo: 'Piezas', numerica: true, celda: (d) => formatearPiezas(d.piezas) },
              { id: 'v', titulo: 'Valor al costo promedio', numerica: true, celda: (d) => formatearMoneda(d.valor_cent) },
              { id: 'r', titulo: 'Responsable', celda: (d) => (d.tipo === 'faltante' ? <AsignarDiferencia diferenciaId={d.id} actual={d.responsable ?? 'sociedad'} /> : 'La sociedad (cuenta puente)') },
            ]}
          />
          <p className="rtm-nota">Mientras nadie sea responsable, la diferencia vive en la cuenta puente. Asignarla a un socio la vuelve una deuda de ese socio con la sociedad; al proveedor, un reclamo en su cuenta.</p>
        </section>
      )}

      <section className="rtm-seccion" aria-label="Línea de tiempo">
        <h2>Línea de tiempo</h2>
        <ul className="rtm-linea-tiempo">
          {c.linea_tiempo.map((e) => <li key={e.evento}><span className="rtm-mono">{e.evento}</span> · {etiquetaFechaHora(e.hora)} · {(e.tipo ?? '').replaceAll('_', ' ')} · {e.autor ?? e.canal}</li>)}
        </ul>
      </section>
    </>
  );
}
