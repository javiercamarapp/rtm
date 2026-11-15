import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { DesglosePedidos, EstadoPedido } from '@/dominio/operacion/tipos';
import { origenSurtido } from '@/dominio/dropshipping/calculos';
import { aNumero, contarPor, porcentaje, sumarPorSemana, ultimasSemanas } from '@/dominio/tablero/agregados';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { BarraFiltros, Chip, ChipEstado, CeldaPersona, Segmentado } from '@/ui/componentes/controles';
import { Composicion, type GrupoComposicion } from '@/ui/componentes/composicion';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ColumnasPeriodo } from '@/ui/graficas';
import '@/ui/estilos/paginas-a1.css';
import { ESTADO_PEDIDO, ORIGEN } from '../operacion/etiquetas';
import { columnasSemana, deltaSemanal, NUMERO_SEMANAS, semanasDe, sparkSemanal } from '../_a1/comun';
import { DesglosePedidosTabla, GRUPOS, PROVEEDORES, TIPOS_VENTA, buscarFila } from './desglose';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Pedidos y notas' };

const ESTADOS: { clave: string; texto: string }[] = [
  { clave: '', texto: 'Todos' }, { clave: 'borrador', texto: 'Borradores' }, { clave: 'confirmado', texto: 'Por enviar' }, { clave: 'enviado', texto: 'Enviados' }, { clave: 'anulado', texto: 'Anulados' },
];
const TONO: Record<EstadoPedido, 'ok' | 'atencion' | 'malo' | 'apagado'> = { borrador: 'apagado', confirmado: 'atencion', enviado: 'ok', cancelado: 'apagado', anulado: 'malo' };

/** Texto corto " · $x" con lo facturado que la base ya sumo; vacio si aun no hay enviados. */
function totalFacturado(f: DesglosePedidos | undefined): string {
  return f && f.enviados ? ` · ${formatearMoneda(f.facturado_cent)}` : '';
}


export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<{ estado?: string; aviso?: string; semanas?: string; surtido?: string; prov?: string; tipo?: string }> }) {
  const { estado = '', aviso = '', semanas: sem, surtido: surtidoQ = '', prov: provQ = '', tipo: tipoQ = '' } = await searchParams;
  const surtido = surtidoQ === 'dropshipping' || surtidoQ === 'inventario_merida' ? surtidoQ : '';
  const prov = surtido && PROVEEDORES[provQ]?.surtido === surtido ? provQ : '';
  const tipo = surtido === 'dropshipping' && TIPOS_VENTA[tipoQ] ? tipoQ : '';
  const n = semanasDe(sem);
  const operacion = await operacionDeSocio();
  const [todos, desglose] = await Promise.all([operacion.pedidos(), operacion.pedidosDesglose()]);
  const hoy = fechaNeg(new Date());
  const filas = todos.filter((p) => (!estado || p.estado === (estado as EstadoPedido)) && (!aviso || p.avisos > 0) && (!surtido || origenSurtido(p.origen) === surtido) && (!prov || PROVEEDORES[prov]!.origenes.includes(p.origen)) && (!tipo || p.tipo_venta === tipo));
  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(aviso ? { aviso } : {}), ...(surtido ? { surtido } : {}), ...(prov ? { prov } : {}), ...(tipo ? { tipo } : {}), ...(sem ? { semanas: sem } : {}), ...cambios });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `/pedidos?${s}` : '/pedidos';
  };

  const activos = todos.filter((p) => p.estado !== 'anulado' && p.estado !== 'cancelado');
  const semanas = ultimasSemanas(hoy, n);
  const pedidas = sumarPorSemana(activos, semanas, (p) => p.fecha_neg, (p) => p.piezas_pedidas);
  const surtidas = sumarPorSemana(todos.filter((p) => p.estado === 'enviado'), semanas, (p) => p.fecha_neg, (p) => p.piezas_surtidas);
  const iSem = semanas.length - 1;
  const porEnviar = filas.filter((p) => p.estado === 'confirmado');
  const piezasPorSurtir = filas.filter((p) => p.estado === 'confirmado' || p.estado === 'borrador').reduce((a, p) => a + (p.piezas_pedidas - p.piezas_surtidas), 0);
  const conAvisos = filas.filter((p) => p.avisos > 0);
  const enviadosFiltro = filas.filter((p) => p.estado === 'enviado');
  const cobrado = enviadosFiltro.reduce((a, p) => a + p.cobrado_cent, 0n);
  const conUtilidad = enviadosFiltro.filter((p) => p.utilidad_cent !== null);
  const utilidad = conUtilidad.length ? conUtilidad.reduce((a, p) => a + (p.utilidad_cent ?? 0n), 0n) : null;
  const provisional = conUtilidad.some((p) => p.utilidad_provisional);
  const saldo = enviadosFiltro.reduce((a, p) => a + (p.saldo_cent !== null && p.saldo_cent > 0n ? p.saldo_cent : 0n), 0n);
  // Facturado = suma de las notas de los pedidos enviados; cobrado = lo aplicado de verdad; facturado = cobrado + por cobrar.
  const cobradoReal = cobrado - saldo;
  const piezasTot = filas.reduce((a, p) => a + p.piezas_pedidas, 0);
  const surtidasTot = filas.reduce((a, p) => a + p.piezas_surtidas, 0);
  const cuentaEstado = contarPor(todos, (p) => p.estado);
  const cuenta = (e: string) => (e ? todos.filter((p) => p.estado === e).length : todos.length);
  const ticket = enviadosFiltro.length ? cobrado / BigInt(enviadosFiltro.length) : null;
  // Composicion del libro (de las filas que la base ya sumo en el desglose): relleno animado bajo la grafica semanal.
  const gruposComp: GrupoComposicion[] = [
    { id: 'fact-origen', titulo: 'Facturado por origen del surtido', segmentos: GRUPOS.map((g) => { const f = buscarFila(desglose, 'surtido', g.clave); return { id: g.clave, etiqueta: g.texto, valor: f ? aNumero(f.facturado_cent) : null, texto: f ? formatearMoneda(f.facturado_cent) : 'Sin dato', nota: f ? `${f.enviados} ${f.enviados === 1 ? 'enviado' : 'enviados'}` : undefined }; }) },
    { id: 'piezas-origen', titulo: 'Piezas pedidas por origen del surtido', segmentos: GRUPOS.map((g) => { const f = buscarFila(desglose, 'surtido', g.clave); return { id: g.clave, etiqueta: g.texto, valor: f ? f.piezas : null, texto: f ? formatearPiezas(f.piezas) : 'Sin dato' }; }) },
    { id: 'fact-prov', titulo: 'Facturado por proveedor u origen', segmentos: Object.entries(PROVEEDORES).map(([k, v]) => { const f = buscarFila(desglose, 'proveedor', k); return { id: k, etiqueta: v.texto, valor: f ? aNumero(f.facturado_cent) : null, texto: f ? formatearMoneda(f.facturado_cent) : 'Sin dato' }; }) },
    { id: 'fact-tipo', titulo: 'Dropshipping: tipo de venta (facturado)', segmentos: Object.entries(TIPOS_VENTA).map(([k, texto]) => { const f = buscarFila(desglose, 'tipo', k); return { id: k, etiqueta: texto, valor: f ? aNumero(f.facturado_cent) : null, texto: f ? formatearMoneda(f.facturado_cent) : 'Sin dato' }; }) },
  ];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Pedidos y notas · ${etiquetaHoy()}`}
        titulo={todos.length === 0 ? 'Aún no hay pedidos' : `Tienes ${todos.length} ${todos.length === 1 ? 'pedido' : 'pedidos'} en el libro`}
        descripcion={todos.length === 0 ? 'Crea el primer pedido: el precio sale del tabulador del cliente.' : `${porEnviar.length} por enviar · ${formatearPiezas(piezasPorSurtir)} por surtir · facturado ${formatearMoneda(cobrado)}, cobrado ${formatearMoneda(cobradoReal)}. Se factura solo lo surtido.`}
        acciones={
          <>
            <Segmentado etiquetaAria="Periodo de la gráfica" tamano="chico" opciones={NUMERO_SEMANAS.map((s) => ({ valor: String(s), etiqueta: `${s} sem`, href: enlace({ semanas: s === 8 ? '' : String(s) }), activa: s === n }))} />
            <Link className="rtm-boton rtm-boton-primario" href="/pedidos/nuevo">Nuevo pedido</Link>
          </>
        }
      />
      <BarraFiltros etiquetaAria="Filtros" extras={estado || aviso || surtido ? <Chip href="/pedidos">Quitar filtros</Chip> : undefined}>
        <Segmentado etiquetaAria="Bodega o dropshipping" tamano="chico" opciones={[
          { valor: '', etiqueta: `Todos ${todos.length}${totalFacturado(buscarFila(desglose, 'total', 'todos'))}`, href: enlace({ surtido: '', prov: '', tipo: '' }), activa: !surtido, testid: 'surtido-todos' },
          ...GRUPOS.map((g) => ({ valor: g.clave, etiqueta: `${g.texto} ${todos.filter((p) => origenSurtido(p.origen) === g.clave).length}${totalFacturado(buscarFila(desglose, 'surtido', g.clave))}`, href: enlace({ surtido: g.clave, prov: '', tipo: '' }), activa: surtido === g.clave, testid: g.clave === 'dropshipping' ? 'surtido-dropshipping' : 'surtido-inventario' })),
        ]} />
        <Segmentado etiquetaAria="Estado del pedido" tamano="chico" opciones={ESTADOS.map((e) => ({ valor: e.clave, etiqueta: e.texto, contador: cuenta(e.clave), href: enlace({ estado: e.clave }), activa: estado === e.clave }))} />
        <Chip tono="atencion" href={enlace({ aviso: aviso ? '' : '1' })} activo={aviso === '1'} testid="filtro-avisos">Con avisos {todos.filter((p) => p.avisos > 0).length}</Chip>
      </BarraFiltros>
      <DesglosePedidosTabla desglose={desglose} surtido={surtido} prov={prov} tipo={tipo} enlace={enlace} />

      <KpiLinea
        etiquetaAria="Indicadores de pedidos"
        celdas={[
          { id: 'pedidos', etiqueta: 'Pedidos del filtro', valor: String(filas.length), categoria: 1, nota: `${formatearPiezas(piezasTot)} pedidas · ${formatearPiezas(surtidasTot)} surtidas`, delta: deltaSemanal(semanas, pedidas, true), spark: sparkSemanal(semanas, pedidas, (v) => formatearPiezas(v)) },
          { id: 'porenviar', etiqueta: 'Por enviar', valor: String(porEnviar.length), categoria: 6, nota: `${porEnviar.reduce((a, p) => a + p.piezas_pedidas, 0)} piezas confirmadas`, href: enlace({ estado: 'confirmado' }) },
          { id: 'porsurtir', etiqueta: 'Piezas por surtir', valor: formatearPiezas(piezasPorSurtir), categoria: 3, progreso: piezasTot > 0 ? { pct: (surtidasTot / piezasTot) * 100 } : undefined, nota: piezasTot > 0 ? `${((surtidasTot / piezasTot) * 100).toFixed(0)} % de lo pedido ya se surtió` : undefined },
          { id: 'avisos', etiqueta: 'Con avisos', valor: String(conAvisos.length), categoria: 4, href: enlace({ aviso: '1' }), nota: conAvisos.length ? 'Precio, existencia o mínimo por revisar' : 'Nada por revisar' },
        ]}
      />
      <FilaRatios
        etiqueta="Razones de los pedidos enviados"
        items={[
          { etiqueta: 'Facturado', valor: enviadosFiltro.length ? formatearMoneda(cobrado) : null },
          { etiqueta: 'Cobrado', valor: enviadosFiltro.length ? formatearMoneda(cobradoReal) : null },
          { etiqueta: provisional ? 'Utilidad por pedido (provisional, sin merma)' : 'Utilidad por pedido (sin merma)', valor: utilidad === null ? null : formatearMoneda(utilidad) },
          { etiqueta: 'Margen sobre lo facturado', valor: utilidad !== null && cobrado > 0n ? `${((aNumero(utilidad) / aNumero(cobrado)) * 100).toFixed(1)} %` : null },
          { etiqueta: 'Ticket promedio', valor: ticket === null ? null : formatearMoneda(ticket) },
          { etiqueta: 'Por cobrar', valor: enviadosFiltro.length ? formatearMoneda(saldo) : null },
          { etiqueta: 'Surtido', valor: piezasTot > 0 ? `${((surtidasTot / piezasTot) * 100).toFixed(0)} %` : null },
        ]}
      />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Piezas pedidas por semana" descripcion={`Pedidos activos de las últimas ${n} semanas · surtidas esta semana: ${formatearPiezas(surtidas[iSem] ?? 0)}`}>
          {todos.length ? (
            <ColumnasPeriodo titulo="Piezas pedidas por semana" descripcion={`Piezas de los pedidos activos por semana; la última es parcial.`} unidad="Piezas" procedencia="observado" pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: libro de pedidos`} datos={columnasSemana(semanas, pedidas, (v) => formatearPiezas(v), 'piezas')} />
          ) : <p className="rtm-a1-estado-vacio">Sin pedidos todavía.</p>}
          {todos.length > 0 && <Composicion etiquetaAria="Composición del libro de pedidos" grupos={gruposComp} />}
        </Tarjeta>
        <Tarjeta titulo="Estados y surtido" descripcion="Todos los pedidos del libro">
          <div className="rtm-a1-cuerpo">
            <p className="rtm-a1-subtitulo">Por estado</p>
            <BarList etiquetaAria="Pedidos por estado" items={cuentaEstado.map((c) => ({ id: c.clave, etiqueta: ESTADO_PEDIDO[c.clave as EstadoPedido].texto, texto: String(c.n), pct: porcentaje(c.n, todos.length), tono: c.clave === 'anulado' ? ('malo' as const) : c.clave === 'confirmado' ? ('atencion' as const) : undefined }))} />
          </div>
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Libro de pedidos" descripcion={`${filas.length} de ${todos.length}`}>
        <DataTable
          etiqueta="Pedidos"
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar folio o cliente', porPagina: 50, exportar: 'pedidos' }}
          clave={(p) => p.id}
          filas={filas}
          totales={filas.length ? { etiqueta: 'Totales del filtro', celdas: { z: `${formatearPiezas(piezasTot)}`, b: formatearMoneda(cobrado), u: utilidad === null ? 'Sin dato' : formatearMoneda(utilidad) } } : undefined}
          vacio={{ titulo: 'Sin pedidos', texto: todos.length === 0 ? 'Crea el primer pedido: eliges el cliente, los modelos y sabores, y el sistema toma el precio del tabulador.' : 'Ningún pedido coincide con los filtros.', accion: <Link className="rtm-boton" href="/pedidos/nuevo">Nuevo pedido</Link> }}
          columnas={[
            { id: 'f', titulo: 'Folio', prioridadMovil: 'normal', ancho: 'm', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'c', titulo: 'Cliente', prioridadMovil: 'titulo', ancho: 'xl', celda: (p) => <CeldaPersona nombre={p.cliente} href={`/clientes/${p.cliente_id}`} /> },
            { id: 'd', titulo: 'Fecha', prioridadMovil: 'normal', ancho: 'm', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_neg) },
            { id: 'r', titulo: 'Origen', prioridadMovil: 'oculta', ancho: 'l', secundaria: true, celda: (p) => ORIGEN[p.origen] },
            { id: 'os', titulo: 'Surtido', prioridadMovil: 'normal', ancho: 'l', celda: (p) => <span data-testid={`surtido-${p.id}`}>{origenSurtido(p.origen) === 'dropshipping' ? 'Dropshipping' : 'Inventario en Mérida'}</span> },
            { id: 'z', titulo: 'Piezas', prioridadMovil: 'normal', numerica: true, ancho: 's', celda: (p) => (p.estado === 'enviado' || p.estado === 'anulado' ? `${formatearPiezas(p.piezas_surtidas)} de ${p.piezas_pedidas}` : formatearPiezas(p.piezas_pedidas)) },
            { id: 'b', titulo: 'Facturado', prioridadMovil: 'principal', numerica: true, ancho: 'm', celda: (p) => (p.estado === 'enviado' ? <CifraComprobada texto={formatearMoneda(p.cobrado_cent)} cifra={`pedido:total:${p.id}`} comprobacion="cuadra" /> : <SinDato />) },
            { id: 'u', titulo: 'Utilidad', prioridadMovil: 'normal', numerica: true, ancho: 'm', secundaria: true, celda: (p) => (p.utilidad_cent === null ? <SinDato /> : <>{formatearMoneda(p.utilidad_cent)}{p.utilidad_provisional ? <> <EstadoTexto tono="atencion">provisional</EstadoTexto></> : null}</>) },
            { id: 'e', titulo: 'Estado', prioridadMovil: 'normal', ancho: 'm', celda: (p) => <ChipEstado tono={TONO[p.estado]}>{ESTADO_PEDIDO[p.estado].texto}</ChipEstado> },
            { id: 'p', titulo: 'Pago', prioridadMovil: 'normal', ancho: 'm', secundaria: true, celda: (p) => (p.estado !== 'enviado' || p.saldo_cent === null ? '' : p.saldo_cent === 0n ? <EstadoTexto tono="ok">Saldado</EstadoTexto> : p.saldo_cent < 0n ? <EstadoTexto tono="neutro">A favor</EstadoTexto> : <EstadoTexto tono="atencion">Por cobrar</EstadoTexto>) },
            { id: 'a', titulo: 'Avisos', prioridadMovil: 'oculta', ancho: 's', secundaria: true, celda: (p) => (p.avisos > 0 ? <EstadoTexto tono="atencion">{p.avisos} {p.avisos === 1 ? 'aviso' : 'avisos'}</EstadoTexto> : '') },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
