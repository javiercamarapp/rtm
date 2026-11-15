import type { Metadata } from 'next';
import Link from 'next/link';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { lectorDeSocio } from '@/composicion/catalogo';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { OrigenSurtido } from '@/dominio/dropshipping/tipos';
import type { EstadoPedido } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { BarraFiltros, Chip, ChipEstado, CeldaPersona, Segmentado } from '@/ui/componentes/controles';
import { FiltrosPlegables } from '@/ui/componentes/filtros-plegables';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { ESTADO_PEDIDO, ORIGEN } from '../../operacion/etiquetas';
import { fechaOpcional, ORIGEN_SURTIDO, PestanasDs, TIPO_VENTA } from '../comun';

export const metadata: Metadata = { title: 'Pedidos de dropshipping' };
const TONO: Record<EstadoPedido, 'ok' | 'atencion' | 'malo' | 'apagado'> = { borrador: 'apagado', confirmado: 'atencion', enviado: 'ok', cancelado: 'apagado', anulado: 'malo' };
const ESTADOS = ['borrador', 'confirmado', 'enviado', 'anulado', 'cancelado'];

export default async function PaginaPedidosDs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const origen: OrigenSurtido | null = sp['origen'] === 'inventario_merida' ? 'inventario_merida' : sp['origen'] === 'todos' ? null : 'dropshipping';
  const proveedor = sp['proveedor'] === 'Karen' || sp['proveedor'] === 'Isaac' ? sp['proveedor'] : null;
  const estado = ESTADOS.includes(sp['estado'] ?? '') ? (sp['estado'] as string) : null;
  const clienteId = Number.isInteger(Number(sp['cliente'])) && Number(sp['cliente']) > 0 ? Number(sp['cliente']) : null;
  const desde = fechaOpcional(sp['desde']);
  const hasta = fechaOpcional(sp['hasta']);
  const busqueda = (sp['q'] ?? '').trim().slice(0, 60) || null;
  const tipoVenta = sp['tipo'] === 'cliente' || sp['tipo'] === 'socio_a_costo' ? sp['tipo'] : null;
  const ds = await dropshippingDeSocio();
  const [filas, clientes, resumen] = await Promise.all([
    ds.pedidos({ origenSurtido: origen, proveedor, estado, clienteId, desde, hasta, busqueda, tipoVenta }), (await lectorDeSocio()).clientes(), ds.resumen(),
  ]);
  const enlace = (c: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...c })) if (v) q.set(k, v);
    return q.size ? `/dropshipping/pedidos?${q.toString()}` : '/dropshipping/pedidos';
  };
  const enviados = filas.filter((f) => f.estado === 'enviado');
  const suma = (f: (x: (typeof filas)[number]) => bigint) => enviados.reduce((a, x) => a + f(x), 0n);
  const piezas = filas.reduce((a, f) => a + (f.estado === 'enviado' ? f.piezas_surtidas : f.piezas_pedidas), 0);
  const hayFiltros = Object.entries(sp).some(([k, v]) => v && k !== 'origen') || (sp['origen'] ?? '') !== '';

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Dropshipping · Pedidos · ${etiquetaHoy()}`}
        titulo={filas.length ? `${filas.length} ${filas.length === 1 ? 'pedido' : 'pedidos'} en el filtro` : origen === 'dropshipping' ? 'Sin pedidos de dropshipping todavía' : 'Ningún pedido coincide'}
        descripcion="Busca por folio del proveedor (por ejemplo el número de pedido de Karen), por folio propio o por cliente."
        acciones={<Link className="rtm-boton rtm-boton-primario" href="/dropshipping/nuevo">Nuevo pedido</Link>}
      />
      <PestanasDs activa="pedidos" sinFolio={resumen.sin_folio_externo} filtros={(
      <BarraFiltros etiquetaAria="Filtros de pedidos" extras={hayFiltros ? <Chip href="/dropshipping/pedidos">Quitar filtros</Chip> : undefined}>
        <Segmentado etiquetaAria="Origen" tamano="chico" opciones={[
          { valor: 'dropshipping', etiqueta: 'Dropshipping', href: enlace({ origen: '' }), activa: origen === 'dropshipping' }, { valor: 'inventario_merida', etiqueta: 'Inventario en Mérida', href: enlace({ origen: 'inventario_merida' }), activa: origen === 'inventario_merida' },
          { valor: 'todos', etiqueta: 'Todos', href: enlace({ origen: 'todos' }), activa: origen === null }]} />
        <form className="rtm-ds-filtros-linea" method="get" aria-label="Buscar y filtrar">
          <input type="hidden" name="origen" value={sp['origen'] ?? ''} />
          <input className="rtm-campo rtm-ba-buscar" type="search" name="q" defaultValue={busqueda ?? ''} data-testid="ds-buscar" placeholder="Buscar por folio del proveedor, folio o cliente" aria-label="Folio del proveedor, folio o cliente" />
          <button type="submit" className="rtm-boton rtm-boton-primario" data-testid="ds-filtrar">Filtrar</button>
          <FiltrosPlegables etiqueta="Filtros" titulo="Más filtros: proveedor, estado, tipo, cliente y periodo" activos={[proveedor, estado, tipoVenta, clienteId, desde, hasta].filter(Boolean).length}>
            <label className="rtm-etiqueta-campo">Proveedor<select className="rtm-campo" name="proveedor" defaultValue={proveedor ?? ''}><option value="">Todos</option><option value="Karen">Karen</option><option value="Isaac">Isaac</option></select></label>
            <label className="rtm-etiqueta-campo">Estado<select className="rtm-campo" name="estado" defaultValue={estado ?? ''}><option value="">Todos</option>{ESTADOS.map((e) => <option key={e} value={e}>{ESTADO_PEDIDO[e as EstadoPedido].texto}</option>)}</select></label>
            <label className="rtm-etiqueta-campo">Tipo<select className="rtm-campo" name="tipo" defaultValue={tipoVenta ?? ''}><option value="">Todos</option><option value="cliente">De cliente</option><option value="socio_a_costo">A costo para socio</option></select></label>
            <label className="rtm-etiqueta-campo rtm-campo-ancho">Cliente<select className="rtm-campo" name="cliente" defaultValue={clienteId ?? ''}><option value="">Todos</option>{clientes.filter((c) => c.activo && !c.esBodega).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
            <label className="rtm-etiqueta-campo">Desde<input className="rtm-campo" type="date" name="desde" defaultValue={desde ?? ''} /></label>
            <label className="rtm-etiqueta-campo">Hasta<input className="rtm-campo" type="date" name="hasta" defaultValue={hasta ?? ''} /></label>
          </FiltrosPlegables>
        </form>
      </BarraFiltros>
      )} />

      <Tarjeta plana titulo="Pedidos" descripcion={`${formatearPiezas(piezas)} piezas · ${enviados.length} enviados`}>
        <DataTable
          etiqueta="Pedidos de dropshipping"
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ porPagina: 50, exportar: 'dropshipping-pedidos' }}
          clave={(f) => f.pedido_id}
          filas={filas}
          totales={filas.length ? { etiqueta: 'Totales', detalle: 'de los enviados', celdas: { v: formatearMoneda(suma((x) => x.venta_cent)), c: formatearMoneda(suma((x) => x.costo_total_cent)), m: formatearMoneda(suma((x) => x.margen_cent)) } } : undefined}
          vacio={{ titulo: origen === 'dropshipping' ? 'Sin pedidos de dropshipping todavía' : 'Ningún pedido coincide', texto: 'Captura el primero en Nuevo pedido: eliges los renglones, el destinatario y el sistema arma la orden para el proveedor.', accion: <Link className="rtm-boton" href="/dropshipping/nuevo">Nuevo pedido</Link> }}
          columnas={[
            { id: 'f', titulo: 'Folio', prioridadMovil: 'normal', ancho: 'm', celda: (f) => <Link className="rtm-mono" href={`/dropshipping/pedidos/${f.pedido_id}`}>{f.folio}</Link> },
            { id: 'k', titulo: 'Folio del proveedor', prioridadMovil: 'normal', ancho: 'm', celda: (f) => (f.folio_externo ? <span className="rtm-mono" data-testid={`folio-ext-${f.pedido_id}`}>{f.folio_externo}</span> : f.origen_surtido === 'dropshipping' && f.estado !== 'borrador' && f.estado !== 'cancelado' ? <EstadoTexto tono="atencion">Falta</EstadoTexto> : '') },
            { id: 'c', titulo: 'Cliente', prioridadMovil: 'titulo', ancho: 'xl', celda: (f) => <CeldaPersona nombre={f.cliente} href={`/clientes/${f.cliente_id}`} /> },
            { id: 'o', titulo: 'Origen', prioridadMovil: 'normal', ancho: 'l', secundaria: true, celda: (f) => <span title={ORIGEN[f.origen]}>{ORIGEN_SURTIDO[f.origen_surtido]}{f.proveedor ? ` · ${f.proveedor}` : ''}</span> },
            { id: 't', titulo: 'Tipo', prioridadMovil: 'oculta', ancho: 'l', secundaria: true, celda: (f) => (f.tipo_venta ? TIPO_VENTA[f.tipo_venta] : '') },
            { id: 'd', titulo: 'Fecha', prioridadMovil: 'oculta', ancho: 'm', secundaria: true, celda: (f) => etiquetaFecha(f.fecha_neg) },
            { id: 'z', titulo: 'Piezas', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (f) => (f.estado === 'enviado' ? `${formatearPiezas(f.piezas_surtidas)} de ${f.piezas_pedidas}` : formatearPiezas(f.piezas_pedidas)) },
            { id: 'v', titulo: 'Venta', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => (f.estado === 'enviado' ? <CifraComprobada texto={formatearMoneda(f.venta_cent)} cifra={`pedido:total:${f.pedido_id}`} comprobacion="cuadra" /> : <span title="Estimado">{formatearMoneda(f.venta_cent)} est.</span>) },
            { id: 'cc', titulo: 'Costo', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'normal', celda: (f) => <span data-testid={`costo-${f.pedido_id}`}>{formatearMoneda(f.costo_total_cent)}{f.diferencia_catalogo_cent !== 0n ? <> <EstadoTexto tono="atencion">distinto del catálogo {formatearMoneda(f.diferencia_catalogo_cent, { conSigno: true })}</EstadoTexto></> : null}</span> },
            { id: 'm', titulo: 'Utilidad', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => (f.real ? <>{formatearMoneda(f.margen_cent)}{f.utilidad_provisional ? <> <EstadoTexto tono="atencion">provisional</EstadoTexto></> : null}</> : <SinDato />) },
            { id: 'e', titulo: 'Estado', prioridadMovil: 'normal', ancho: 'm', celda: (f) => <ChipEstado tono={TONO[f.estado]}>{ESTADO_PEDIDO[f.estado].texto}</ChipEstado> },
            { id: 'p', titulo: 'Por pagar al proveedor', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (f) => (f.origen_surtido === 'dropshipping' && f.estado === 'enviado' ? formatearMoneda(f.por_pagar_cent) : '') },
            { id: 'x', titulo: 'Por cobrar', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (f) => (f.saldo_cliente_cent === null ? '' : formatearMoneda(f.saldo_cliente_cent)) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
