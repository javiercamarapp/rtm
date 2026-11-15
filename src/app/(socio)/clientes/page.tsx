import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { operacionDeSocio } from '@/composicion/operacion';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda, formatearMonedaCompacta, formatearPiezas } from '@/dominio/formato';
import { alcanzanUmbral, aNumero, porcentaje, ritmoCliente } from '@/dominio/tablero/agregados';
import { BarraFiltros, CeldaPersona, ChipEstado, Segmentado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Pareto, BarrasDelta } from '@/ui/graficas';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Clientes' };

const TIPOS: Record<string, string> = { mayoreo: 'Mayoreo', credito_interno: 'Crédito interno', ocasional: 'Ocasional' };
const VISTAS = [{ clave: '', texto: 'Todos' }, { clave: 'saldo', texto: 'Con saldo' }, { clave: 'vencido', texto: 'Con saldo vencido' }, { clave: 'bajan', texto: 'Bajan de ritmo' }] as const;

export default async function PaginaClientes({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista = '' } = await searchParams;
  const op = await operacionDeSocio();
  const [todos, pedidos, cxc] = await Promise.all([(await lectorDeSocio()).clientes(), op.pedidos().catch(() => null), op.cuentasPorCobrar().catch(() => null)]);
  const hoy = fechaNeg(new Date());

  const filasBase = todos.map((c) => {
    const ps = (pedidos ?? []).filter((p) => p.cliente_id === c.id && p.estado !== 'anulado' && p.estado !== 'cancelado');
    const env = ps.filter((p) => p.estado === 'enviado');
    const ventas = env.reduce((a, p) => a + p.cobrado_cent, 0n);
    const ultima = ps.length ? ps.map((p) => p.fecha_neg).sort().at(-1)! : null;
    const s = cxc?.por_cliente.find((x) => x.cliente_id === c.id) ?? null;
    return {
      ...c, pedidos: ps.length, ventas, ultima, saldo: cxc ? (s?.saldo_cent ?? 0n) : null, vencido: cxc ? (s?.vencido_cent ?? 0n) : null, diasMax: s?.dias_max ?? null,
      ritmo: pedidos ? ritmoCliente(ps.map((p) => ({ fecha: p.fecha_neg, piezas: p.piezas_pedidas })), hoy) : null,
    };
  });
  const filas = filasBase.filter((c) => (vista === 'saldo' ? (c.saldo ?? 0n) > 0n : vista === 'vencido' ? (c.vencido ?? 0n) > 0n : vista === 'bajan' ? c.ritmo?.baja === true : true));
  const conSaldo = filasBase.filter((c) => (c.saldo ?? 0n) > 0n);
  const conVencido = filasBase.filter((c) => (c.vencido ?? 0n) > 0n);
  const bajan = filasBase.filter((c) => c.ritmo?.baja === true);
  const sinRitmo = filasBase.filter((c) => c.ritmo === null).length;
  const ventasTot = filasBase.reduce((a, c) => a + c.ventas, 0n);
  const saldoTot = conSaldo.reduce((a, c) => a + (c.saldo ?? 0n), 0n);
  const conPedidos = filasBase.filter((c) => c.ventas > 0n);
  const umbral = alcanzanUmbral(conPedidos.map((c) => aNumero(c.ventas)));
  const activos = filasBase.filter((c) => c.activo).length;
  const sinPrecios = filasBase.filter((c) => c.precios === 0 && !c.esBodega).length;
  const filtro = (clave: string) => (clave ? `/clientes?vista=${clave}` : '/clientes');
  const cuenta = (clave: string) => (clave === 'saldo' ? conSaldo.length : clave === 'vencido' ? conVencido.length : clave === 'bajan' ? bajan.length : todos.length);

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Clientes · ${etiquetaHoy()}`}
        titulo={`${todos.length} ${todos.length === 1 ? 'cliente' : 'clientes'}`}
        descripcion={`${conSaldo.length} con saldo (${cxc ? formatearMoneda(saldoTot) : 'sin dato'}) · ${conVencido.length} con saldo vencido. Cada cliente tiene un tabulador por modelo con su historial.`}
        acciones={<><Link className="rtm-boton" href="/pedidos/nuevo">Nuevo pedido</Link><Link className="rtm-boton rtm-boton-primario" href="/clientes/nuevo" data-testid="nuevo-cliente">Nuevo cliente</Link></>}
      />
      <BarraFiltros etiquetaAria="Vistas de clientes">
        <Segmentado etiquetaAria="Vista de la cartera" tamano="chico" opciones={VISTAS.map((v) => ({ valor: v.clave, etiqueta: v.texto, contador: cuenta(v.clave), href: filtro(v.clave), activa: vista === v.clave }))} />
      </BarraFiltros>
      <KpiLinea
        etiquetaAria="Indicadores de clientes"
        celdas={[
          { id: 'clientes', etiqueta: 'Clientes', valor: String(todos.length), categoria: 1, nota: `${activos} activos` },
          { id: 'saldo', etiqueta: 'Con saldo', valor: cxc ? String(conSaldo.length) : null, categoria: 2, nota: cxc ? `${formatearMoneda(saldoTot)} por cobrar` : undefined, href: filtro('saldo') },
          { id: 'vencido', etiqueta: 'Con saldo vencido', valor: cxc ? String(conVencido.length) : null, categoria: 4, nota: cxc ? `${formatearMoneda(cxc.vencido_cent)} vencido` : undefined, href: filtro('vencido') },
          { id: 'bajan', etiqueta: 'Bajan de ritmo', valor: pedidos && sinRitmo < filasBase.length ? String(bajan.length) : null, categoria: 6, href: filtro('bajan'), nota: sinRitmo > 0 ? `${sinRitmo} sin historia suficiente (3 pedidos y 4 semanas)` : 'Menos del 70 % de su promedio de 12 semanas' },
        ]}
      />
      <FilaRatios
        etiqueta="Razones de la cartera"
        items={[
          { etiqueta: 'Ventas facturadas', valor: pedidos ? formatearMoneda(ventasTot) : null },
          { etiqueta: 'Clientes con compras', valor: pedidos ? String(conPedidos.length) : null },
          { etiqueta: 'Concentración', valor: umbral.total > 1 ? `${umbral.n} de ${umbral.total} suman el 80 %` : null },
          { etiqueta: 'Saldo sobre ventas', valor: ventasTot > 0n && cxc ? `${((aNumero(saldoTot) / aNumero(ventasTot)) * 100).toFixed(1)} %` : null },
          { etiqueta: 'Sin tabulador', valor: String(sinPrecios) },
        ]}
      />

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Concentración de ventas" descripcion="Ventas facturadas por cliente y porcentaje acumulado">
          {conPedidos.length >= 4 ? (
            <Pareto
              titulo="¿Quiénes concentran las ventas?" descripcion={`Ventas facturadas de ${conPedidos.length} clientes, de mayor a menor.`} unidad="Ventas" sustantivo="clientes" procedencia="observado" pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: pedidos enviados`}
              datos={[...conPedidos].sort((a, b) => (a.ventas === b.ventas ? 0 : a.ventas < b.ventas ? 1 : -1)).slice(0, 12).map((c) => ({ id: String(c.id), etiqueta: c.nombre, valor: aNumero(c.ventas), texto: formatearMoneda(c.ventas), corto: formatearMonedaCompacta(c.ventas) }))}
            />
          ) : conPedidos.length > 0 ? (
            <BarList etiquetaAria="Ventas por cliente" items={[...conPedidos].sort((a, b) => (a.ventas < b.ventas ? 1 : -1)).map((c) => ({ id: String(c.id), etiqueta: c.nombre, href: `/clientes/${c.id}`, texto: formatearMoneda(c.ventas), pct: porcentaje(aNumero(c.ventas), aNumero(ventasTot)) }))} />
          ) : <p className="rtm-a1-estado-vacio">Sin ventas enviadas todavía: aquí aparecerá la concentración por cliente (con cuatro clientes o más).</p>}
        </Tarjeta>
        <Tarjeta titulo={bajan.length > 0 ? 'Clientes que bajan de ritmo' : 'Mayores saldos'} descripcion={bajan.length > 0 ? 'Piezas de la última semana completa contra su promedio' : 'Saldo por cobrar por cliente'}>
          {bajan.length > 0 ? (
            <BarrasDelta
              titulo="¿Qué clientes bajaron de ritmo?" descripcion="Piezas de la última semana completa por cliente." unidad="Piezas" procedencia="inferido"
              datos={bajan.map((c) => ({ id: String(c.id), etiqueta: c.nombre, valor: c.ritmo!.recientes, texto: formatearPiezas(Math.round(c.ritmo!.recientes)), delta: { texto: `promedio ${c.ritmo!.promedio.toFixed(0)} pz`, sentido: 'baja' as const, bueno: false } }))}
            />
          ) : conSaldo.length > 0 ? (
            <BarList etiquetaAria="Clientes con mayor saldo" items={[...conSaldo].sort((a, b) => ((a.saldo ?? 0n) < (b.saldo ?? 0n) ? 1 : -1)).slice(0, 8).map((c) => ({ id: String(c.id), etiqueta: c.nombre, href: `/clientes/${c.id}`, texto: formatearMoneda(c.saldo ?? 0n), pct: porcentaje(aNumero(c.saldo ?? 0n), aNumero(saldoTot)), tono: (c.vencido ?? 0n) > 0n ? ('malo' as const) : undefined, nota: (c.vencido ?? 0n) > 0n ? `vencido ${formatearMoneda(c.vencido ?? 0n)}` : undefined }))} />
          ) : <p className="rtm-a1-estado-vacio">{cxc ? 'Ningún cliente con saldo.' : 'Sin dato de cobranza.'}</p>}
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Cartera de clientes" descripcion={`${filas.length} de ${todos.length}`}>
        <DataTable
          etiqueta="Clientes" densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar cliente o alias', porPagina: 50, exportar: 'clientes' }}
          clave={(c) => c.id} filas={filas}
          totales={filas.length ? { etiqueta: 'Totales del filtro', celdas: { v: formatearMoneda(filas.reduce((a, c) => a + c.ventas, 0n)), s: cxc ? formatearMoneda(filas.reduce((a, c) => a + (c.saldo ?? 0n), 0n)) : 'Sin dato', z: String(filas.reduce((a, c) => a + c.pedidos, 0)) } } : undefined}
          vacio={{ titulo: 'Sin clientes', texto: 'Ningún cliente coincide con la vista elegida.', accion: <Link className="rtm-boton" href="/clientes">Ver todos</Link> }}
          columnas={[
            { id: 'n', titulo: 'Cliente', prioridadMovil: 'titulo', ancho: 'xl', celda: (c) => <CeldaPersona nombre={c.nombre} href={`/clientes/${c.id}`} subtitulo={c.alias.length ? `También: ${c.alias.map((a) => (a.porConfirmar ? `${a.alias} (por confirmar)` : a.alias)).join(', ')}` : undefined} /> },
            { id: 't', titulo: 'Tipo', prioridadMovil: 'oculta', ancho: 'm', secundaria: true, celda: (c) => <>{TIPOS[c.tipo] ?? c.tipo}{c.esBodega && <> · <ChipEstado tono="info">presta la bodega</ChipEstado></>}</> },
            { id: 'p', titulo: 'Modelos con precio', prioridadMovil: 'oculta', numerica: true, ancho: 's', celda: (c) => c.precios },
            { id: 'z', titulo: 'Pedidos', prioridadMovil: 'normal', numerica: true, ancho: 's', celda: (c) => (pedidos ? c.pedidos : <SinDato />) },
            { id: 'v', titulo: 'Ventas facturadas', prioridadMovil: 'normal', numerica: true, ancho: 'm', celda: (c) => (pedidos ? (c.ventas > 0n ? formatearMoneda(c.ventas) : <SinDato />) : <SinDato />) },
            { id: 'u', titulo: 'Última compra', prioridadMovil: 'normal', ancho: 'm', secundaria: true, celda: (c) => (c.ultima ? etiquetaFecha(c.ultima) : <SinDato />) },
            { id: 's', titulo: 'Saldo', prioridadMovil: 'principal', numerica: true, ancho: 'm', celda: (c) => (c.saldo === null ? <SinDato /> : c.saldo > 0n ? formatearMoneda(c.saldo) : '—') },
            { id: 'x', titulo: 'Estado de cobro', prioridadMovil: 'normal', ancho: 'm', celda: (c) => ((c.vencido ?? 0n) > 0n ? <ChipEstado tono="malo">Vencido {c.diasMax} d</ChipEstado> : (c.saldo ?? 0n) > 0n ? <ChipEstado tono="atencion">Por cobrar</ChipEstado> : c.ritmo?.baja ? <ChipEstado tono="atencion">Baja de ritmo</ChipEstado> : <ChipEstado tono="ok">Al corriente</ChipEstado>) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
