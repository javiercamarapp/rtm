import type { Metadata } from 'next';
import { lectorDeSocio } from '@/composicion/catalogo';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, nombreVape, saborMayus } from '@/dominio/formato';
import { Segmentado, ChipEstado } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { Aviso } from '@/ui/componentes/controles';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { CONCEPTO_CUENTA, ESTADO_PEDIDO } from '../../operacion/etiquetas';
import { PestanasDs } from '../comun';
import { FormularioPagoProveedor } from './formulario-pago';
import { ResolverDiferencia } from '../pedidos/[id]/costo-pedido';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Pagos al proveedor' };

export default async function PaginaPagosDs({ searchParams }: { searchParams: Promise<{ proveedor?: string }> }) {
  const sp = await searchParams;
  const proveedor = sp.proveedor === 'Isaac' ? 'Isaac' : 'Karen';
  const ds = await dropshippingDeSocio();
  const [c, clientes, resumen, difs, cuentaOp, socioMenudeo] = await Promise.all([ds.cuentaProveedor(proveedor), (await lectorDeSocio()).clientes(), ds.resumen(), ds.diferencias(null), (await operacionDeSocio()).cuentaProveedor(proveedor), ds.socioMenudeo()]);
  // Deuda de la EMPRESA: el total del libro menos los pedidos a costo del socio de menudeo pendientes de pago (a su cuenta).
  const emp = cuentaOp.posicion.posicion_empresa_cent;
  const pendSocio = cuentaOp.posicion.menudeo_pendiente_cent;
  const difsProv = difs.filas.filter((d) => d.proveedor === proveedor);
  const pedidosAbiertos = c.pedidos.filter((p) => p.estado === 'confirmado' || p.estado === 'enviado');
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Dropshipping · Pagos al proveedor · ${etiquetaHoy()}`}
        titulo={`Cuenta con ${proveedor}: ${emp < 0n ? 'deuda de la empresa' : emp > 0n ? 'a favor' : 'saldo cero'} ${emp === 0n ? '' : formatearMoneda(emp < 0n ? -emp : emp)}`.trim()}
        descripcion="Costo de los pedidos enviados, pagos (completos o parciales) y saldo. Los pagos parciales amortizan primero el costo."
        acciones={<FormularioPagoProveedor proveedor={proveedor} pedidos={pedidosAbiertos.map((p) => ({ id: p.pedido_id, texto: `${p.folio} · ${p.cliente}${p.folio_externo ? ` · ${p.folio_externo}` : ''}` }))} clientes={clientes.filter((x) => x.activo && !x.esBodega).map((x) => ({ id: x.id, texto: x.nombre }))} />}
      />
      <PestanasDs activa="pagos" sinFolio={resumen.sin_folio_externo} />
      <Segmentado etiquetaAria="Proveedor" tamano="chico" opciones={['Karen', 'Isaac'].map((p) => ({ valor: p, etiqueta: p, href: `/dropshipping/pagos?proveedor=${p}`, activa: p === proveedor, testid: `ds-prov-${p}` }))} />
      {c.anticipo_cent > 0n && <Aviso tono="atencion" titulo="Anticipo al proveedor.">{formatearMoneda(c.anticipo_cent)} del saldo a favor con {proveedor} no está respaldado por utilidad de pedidos: es un anticipo, no utilidad reinvertida. Se aplica a los próximos pedidos.</Aviso>}
      <KpiLinea
        etiquetaAria={`Cuenta con ${proveedor}`}
        celdas={[
          { id: 'saldo', etiqueta: 'Deuda de la empresa con el proveedor', valor: formatearMoneda(emp), categoria: 1, nota: `${pendSocio > 0n ? `Total según el libro ${formatearMoneda(c.saldo_cent)} = empresa ${formatearMoneda(emp)} + pedidos de ${socioMenudeo} pendientes ${formatearMoneda(-pendSocio)} · ` : ''}${c.etiqueta} · pagos y ajustes ${formatearMoneda(c.saldo_cuenta_corriente_cent)} menos costo de pedidos enviados ${formatearMoneda(c.directos_enviados_cent)}`, testid: 'ds-saldo' },
          { id: 'costo', etiqueta: 'Costo de pedidos enviados', valor: formatearMoneda(c.costo_enviado_cent), categoria: 4 },
          { id: 'amort', etiqueta: 'Amortizado por pedido', valor: formatearMoneda(c.amortizado_cent), categoria: 2, nota: 'Pagos ligados a un pedido' },
          { id: 'reinv', etiqueta: 'Utilidad reinvertida en el proveedor', valor: formatearMoneda(c.reinvertida_cent), categoria: 3, nota: 'Excedente de lo depositado sobre el costo, respaldado por utilidad' },
          { id: 'antic', etiqueta: 'Anticipo', valor: formatearMoneda(c.anticipo_cent), categoria: 6 },
        ]}
      />
      <Tarjeta plana titulo="Pedidos con este proveedor" descripcion="Confirmados y enviados">
        <DataTable
          etiqueta={`Pedidos de ${proveedor}`}
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar folio, folio del proveedor o cliente', porPagina: 50 }}
          clave={(p) => p.pedido_id}
          filas={c.pedidos}
          vacio={{ titulo: `Sin pedidos de dropshipping con ${proveedor} todavía`, texto: 'Cuando un pedido se confirme o se envíe aparecerá aquí con lo amortizado y lo que falta por pagar.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 'm', prioridadMovil: 'normal', celda: (p) => <Link className="rtm-mono" href={`/dropshipping/pedidos/${p.pedido_id}`}>{p.folio}</Link> },
            { id: 'k', titulo: 'Folio del proveedor', ancho: 'm', prioridadMovil: 'normal', celda: (p) => p.folio_externo ?? '' },
            { id: 'c', titulo: 'Cliente', ancho: 'xl', prioridadMovil: 'titulo', celda: (p) => p.cliente },
            { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'normal', celda: (p) => <ChipEstado tono={p.estado === 'enviado' ? 'ok' : 'atencion'}>{ESTADO_PEDIDO[p.estado].texto}</ChipEstado> },
            { id: 'cs', titulo: 'Costo', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (p) => formatearMoneda(p.costo_cent) },
            { id: 'a', titulo: 'Amortizado', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (p) => formatearMoneda(p.amortizado_cent) },
            { id: 'pp', titulo: 'Por pagar', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (p) => (p.estado === 'enviado' ? formatearMoneda(p.por_pagar_cent) : 'Aún no enviado') },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Pagos y movimientos de la cuenta" descripcion="Cada pago con los pedidos que amortiza">
        <DataTable
          etiqueta={`Movimientos de ${proveedor}`}
          densidad="densa" plana
          clave={(m) => m.id}
          filas={c.pagos}
          vacio={{ titulo: 'Sin pagos todavía', texto: `Registra el primer pago a ${proveedor} con el botón de arriba.` }}
          columnas={[
            { id: 'd', titulo: 'Fecha', ancho: 'm', prioridadMovil: 'titulo', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 't', titulo: 'Tipo', ancho: 'l', prioridadMovil: 'normal', celda: (m) => CONCEPTO_CUENTA[m.concepto] ?? m.concepto },
            { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (m) => formatearMoneda(m.monto_cent) },
            { id: 'a', titulo: 'Amortiza', ancho: 'xl', prioridadMovil: 'detalle', celda: (m) => (m.amortizado.length ? m.amortizado.map((a) => `${a.folio} ${formatearMoneda(a.monto_cent)}`).join(' · ') : 'A cuenta') },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Diferencias en disputa con el proveedor" descripcion={`Costo capturado distinto del catálogo · abiertas ${difs.abiertas} por ${formatearMoneda(difs.monto_abierto_cent, { conSigno: true })}`}>
        <DataTable
          etiqueta={`Diferencias con ${proveedor}`}
          densidad="densa" plana
          clave={(d) => d.captura_id}
          filas={difsProv}
          vacio={{ titulo: `Sin diferencias con ${proveedor}`, texto: 'Aparecen cuando un pedido se captura con un costo distinto del catálogo.' }}
          columnas={[
            { id: 'f', titulo: 'Pedido', ancho: 'm', prioridadMovil: 'titulo', celda: (d) => <Link className="rtm-mono" href={`/dropshipping/pedidos/${d.pedido_id}`}>{d.folio}</Link> },
            { id: 'm', titulo: 'Modelo', ancho: 'xl', prioridadMovil: 'normal', celda: (d) => `${nombreVape(d.modelo)} · ${saborMayus(d.sabor)} · ${d.piezas} pz` },
            { id: 'c', titulo: 'Catálogo', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (d) => formatearMoneda(d.costo_catalogo_cent) },
            { id: 'k', titulo: 'Capturado', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (d) => formatearMoneda(d.costo_capturado_cent) },
            { id: 'd', titulo: 'Diferencia', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (d) => <span data-testid={`dif-monto-${d.captura_id}`}>{formatearMoneda(d.diferencia_cent, { conSigno: true })}</span> },
            { id: 'mo', titulo: 'Motivo', ancho: 'xl', prioridadMovil: 'detalle', celda: (d) => d.motivo },
            { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'normal', celda: (d) => <span data-testid={`dif-estado-${d.captura_id}`}>{d.estado === 'abierta' ? 'Abierta' : d.estado === 'resuelta' ? 'Resuelta' : 'Descartada'}</span> },
            { id: 'a', titulo: '', ancho: 'xl', prioridadMovil: 'normal', celda: (d) => (d.estado === 'abierta' ? <ResolverDiferencia capturaId={d.captura_id} /> : d.resolucion ?? '') },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
