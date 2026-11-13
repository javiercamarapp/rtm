import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { ChipEstado } from '@/ui/componentes/controles';
import { ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { ESTADO_PEDIDO, ORIGEN } from '../../../operacion/etiquetas';
import { BloqueDestinatario, CapturarDestinatario } from '../../bloque-destinatario';
import { ORIGEN_SURTIDO, PestanasDs, TIPO_VENTA } from '../../comun';
import { PanelOrden } from '../../panel-orden';
import { PasosPedido, RegistrarFolio } from './acciones-ficha';

export const metadata: Metadata = { title: 'Pedido de dropshipping' };
const TONO = { borrador: 'apagado', confirmado: 'atencion', enviado: 'ok', cancelado: 'apagado', anulado: 'malo' } as const;

export default async function FichaDs({ params }: { params: Promise<{ id: string }> }) {
  const n = Number((await params).id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const ds = await dropshippingDeSocio();
  const f = await ds.ficha(n);
  if (!f) notFound();
  const esDs = f.es_dropshipping;
  const proveedor = f.proveedor ?? 'Karen';
  const [dest, orden, util] = esDs ? await Promise.all([ds.destinatario(n), ds.orden(n, false), ds.utilidad(null, null)]) : [null, null, null];
  const u = util?.filas.find((x) => x.pedido_id === n) ?? null;
  const credito = f.tasa_semanal_bp !== null || f.interes_cent !== null;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/dropshipping/pedidos', texto: 'Volver a pedidos de dropshipping' }}
        eyebrow={`Pedido ${f.folio}`}
        titulo={`${f.cliente} · ${f.folio}`}
        descripcion={`${ORIGEN_SURTIDO[f.origen_surtido]} · ${ORIGEN[f.origen]} · creado el ${etiquetaFecha(f.fecha_neg)}${f.fecha_envio ? ` · enviado el ${etiquetaFecha(f.fecha_envio)}` : ''}`}
        acciones={<Link className="rtm-boton" href={`/pedidos/${f.pedido_id}`}>Nota y hoja interna</Link>}
      />
      <PestanasDs activa="pedidos" />
      <div className="rtm-a1-etiquetas" aria-label="Estado del pedido">
        <span className="rtm-etiqueta" data-testid="ds-estado"><ChipEstado tono={TONO[f.estado]}>{ESTADO_PEDIDO[f.estado].texto}</ChipEstado></span>
        {f.tipo_venta && <span className="rtm-etiqueta">{TIPO_VENTA[f.tipo_venta]}{f.socio_venta ? ` · ${f.socio_venta}` : ''}</span>}
        {f.folio_externo && <span className="rtm-etiqueta" data-testid="ds-folio-ext-etiqueta">Folio de {proveedor}: <span className="rtm-mono">{f.folio_externo}</span></span>}
        {f.es_estimado && <span className="rtm-etiqueta">Cifras estimadas hasta que se envíe</span>}
      </div>
      <KpiLinea
        etiquetaAria="Cifras del pedido"
        celdas={[
          { id: 'piezas', etiqueta: 'Piezas', valor: formatearPiezas(f.real ? f.piezas_surtidas : f.piezas_pedidas), categoria: 1, nota: f.real ? `de ${f.piezas_pedidas} pedidas` : 'pedidas' },
          { id: 'venta', etiqueta: f.real ? 'Venta' : 'Venta estimada', valor: f.real ? <CifraComprobada texto={formatearMoneda(f.venta_cent)} cifra={`pedido:total:${f.pedido_id}`} comprobacion="cuadra" /> : formatearMoneda(f.venta_cent), categoria: 2 },
          { id: 'costo', etiqueta: f.real ? 'Costo total' : 'Costo estimado', valor: formatearMoneda(f.costo_total_cent), categoria: 4, nota: f.guia_cent ? `Incluye envío del proveedor ${formatearMoneda(f.guia_cent)}` : 'Producto y costos directos' },
          { id: 'utilidad', etiqueta: 'Utilidad', valor: formatearMoneda(f.margen_cent), categoria: 3, nota: f.utilidad_provisional ? 'Provisional: falta el costo de la guía' : `Margen del producto ${formatearMoneda(f.margen_producto_cent)}` },
          { id: 'pagar', etiqueta: `Por pagar a ${proveedor}`, valor: esDs ? formatearMoneda(f.por_pagar_cent) : null, categoria: 6, nota: esDs ? `Amortizado ${formatearMoneda(f.amortizado_cent)}` : 'No aplica: sale de Mérida' },
          { id: 'cobrar', etiqueta: 'Por cobrar al cliente', valor: f.saldo_cliente_cent === null ? null : formatearMoneda(f.saldo_cliente_cent), categoria: 7 },
        ]}
      />
      <Rejilla dividir="6-6">
        <Tarjeta titulo="Avance" descripcion="Confirma el pedido y márcalo enviado cuando el proveedor lo despache">
          <div className="rtm-a1-cuerpo">
            <PasosPedido pedidoId={f.pedido_id} estado={f.estado} avisos={f.avisos} />
            {f.estado === 'enviado' && <p className="rtm-nota">Enviado: la venta, el costo y la cuenta por pagar al proveedor ya están en el libro.</p>}
            {esDs && f.estado !== 'cancelado' && f.estado !== 'anulado' && (
              <>
                <h3 className="rtm-a1-subtitulo">Folio del proveedor</h3>
                <RegistrarFolio pedidoId={f.pedido_id} actual={f.folio_externo} />
              </>
            )}
          </div>
        </Tarjeta>
        {esDs && (
          <Tarjeta titulo="Destinatario (protegido)" descripcion="Teléfono y correo ocultos; revelarlos queda registrado">
            <div className="rtm-a1-cuerpo">
              <BloqueDestinatario pedidoId={f.pedido_id} destinatario={dest} />
              {f.estado !== 'cancelado' && f.estado !== 'anulado' && <CapturarDestinatario pedidoId={f.pedido_id} etiqueta={dest ? 'Corregir destinatario' : 'Capturar destinatario'} />}
              {f.revelaciones > 0 && <p className="rtm-nota">Revelado o copiado con datos completos {f.revelaciones} {f.revelaciones === 1 ? 'vez' : 'veces'}.</p>}
            </div>
          </Tarjeta>
        )}
      </Rejilla>
      {esDs && orden && (
        <Tarjeta titulo={`Orden para ${proveedor}`} descripcion="Texto listo para copiar. El sistema no escribe a nadie.">
          <PanelOrden pedidoId={f.pedido_id} proveedor={proveedor} vistaPrevia={orden.texto} faltaDestinatario={orden.falta_destinatario} />
          <p className="rtm-nota">Costo a {proveedor} según su catálogo vigente: {formatearMoneda(orden.costo_proveedor_cent)}.</p>
        </Tarjeta>
      )}
      <Rejilla dividir="6-6">
        {credito && (
          <Tarjeta titulo="Crédito" descripcion="Interés calculado por la base; el modelo de IA nunca calcula dinero">
            <ListaClaveValor items={[
              { k: 'Interés', v: formatearMoneda(f.interes_cent ?? 0n) },
              { k: 'Modo', v: f.modo_interes === 'fijo' ? 'Monto pactado fijo' : f.modo_interes === 'compuesto' ? 'Compuesto' : 'Simple' },
              { k: 'Tasa por semana', v: f.tasa_semanal_bp ? `${(f.tasa_semanal_bp / 100).toFixed(2)} %` : 'No aplica (monto pactado)' },
              { k: 'Semanas', v: String(f.semanas ?? '') },
              { k: 'Base', v: f.base_credito_cent === null ? 'Sin dato' : formatearMoneda(f.base_credito_cent) },
              { k: 'Fecha de pago pactada', v: f.fecha_pago_pactada ? etiquetaFecha(f.fecha_pago_pactada) : 'Sin fecha' },
            ]} />
          </Tarjeta>
        )}
        {esDs && u && (
          <Tarjeta titulo="Utilidad y reparto" descripcion="Venta menos todo el costo del pedido; mitad para cada socio">
            <ListaClaveValor items={[
              { k: 'Venta', v: formatearMoneda(u.venta_cent) }, { k: 'Costo del producto', v: formatearMoneda(u.costo_producto_cent) },
              { k: 'Envío del proveedor', v: formatearMoneda(u.envio_proveedor_cent) }, { k: 'Otros costos directos', v: formatearMoneda(u.otros_directos_cent) },
              { k: 'Utilidad', v: formatearMoneda(u.utilidad_cent) },
              ...u.socios.map((s) => ({ k: `${s.socio}: parte`, v: `${formatearMoneda(s.utilidad_cent)} (reinvertido ${formatearMoneda(s.reinvertida_cent)})` })),
              { k: 'Depositado por el cliente en la cuenta del proveedor', v: formatearMoneda(u.depositado_proveedor_cent) },
            ]} />
          </Tarjeta>
        )}
      </Rejilla>
      {esDs && (
        <Tarjeta plana titulo="Pagos al proveedor de este pedido (amortizaciones)">
          <DataTable
            etiqueta="Amortizaciones"
            densidad="densa" plana
            clave={(a) => a.id}
            filas={f.amortizaciones}
            vacio={{ titulo: 'Sin pagos todavía', texto: 'Registra el pago en la pestaña Pagos al proveedor, indicando este pedido.' }}
            columnas={[
              { id: 'd', titulo: 'Fecha', ancho: 'm', prioridadMovil: 'titulo', celda: (a) => etiquetaFecha(a.fecha_neg) },
              { id: 'c', titulo: 'Tipo', ancho: 'l', prioridadMovil: 'normal', celda: (a) => a.concepto.replace(/_/g, ' ') },
              { id: 'm', titulo: 'Amortizado', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (a) => formatearMoneda(a.monto_cent) },
            ]}
          />
        </Tarjeta>
      )}
    </Pagina>
  );
}
