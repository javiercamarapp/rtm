import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { ModeloCatalogo } from '@/dominio/catalogo/tipos';
import { formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { ModeloMiniatura } from '@/ui/componentes/modelo';
import { ChipEstado } from '@/ui/componentes/controles';
import { FiltroCatalogo } from '@/ui/componentes/filtro-catalogo';
import { atajosDeMarcas, marcasDeParam } from '@/dominio/catalogo/filtro';
import { BarList } from '@/ui/componentes/datos';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { aNumero, porcentaje } from '@/dominio/tablero/agregados';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../contexto';
import { BotonDisponibilidad } from './boton-disponibilidad';
import { SaboresPorRevisar } from './sabores-por-revisar';

export const metadata: Metadata = { title: 'Catálogo y precios' };

const costoDe = (m: ModeloCatalogo, prov: 'Isaac' | 'Karen') => m.costos.find((c) => c.proveedor === prov);

export default async function PaginaCatalogo({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string; modelo?: string; marca?: string }> }) {
  const sp = await searchParams;
  const lector = await lectorDeSocio();
  const todos = await lector.modelos();
  const q = normalizar(sp.q ?? '');
  const filtro = sp.estado === 'sin_disponibilidad' || sp.estado === 'disponible' ? sp.estado : null;
  const elegidas = marcasDeParam(sp.marca);
  const marcas = [...new Set(todos.map((m) => m.marca))].sort();
  const modelos = todos.filter((m) => (!q || normalizar(`${m.marca} ${m.nombre} ${m.alias.join(' ')}`).includes(q)) && (!filtro || m.estado === filtro) && (elegidas.length === 0 || elegidas.includes(m.marca)));
  const sinDisp = todos.filter((m) => m.estado === 'sin_disponibilidad').length;
  const sinPrecio = todos.filter((m) => m.precios.clientes === 0).length;
  const supuestos = todos.flatMap((m) => m.costos).filter((c) => c.supuesto).length;
  const sinCosto = todos.filter((m) => m.costos.length === 0).length;
  const elegidoId = Number(sp.modelo);
  const elegido = Number.isInteger(elegidoId) ? todos.find((m) => m.id === elegidoId) : undefined;
  const precios = elegido ? await lector.preciosDeModelo(elegido.id) : [];
  const mayor = precios.reduce<bigint>((a, p) => (p.precioCent > a ? p.precioCent : a), 0n);
  const enlace = (c: Record<string, string>) => {
    const u = new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(filtro ? { estado: filtro } : {}), ...(elegidas.length ? { marca: elegidas.join(',') } : {}), ...c });
    for (const [k, v] of [...u.entries()]) if (!v) u.delete(k);
    return u.size ? `/catalogo?${u.toString()}` : '/catalogo';
  };
  const opcionesMarca = marcas.map((nombre) => ({ nombre, cuenta: todos.filter((m) => m.marca === nombre).length }));
  // Atajos: las marcas con mas clientes con precio en el tabulador (demanda observada en el catalogo), maximo 5.
  const atajos = atajosDeMarcas(new Map(marcas.map((nombre) => [nombre, todos.filter((m) => m.marca === nombre).reduce((a, m) => a + m.precios.clientes, 0)])));
  const conRango = modelos.filter((m) => m.precios.maxCent !== null && m.precios.minCent !== null);
  const topeRango = conRango.reduce((a, m) => Math.max(a, aNumero(m.precios.maxCent!)), 0);
  const conMargen = modelos.flatMap((m) => {
    const c = m.costos.find((x) => x.proveedor === 'Isaac') ?? m.costos[0];
    return c && m.precios.maxCent !== null ? [{ m, costo: c.costoCent, precio: m.precios.maxCent, supuesto: c.supuesto }] : [];
  });
  const topeCosto = conMargen.reduce((a, x) => Math.max(a, aNumero(x.precio)), 0);

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Catálogo y precios · ${etiquetaHoy()}`}
        titulo={`${todos.length} modelos en el catálogo`}
        acciones={<Link className="rtm-boton" href="/catalogo/costos" data-testid="ir-costos">Editar costos de Isaac y Karen</Link>}
        descripcion={`${sinDisp > 0 ? `${sinDisp} sin disponibilidad ahora · ` : ''}${sinPrecio} sin precio de cliente · ${supuestos} ${supuestos === 1 ? 'costo supuesto' : 'costos supuestos'}. Costos y márgenes solo los ven los socios.`}
      />
      <FiltroCatalogo
        etiquetaAria="Filtrar el catálogo"
        etiquetaBusqueda="Buscar en el catálogo"
        marcas={opcionesMarca}
        atajos={atajos}
        segmentos={{ parametro: 'estado', etiquetaAria: 'Disponibilidad', opciones: [{ valor: '', etiqueta: 'Todos' }, { valor: 'disponible', etiqueta: 'Disponibles' }, { valor: 'sin_disponibilidad', etiqueta: 'Sin disponibilidad' }] }}
        limpiar={['modelo']}
      />
      <KpiLinea
        etiquetaAria="Indicadores del catálogo"
        celdas={[
          { id: 'modelos', etiqueta: 'Modelos', valor: String(todos.length), categoria: 1, nota: `${marcas.length} ${marcas.length === 1 ? 'marca' : 'marcas'} · ${modelos.length} en el filtro` },
          { id: 'sinprecio', etiqueta: 'Sin precio de cliente', valor: String(sinPrecio), categoria: 4, nota: sinPrecio ? 'Ningún tabulador los incluye' : 'Todos tienen precio' },
          { id: 'supuestos', etiqueta: 'Costos supuestos', valor: String(supuestos), categoria: 6, nota: 'Estimado: costo aún sin documento del proveedor' },
          { id: 'nodisp', etiqueta: 'No disponibles', valor: String(sinDisp), categoria: 8, nota: `${todos.length - sinDisp} disponibles ahora` },
        ]}
      />
      <FilaRatios etiqueta="Razones del catálogo" items={[{ etiqueta: 'Disponibilidad', valor: todos.length ? `${(((todos.length - sinDisp) / todos.length) * 100).toFixed(0)} %` : null }, { etiqueta: 'Con precio', valor: todos.length ? `${(((todos.length - sinPrecio) / todos.length) * 100).toFixed(0)} %` : null }, { etiqueta: 'Sin costo vigente', valor: String(sinCosto) }, { etiqueta: 'Con alias', valor: String(todos.filter((m) => m.alias.length > 0).length) }]} />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Costo contra precio más alto" descripcion="Costo vigente (Isaac, o el único proveedor) y el precio máximo del tabulador">
          {conMargen.length > 0 ? (
            <BarList
              etiquetaAria="Costo contra precio por modelo" mostrarPct={false}
              items={conMargen.slice(0, 10).map((x) => ({ id: String(x.m.id), etiqueta: x.m.nombre, href: enlace({ modelo: String(x.m.id) }) + '#precios', texto: `${formatearMoneda(x.costo)} → ${formatearMoneda(x.precio)}`, pct: porcentaje(aNumero(x.costo), topeCosto), umbral: porcentaje(aNumero(x.precio), topeCosto) ?? undefined, nota: `margen ${formatearMoneda(x.precio - x.costo)}${x.supuesto ? ' · costo supuesto' : ''}`, tono: x.precio <= x.costo ? ('malo' as const) : undefined }))}
            />
          ) : <p className="rtm-a1-estado-vacio">Sin modelos con costo y precio al mismo tiempo.</p>}
        </Tarjeta>
        <Tarjeta titulo="Rango de precios" descripcion="Mínimo a máximo y clientes con precio">
          {conRango.length > 0 ? (
            <BarList etiquetaAria="Rango de precios por modelo" mostrarPct={false} items={conRango.slice(0, 10).map((m) => ({ id: String(m.id), etiqueta: m.nombre, texto: m.precios.minCent === m.precios.maxCent ? formatearMoneda(m.precios.minCent!) : `${formatearMoneda(m.precios.minCent!)} a ${formatearMoneda(m.precios.maxCent!)}`, pct: porcentaje(aNumero(m.precios.maxCent!), topeRango), nota: `${m.precios.clientes} cl.` }))} />
          ) : <p className="rtm-a1-estado-vacio">Ningún modelo tiene precios de clientes.</p>}
        </Tarjeta>
      </Rejilla>

      <SaboresPorRevisar />

      <Tarjeta plana titulo="Modelos" descripcion={`${modelos.length} de ${todos.length}`}>
        <DataTable
          etiqueta="Modelos del catálogo" densidad="densa" plana pegajosa primeraFija interactiva={{ porPagina: 50, exportar: 'catalogo' }}
          clave={(m) => m.id} filas={modelos}
          vacio={{ titulo: 'Sin resultados', texto: 'Ningún modelo coincide con el filtro.', accion: <Link className="rtm-boton" href="/catalogo">Quitar filtros</Link> }}
          columnas={[
            { id: 'marca', titulo: 'Marca', ancho: 'm', secundaria: true, celda: (m) => m.marca },
            { id: 'modelo', titulo: 'Modelo', ancho: 'xl', celda: (m) => <span className="rtm-modelo-tarjeta" data-tam="xs"><ModeloMiniatura modelo={m.nombre} marca={m.marca} tam="xs" /><Link href={`/catalogo?modelo=${m.id}#precios`}>{m.nombre}</Link></span> },
            { id: 'estado', titulo: 'Disponibilidad', ancho: 'l', celda: (m) => (m.estado === 'disponible' ? <ChipEstado tono="ok">Disponible</ChipEstado> : <ChipEstado tono="atencion">Sin disponibilidad</ChipEstado>) },
            { id: 'isaac', titulo: 'Costo Isaac', numerica: true, ancho: 'm', celda: (m) => { const c = costoDe(m, 'Isaac'); return c ? formatearMoneda(c.costoCent) : <SinDato />; } },
            { id: 'karen', titulo: 'Costo Karen', numerica: true, ancho: 'm', celda: (m) => { const c = costoDe(m, 'Karen'); return c ? <>{formatearMoneda(c.costoCent)} {c.supuesto && <EstadoTexto tono="atencion">supuesto</EstadoTexto>}</> : <SinDato />; } },
            { id: 'precios', titulo: 'Precios de clientes', numerica: true, ancho: 'xl', celda: (m) => (m.precios.clientes === 0 || m.precios.minCent === null || m.precios.maxCent === null ? <SinDato /> : m.precios.minCent === m.precios.maxCent ? `${formatearMoneda(m.precios.minCent)} · ${m.precios.clientes} cl.` : `${formatearMoneda(m.precios.minCent)} a ${formatearMoneda(m.precios.maxCent)} · ${m.precios.clientes} cl.`) },
            { id: 'accion', titulo: 'Acción', ancho: 'l', celda: (m) => <BotonDisponibilidad modeloId={m.id} modelo={m.nombre} estado={m.estado} /> },
          ]}
        />
      </Tarjeta>

      {elegido && (
        <Tarjeta plana titulo={`Precios por cliente: ${elegido.nombre}`} descripcion={`${precios.length} clientes`} className="rtm-a1-precios">
          <section id="precios" aria-label={`Precios de ${elegido.nombre}`}>
            {elegido.estado === 'sin_disponibilidad' && <p className="rtm-a1-nota">Este modelo está sin disponibilidad ahora; los precios de sus clientes se conservan.</p>}
            <DataTable
              etiqueta={`Precios de ${elegido.nombre} por cliente`} densidad="densa" plana primeraFija clave={(p) => p.clienteId} filas={precios}
              vacio={{ titulo: 'Ningún cliente tiene precio', texto: 'Este modelo todavía no está en el tabulador de nadie.' }}
              columnas={[
                { id: 'c', titulo: 'Cliente', ancho: 'xl', celda: (p) => <Link href={`/clientes/${p.clienteId}`}>{p.cliente}</Link> },
                { id: 'p', titulo: 'Precio', numerica: true, ancho: 'm', celda: (p) => formatearMoneda(p.precioCent) },
                { id: 'mi', titulo: 'Margen vs Isaac', numerica: true, ancho: 'm', celda: (p) => { const m = p.margenes.find((x) => x.proveedor === 'Isaac'); return m ? <CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${p.clienteId}:${elegido.id}`} comprobacion="cuadra" /> : <SinDato />; } },
                { id: 'mk', titulo: 'Margen vs Karen', numerica: true, ancho: 'm', celda: (p) => { const m = p.margenes.find((x) => x.proveedor === 'Karen'); return m ? <><CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${p.clienteId}:${elegido.id}`} comprobacion="cuadra" /> {m.supuesto && <EstadoTexto tono="atencion">supuesto</EstadoTexto>}</> : <SinDato />; } },
                { id: 'd', titulo: 'Más alto', ancho: 's', celda: (p) => (p.precioCent === mayor && precios.length >= 2 ? <ChipEstado tono="info">Máximo</ChipEstado> : '') },
              ]}
            />
          </section>
        </Tarjeta>
      )}
    </Pagina>
  );
}
