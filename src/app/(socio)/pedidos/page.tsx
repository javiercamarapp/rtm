import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { EstadoPedido, Origen } from '@/dominio/operacion/tipos';
import { origenSurtido } from '@/dominio/dropshipping/calculos';
import { aNumero, contarPor, porcentaje, sumarPorSemana, ultimasSemanas } from '@/dominio/tablero/agregados';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { BarraFiltros, Chip, ChipEstado, CeldaPersona, Segmentado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ColumnasPeriodo } from '@/ui/graficas';
import '@/ui/estilos/paginas-a1.css';
import { ESTADO_PEDIDO, ORIGEN } from '../operacion/etiquetas';
import { columnasSemana, deltaSemanal, NUMERO_SEMANAS, semanasDe, sparkSemanal } from '../_a1/comun';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Pedidos y notas' };

const ESTADOS: { clave: string; texto: string }[] = [
  { clave: '', texto: 'Todos' }, { clave: 'borrador', texto: 'Borradores' }, { clave: 'confirmado', texto: 'Por enviar' }, { clave: 'enviado', texto: 'Enviados' }, { clave: 'anulado', texto: 'Anulados' },
];
const TONO: Record<EstadoPedido, 'ok' | 'atencion' | 'malo' | 'apagado'> = { borrador: 'apagado', confirmado: 'atencion', enviado: 'ok', cancelado: 'apagado', anulado: 'malo' };

export default async function PaginaPedidos({ searchParams }: { searchParams: Promise<{ estado?: string; aviso?: string; origen?: string; semanas?: string; surtido?: string }> }) {
  const { estado = '', aviso = '', origen = '', semanas: sem, surtido: surtidoQ = '' } = await searchParams;
  const surtido = surtidoQ === 'dropshipping' || surtidoQ === 'inventario_merida' ? surtidoQ : '';
  const n = semanasDe(sem);
  const todos = await (await operacionDeSocio()).pedidos();
  const hoy = fechaNeg(new Date());
  const filas = todos.filter((p) => (!estado || p.estado === (estado as EstadoPedido)) && (!aviso || p.avisos > 0) && (!origen || p.origen === origen) && (!surtido || origenSurtido(p.origen) === surtido));
  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(aviso ? { aviso } : {}), ...(origen ? { origen } : {}), ...(surtido ? { surtido } : {}), ...(sem ? { semanas: sem } : {}), ...cambios });
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
  const piezasTot = filas.reduce((a, p) => a + p.piezas_pedidas, 0);
  const surtidasTot = filas.reduce((a, p) => a + p.piezas_surtidas, 0);
  const cuentaEstado = contarPor(todos, (p) => p.estado);
  const cuentaOrigen = contarPor(todos, (p) => p.origen);
  const cuenta = (e: string) => (e ? todos.filter((p) => p.estado === e).length : todos.length);
  const ticket = enviadosFiltro.length ? cobrado / BigInt(enviadosFiltro.length) : null;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Pedidos y notas · ${etiquetaHoy()}`}
        titulo={todos.length === 0 ? 'Aún no hay pedidos' : `Tienes ${todos.length} ${todos.length === 1 ? 'pedido' : 'pedidos'} en el libro`}
        descripcion={todos.length === 0 ? 'Crea el primer pedido: el precio sale del tabulador del cliente.' : `${porEnviar.length} por enviar · ${formatearPiezas(piezasPorSurtir)} por surtir · cobrado ${formatearMoneda(cobrado)}. Se cobra solo lo surtido.`}
        acciones={
          <>
            <Segmentado etiquetaAria="Periodo de la gráfica" tamano="chico" opciones={NUMERO_SEMANAS.map((s) => ({ valor: String(s), etiqueta: `${s} sem`, href: enlace({ semanas: s === 8 ? '' : String(s) }), activa: s === n }))} />
            <Link className="rtm-boton rtm-boton-primario" href="/pedidos/nuevo">Nuevo pedido</Link>
          </>
        }
      />
      <BarraFiltros etiquetaAria="Filtros" extras={estado || aviso || origen || surtido ? <Chip href="/pedidos">Quitar filtros</Chip> : undefined}>
        <Segmentado etiquetaAria="Origen del surtido" tamano="chico" opciones={[
          { valor: '', etiqueta: `Todos ${todos.length}`, href: enlace({ surtido: '' }), activa: !surtido, testid: 'surtido-todos' },
          { valor: 'dropshipping', etiqueta: `Dropshipping ${todos.filter((p) => origenSurtido(p.origen) === 'dropshipping').length}`, href: enlace({ surtido: 'dropshipping' }), activa: surtido === 'dropshipping', testid: 'surtido-dropshipping' },
          { valor: 'inventario_merida', etiqueta: `Inventario en Mérida ${todos.filter((p) => origenSurtido(p.origen) === 'inventario_merida').length}`, href: enlace({ surtido: 'inventario_merida' }), activa: surtido === 'inventario_merida', testid: 'surtido-inventario' },
        ]} />
        {ESTADOS.map((e) => <Chip key={e.clave} href={enlace({ estado: e.clave })} activo={estado === e.clave}>{`${e.texto} ${cuenta(e.clave)}`}</Chip>)}
        <Chip tono="atencion" href={enlace({ aviso: aviso ? '' : '1' })} activo={aviso === '1'}>Con avisos</Chip>
        {(Object.keys(ORIGEN) as Origen[]).filter((o) => cuentaOrigen.some((c) => c.clave === o)).map((o) => <Chip key={o} href={enlace({ origen: origen === o ? '' : o })} activo={origen === o}>{ORIGEN[o]}</Chip>)}
      </BarraFiltros>

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
          { etiqueta: 'Cobrado', valor: enviadosFiltro.length ? formatearMoneda(cobrado) : null },
          { etiqueta: provisional ? 'Utilidad (provisional)' : 'Utilidad', valor: utilidad === null ? null : formatearMoneda(utilidad) },
          { etiqueta: 'Margen', valor: utilidad !== null && cobrado > 0n ? `${((aNumero(utilidad) / aNumero(cobrado)) * 100).toFixed(1)} %` : null },
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
        </Tarjeta>
        <Tarjeta titulo="Estados y origen" descripcion="Todos los pedidos del libro">
          <div className="rtm-a1-cuerpo">
            <p className="rtm-a1-subtitulo">Por estado</p>
            <BarList etiquetaAria="Pedidos por estado" items={cuentaEstado.map((c) => ({ id: c.clave, etiqueta: ESTADO_PEDIDO[c.clave as EstadoPedido].texto, texto: String(c.n), pct: porcentaje(c.n, todos.length), tono: c.clave === 'anulado' ? ('malo' as const) : c.clave === 'confirmado' ? ('atencion' as const) : undefined }))} />
            <p className="rtm-a1-subtitulo">Por origen de surtido</p>
            <BarList etiquetaAria="Pedidos por origen de surtido" items={(['dropshipping', 'inventario_merida'] as const).map((k) => { const g = todos.filter((p) => origenSurtido(p.origen) === k); const env = g.filter((p) => p.estado === 'enviado'); const util = env.filter((p) => p.utilidad_cent !== null).reduce((a, p) => a + (p.utilidad_cent ?? 0n), 0n); return { id: k, etiqueta: k === 'dropshipping' ? 'Dropshipping' : 'Inventario en Mérida', texto: String(g.length), pct: porcentaje(g.length, todos.length), nota: `${env.length} enviados · cobrado ${formatearMoneda(env.reduce((a, p) => a + p.cobrado_cent, 0n))} · utilidad ${formatearMoneda(util)}` }; })} />
            <p className="rtm-a1-subtitulo">Por origen</p>
            <BarList etiquetaAria="Pedidos por origen" items={cuentaOrigen.map((c) => ({ id: c.clave, etiqueta: ORIGEN[c.clave as Origen], texto: String(c.n), pct: porcentaje(c.n, todos.length) }))} />
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
            { id: 'b', titulo: 'Cobrado', prioridadMovil: 'principal', numerica: true, ancho: 'm', celda: (p) => (p.estado === 'enviado' ? <CifraComprobada texto={formatearMoneda(p.cobrado_cent)} cifra={`pedido:total:${p.id}`} comprobacion="cuadra" /> : <SinDato />) },
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
