import type { Metadata } from 'next';
import Link from 'next/link';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { DimensionDesglose, FilaDesglose, OrigenSurtido } from '@/dominio/dropshipping/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { BarraFiltros, Segmentado, Chip } from '@/ui/componentes/controles';
import { FiltroPeriodo } from '@/ui/componentes/filtro-periodo';
import { Composicion, type GrupoComposicion } from '@/ui/componentes/composicion';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ColumnasPeriodo } from '@/ui/graficas';
import '@/ui/estilos/paginas-a1.css';
import { aNumero as aNum } from '@/dominio/tablero/agregados';
import { etiquetaHoy } from '../contexto';
import { fechaOpcional, ORIGEN_SURTIDO, PestanasDs } from './comun';

export const metadata: Metadata = { title: 'Dropshipping' };

const DIMENSIONES: { clave: DimensionDesglose; texto: string }[] = [
  { clave: 'semana', texto: 'Semana' }, { clave: 'mes', texto: 'Mes' }, { clave: 'marca', texto: 'Marca' }, { clave: 'modelo', texto: 'Modelo' }, { clave: 'sabor', texto: 'Sabor' }, { clave: 'cliente', texto: 'Cliente' },
];
const PRODUCTO = new Set<DimensionDesglose>(['marca', 'modelo', 'sabor']);

export default async function PaginaDropshipping({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; dim?: string; origen?: string }> }) {
  const sp = await searchParams;
  const desde = fechaOpcional(sp.desde);
  const hasta = fechaOpcional(sp.hasta);
  const dim = (DIMENSIONES.find((d) => d.clave === sp.dim)?.clave ?? 'semana') as DimensionDesglose;
  const origen = sp.origen === 'dropshipping' || sp.origen === 'inventario_merida' ? (sp.origen as OrigenSurtido) : null;
  const ds = await dropshippingDeSocio();
  const socioMenudeo = await ds.socioMenudeo();
  const [r, filas, porSemana, menudeo] = await Promise.all([ds.resumen(desde, hasta), ds.desglose(dim, desde, hasta, origen), ds.desglose('semana', desde, hasta, 'dropshipping'), ds.menudeo(socioMenudeo, {})]);
  // Pedidos a costo del socio de menudeo ya enviados y pendientes de pago: estan dentro de 'Por pagar a proveedores' del pedido, pero son a su cuenta (no deuda de la empresa).
  const pendienteSocio = menudeo.filas.filter((f) => f.estado === 'enviado').reduce((a, f) => a + f.pendiente_cent, 0n);
  const rango = `${desde ?? '-'}:${hasta ?? '-'}`.replace(/^-:-$/, '-:-');
  const [d, h] = rango.split(':');
  const cif = (metrica: string, org: string, texto: string | null) => <CifraComprobada texto={texto} cifra={`ds:${metrica}:${org}:${d}:${h}`} comprobacion="cuadra" />;
  const dsCol = r.por_origen.find((x) => x.origen_surtido === 'dropshipping');
  const invCol = r.por_origen.find((x) => x.origen_surtido === 'inventario_merida');
  const total = (f: (c: NonNullable<typeof dsCol>) => bigint) => (dsCol ? f(dsCol) : 0n) + (invCol ? f(invCol) : 0n);
  const hayDatos = r.por_origen.some((c) => c.pedidos > 0) || r.en_curso.length > 0;
  const enlace = (c: Record<string, string>) => {
    const q = new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(sp.dim ? { dim: sp.dim } : {}), ...(origen ? { origen } : {}), ...c });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return q.size ? `/dropshipping?${q.toString()}` : '/dropshipping';
  };
  const pm = r.piezas_movidas;
  // Deuda de la empresa con cada proveedor segun el libro (saldo negativo = se debe): una sola convencion, siempre positiva en pantalla.
  const deudaProv = (n: string) => { const sc = r.proveedores.find((p) => p.proveedor === n)?.saldo_cent ?? 0n; return sc < 0n ? -sc : 0n; };
  const deudaLibro = deudaProv('Isaac') + deudaProv('Karen');
  const porPagarPedidos = dsCol?.por_pagar_cent ?? 0n;
  const difPuente = deudaLibro - porPagarPedidos;
  const semanas = porSemana.slice(-12);
  // Relleno animado bajo la grafica semanal: solo cifras que el resumen ya trae.
  const gruposComp: GrupoComposicion[] = [
    { id: 'venta-origen', titulo: 'Venta por origen del surtido', segmentos: [{ id: 'ds', etiqueta: ORIGEN_SURTIDO.dropshipping, valor: dsCol ? aNum(dsCol.venta_cent) : null, texto: dsCol ? formatearMoneda(dsCol.venta_cent) : 'Sin dato' }, { id: 'inv', etiqueta: ORIGEN_SURTIDO.inventario_merida, valor: invCol ? aNum(invCol.venta_cent) : null, texto: invCol ? formatearMoneda(invCol.venta_cent) : 'Sin dato' }] },
    { id: 'piezas-origen', titulo: 'Piezas por origen del surtido', segmentos: [{ id: 'ds', etiqueta: ORIGEN_SURTIDO.dropshipping, valor: dsCol?.piezas ?? null, texto: dsCol ? formatearPiezas(dsCol.piezas) : 'Sin dato' }, { id: 'inv', etiqueta: ORIGEN_SURTIDO.inventario_merida, valor: invCol?.piezas ?? null, texto: invCol ? formatearPiezas(invCol.piezas) : 'Sin dato' }] },
    { id: 'piezas-tipo', titulo: 'Piezas movidas a proveedores: de clientes y a costo', segmentos: [{ id: 'cli', etiqueta: 'De clientes', valor: pm.de_clientes, texto: formatearPiezas(pm.de_clientes) }, { id: 'costo', etiqueta: 'A costo para socios', valor: pm.a_costo_socios, texto: formatearPiezas(pm.a_costo_socios) }] },
  ];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Dropshipping · ${etiquetaHoy()}`}
        titulo={hayDatos ? 'Pedidos surtidos por proveedor y desde Mérida, lado a lado' : 'Sin pedidos de dropshipping todavía'}
        descripcion="Dropshipping: el proveedor envía de su stock al cliente y nada entra a la bodega de Mérida. Cada cifra se explica."
        acciones={<Link className="rtm-boton rtm-boton-primario" href="/dropshipping/nuevo">Nuevo pedido</Link>}
      />
      <PestanasDs activa="resumen" sinFolio={r.sin_folio_externo} filtros={(
      <BarraFiltros etiquetaAria="Periodo y origen" extras={desde || hasta || origen ? <Chip href="/dropshipping">Quitar filtros</Chip> : undefined}>
        <form className="rtm-ds-filtros-linea" method="get" aria-label="Periodo">
          <FiltroPeriodo desde={desde} hasta={hasta} />
        </form>
        <Segmentado etiquetaAria="Origen del surtido" tamano="chico" opciones={[{ valor: '', etiqueta: 'Todos', href: enlace({ origen: '' }), activa: !origen }, { valor: 'dropshipping', etiqueta: 'Dropshipping', href: enlace({ origen: 'dropshipping' }), activa: origen === 'dropshipping' }, { valor: 'inventario_merida', etiqueta: 'Inventario en Mérida', href: enlace({ origen: 'inventario_merida' }), activa: origen === 'inventario_merida' }]} />
      </BarraFiltros>
      )} />

      <KpiLinea
        etiquetaAria="Indicadores de dropshipping"
        celdas={[
          { id: 'ds-pedidos', etiqueta: 'Pedidos enviados (dropshipping)', valor: cif('pedidos', 'dropshipping', String(dsCol?.pedidos ?? 0)), categoria: 1, nota: `${formatearPiezas(dsCol?.piezas ?? 0)} · en curso ${r.en_curso.find((e) => e.origen_surtido === 'dropshipping')?.pedidos ?? 0}`, testid: 'kpi-ds-pedidos' },
          { id: 'ds-venta', etiqueta: 'Venta (dropshipping)', valor: cif('venta', 'dropshipping', formatearMoneda(dsCol?.venta_cent ?? 0n)), categoria: 2, nota: `Costo total ${formatearMoneda(dsCol?.costo_cent ?? 0n)}` },
          { id: 'ds-margen', etiqueta: 'Utilidad (dropshipping)', valor: cif('margen', 'dropshipping', formatearMoneda(dsCol?.margen_cent ?? 0n)), categoria: 3, nota: 'Venta menos todo el costo del pedido' },
          { id: 'ds-karen', etiqueta: 'Por pagar a proveedores (libro)', valor: formatearMoneda(deudaLibro), categoria: 4, nota: [`Isaac ${formatearMoneda(deudaProv('Isaac'))} · Karen ${formatearMoneda(deudaProv('Karen'))} según el libro`, `Por pedido de dropshipping sin amortizar: ${formatearMoneda(porPagarPedidos)}${difPuente !== 0n ? ` (diferencia ${formatearMoneda(difPuente < 0n ? -difPuente : difPuente)}: compras de inventario y pagos no ligados a un pedido)` : ''}`, pendienteSocio > 0n ? `Incluye ${formatearMoneda(pendienteSocio)} de pedidos de ${socioMenudeo} pendientes (a su cuenta, no son deuda de la empresa)` : null].filter(Boolean).join(' · ') },
          { id: 'ds-cobrar', etiqueta: 'Por cobrar (dropshipping)', valor: cif('porcobrar', 'dropshipping', formatearMoneda(dsCol?.por_cobrar_cent ?? 0n)), categoria: 6, nota: `Intereses de crédito ${formatearMoneda(dsCol?.intereses_cent ?? 0n)}`, href: '/dropshipping/por-cobrar' },
          { id: 'ds-piezas', etiqueta: 'Piezas movidas a proveedores', valor: cif('piezas', 'dropshipping', formatearPiezas(pm.total)), categoria: 7, nota: `${formatearPiezas(pm.de_clientes)} de clientes · ${formatearPiezas(pm.a_costo_socios)} a costo para socios`, testid: 'kpi-piezas-movidas' },
        ]}
      />

      <Tarjeta titulo="Dropshipping frente a inventario en Mérida" descripcion="Pedidos enviados; el costo incluye producto, envío del proveedor y otros costos directos">
        <DataTable
          etiqueta="Desglose por origen"
          densidad="densa" plana
          clave={(c) => c.origen_surtido}
          filas={r.por_origen}
          totales={{ etiqueta: 'Total', celdas: { p: String(total((c) => BigInt(c.pedidos))), z: formatearPiezas(Number(total((c) => BigInt(c.piezas)))), v: cif('venta', 'todos', formatearMoneda(total((c) => c.venta_cent))), c: cif('costo', 'todos', formatearMoneda(total((c) => c.costo_cent))), m: cif('margen', 'todos', formatearMoneda(total((c) => c.margen_cent))), x: formatearMoneda(total((c) => c.por_cobrar_cent)) } }}
          columnas={[
            { id: 'o', titulo: 'Origen', prioridadMovil: 'titulo', ancho: 'xl', celda: (c) => <Link href={c.origen_surtido === 'dropshipping' ? '/dropshipping/pedidos' : '/pedidos?surtido=inventario_merida'}>{ORIGEN_SURTIDO[c.origen_surtido]}</Link> },
            { id: 'p', titulo: 'Pedidos', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (c) => String(c.pedidos) },
            { id: 'z', titulo: 'Piezas', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (c) => formatearPiezas(c.piezas) },
            { id: 'v', titulo: 'Venta', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (c) => cif('venta', c.origen_surtido, formatearMoneda(c.venta_cent)) },
            { id: 'c', titulo: 'Costo', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (c) => cif('costo', c.origen_surtido, formatearMoneda(c.costo_cent)) },
            { id: 'm', titulo: 'Utilidad', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (c) => cif('margen', c.origen_surtido, formatearMoneda(c.margen_cent)) },
            { id: 'x', titulo: 'Por cobrar', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'normal', celda: (c) => cif('porcobrar', c.origen_surtido, formatearMoneda(c.por_cobrar_cent)) },
            { id: 'y', titulo: 'Por pagar a proveedor', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'normal', celda: (c) => cif('porpagar', c.origen_surtido, formatearMoneda(c.por_pagar_cent)) },
          ]}
        />
      </Tarjeta>

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Piezas de dropshipping por semana" descripcion="Piezas surtidas por los proveedores, enviadas cada semana">
          {semanas.length >= 1 ? (
            <ColumnasPeriodo titulo="Piezas de dropshipping por semana" descripcion="Piezas surtidas por semana de envío; la última puede ser parcial." unidad="Piezas" procedencia="observado" pie="Fuente: libro de pedidos"
              datos={semanas.map((s) => ({ id: s.clave, etiqueta: s.clave.slice(5), valor: s.piezas, texto: formatearPiezas(s.piezas) }))} />
          ) : <p className="rtm-a1-estado-vacio">Sin pedidos de dropshipping todavía.</p>}
          {hayDatos && <Composicion etiquetaAria="Composición de los pedidos" grupos={gruposComp} />}
        </Tarjeta>
        <Tarjeta titulo="Piezas movidas a proveedores" descripcion="Incluye pedidos a costo para socios, que no generan utilidad">
          <div className="rtm-a1-cuerpo">
            <p className="rtm-a1-subtitulo">Por proveedor</p>
            {pm.por_proveedor.length ? <BarList etiquetaAria="Piezas por proveedor" items={pm.por_proveedor.map((p) => ({ id: p.proveedor, etiqueta: p.proveedor, texto: formatearPiezas(p.piezas), pct: pm.total > 0 ? (p.piezas / pm.total) * 100 : null, nota: `${p.pedidos} ${p.pedidos === 1 ? 'pedido' : 'pedidos'}` }))} /> : <p className="rtm-a1-estado-vacio">Sin pedidos de dropshipping todavía.</p>}
            <p className="rtm-a1-subtitulo">Por socio (a costo)</p>
            {pm.por_socio.length ? <BarList etiquetaAria="Piezas a costo por socio" items={pm.por_socio.map((s) => ({ id: s.socio, etiqueta: s.socio, texto: formatearPiezas(s.piezas), pct: pm.a_costo_socios > 0 ? (s.piezas / pm.a_costo_socios) * 100 : null, nota: `${s.pedidos} ${s.pedidos === 1 ? 'pedido' : 'pedidos'} · cobrado ${formatearMoneda(s.costo_cent)} (solo costo)` }))} /> : <p className="rtm-a1-estado-vacio">Ningún socio ha pedido a costo todavía.</p>}
          </div>
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Desglose" descripcion={PRODUCTO.has(dim) ? 'Por producto: venta de mercancía menos costo de la mercancía (sin envíos ni intereses)' : 'Por pedido enviado: venta menos todo el costo'}
        acciones={<Segmentado etiquetaAria="Agrupar por" tamano="chico" opciones={DIMENSIONES.map((x) => ({ valor: x.clave, etiqueta: x.texto, href: enlace({ dim: x.clave }), activa: x.clave === dim, testid: `ds-dim-${x.clave}` }))} />}>
        <DataTable<FilaDesglose>
          etiqueta={`Desglose por ${dim}`}
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar', porPagina: 50, exportar: 'dropshipping-desglose' }}
          clave={(f) => f.clave}
          filas={filas}
          vacio={{ titulo: 'Sin pedidos de dropshipping todavía', texto: 'Cuando se envíe el primer pedido aparecerá aquí el desglose.' }}
          columnas={[
            { id: 'e', titulo: DIMENSIONES.find((x) => x.clave === dim)?.texto ?? 'Grupo', prioridadMovil: 'titulo', ancho: 'xl', celda: (f) => f.etiqueta },
            { id: 'p', titulo: 'Pedidos', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (f) => String(f.pedidos) },
            { id: 'z', titulo: 'Piezas', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (f) => formatearPiezas(f.piezas) },
            { id: 'v', titulo: 'Venta', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => formatearMoneda(f.venta_cent) },
            { id: 'c', titulo: 'Costo', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => formatearMoneda(f.costo_cent) },
            { id: 'm', titulo: PRODUCTO.has(dim) ? 'Margen' : 'Utilidad', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => formatearMoneda(f.margen_cent) },
            { id: 'x', titulo: 'Por cobrar', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (f) => (f.por_cobrar_cent === undefined ? '' : formatearMoneda(f.por_cobrar_cent)) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
