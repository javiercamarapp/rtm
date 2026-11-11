import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { ModeloCatalogo } from '@/dominio/catalogo/tipos';
import { formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { GraficaBarras } from '@/ui/graficas/barras';
import { etiquetaHoy } from '../contexto';
import { BotonDisponibilidad } from './boton-disponibilidad';

export const metadata: Metadata = { title: 'Catálogo y precios' };

const costoDe = (m: ModeloCatalogo, prov: 'Isaac' | 'Karen') => m.costos.find((c) => c.proveedor === prov);

export default async function Pagina({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string; modelo?: string }> }) {
  const sp = await searchParams;
  const lector = await lectorDeSocio();
  const todos = await lector.modelos();
  const q = normalizar(sp.q ?? '');
  const filtro = sp.estado === 'sin_disponibilidad' || sp.estado === 'disponible' ? sp.estado : null;
  const modelos = todos.filter((m) => (!q || normalizar(`${m.marca} ${m.nombre} ${m.alias.join(' ')}`).includes(q)) && (!filtro || m.estado === filtro));
  const sinDisp = todos.filter((m) => m.estado === 'sin_disponibilidad').length;
  const elegidoId = Number(sp.modelo);
  const elegido = Number.isInteger(elegidoId) ? todos.find((m) => m.id === elegidoId) : undefined;
  const precios = elegido ? await lector.preciosDeModelo(elegido.id) : [];
  const mayor = precios.reduce<bigint>((a, p) => (p.precioCent > a ? p.precioCent : a), 0n);

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Catálogo y precios · ${etiquetaHoy()}`}
        antes="Catálogo de"
        enfasis={`${todos.length} modelos`}
        despues={sinDisp > 0 ? `y ${sinDisp} sin disponibilidad ahora` : ''}
        contexto="Costos de Isaac y de Karen con su vigencia, y el rango de precios del tabulador de cada cliente. Los nombres solo se unifican cuando son idénticos: lo demás son modelos distintos."
        acciones={<Link className="rtm-boton" href="/catalogo/costos" data-testid="ir-costos">Editar costos de Isaac y Karen</Link>}
      />
      <form className="rtm-barra-filtros" method="get" role="search" aria-label="Filtrar el catálogo">
        <input className="rtm-campo" type="search" name="q" defaultValue={sp.q ?? ''} placeholder="Buscar marca, modelo o alias" aria-label="Buscar en el catálogo" />
        <button type="submit" className="rtm-boton">Buscar</button>
        <Link className="rtm-chip-filtro" href="/catalogo" aria-current={!filtro}>Todos</Link>
        <Link className="rtm-chip-filtro" href="/catalogo?estado=disponible" aria-current={filtro === 'disponible'}>Disponibles</Link>
        <Link className="rtm-chip-filtro" href="/catalogo?estado=sin_disponibilidad" aria-current={filtro === 'sin_disponibilidad'}>Sin disponibilidad</Link>
      </form>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Modelos">
        <DataTable
          etiqueta="Modelos del catálogo"
          clave={(m) => m.id}
          filas={modelos}
          vacio={{ titulo: 'Sin resultados', texto: 'Ningún modelo coincide con el filtro.', accion: <Link className="rtm-boton" href="/catalogo">Quitar filtros</Link> }}
          columnas={[
            { id: 'marca', titulo: 'Marca', secundaria: true, celda: (m) => m.marca },
            { id: 'modelo', titulo: 'Modelo', celda: (m) => <Link href={`/catalogo?modelo=${m.id}#precios`}>{m.nombre}</Link> },
            { id: 'estado', titulo: 'Disponibilidad', celda: (m) => (m.estado === 'disponible' ? <EstadoTexto tono="ok">Disponible</EstadoTexto> : <EstadoTexto tono="atencion">Sin disponibilidad</EstadoTexto>) },
            { id: 'isaac', titulo: 'Costo Isaac', numerica: true, celda: (m) => { const c = costoDe(m, 'Isaac'); return c ? formatearMoneda(c.costoCent) : <SinDato />; } },
            { id: 'karen', titulo: 'Costo Karen', numerica: true, celda: (m) => { const c = costoDe(m, 'Karen'); return c ? <>{formatearMoneda(c.costoCent)} {c.supuesto && <EstadoTexto tono="atencion">supuesto</EstadoTexto>}</> : <SinDato />; } },
            { id: 'precios', titulo: 'Precios de clientes', numerica: true, celda: (m) => (m.precios.clientes === 0 || m.precios.minCent === null || m.precios.maxCent === null ? <SinDato /> : m.precios.minCent === m.precios.maxCent ? `${formatearMoneda(m.precios.minCent)} · ${m.precios.clientes} cl.` : `${formatearMoneda(m.precios.minCent)} a ${formatearMoneda(m.precios.maxCent)} · ${m.precios.clientes} cl.`) },
            { id: 'accion', titulo: 'Acción', celda: (m) => <BotonDisponibilidad modeloId={m.id} modelo={m.nombre} estado={m.estado} /> },
          ]}
        />
      </section>

      {elegido && (
        <section id="precios" className="rtm-seccion rtm-entra rtm-i-3" aria-label={`Precios de ${elegido.nombre}`}>
          <h2>Precios por cliente: {elegido.nombre}</h2>
          {elegido.estado === 'sin_disponibilidad' && <p className="rtm-nota">Este modelo está sin disponibilidad ahora; los precios de sus clientes se conservan.</p>}
          <DataTable
            etiqueta={`Precios de ${elegido.nombre} por cliente`}
            clave={(p) => p.clienteId}
            filas={precios}
            vacio={{ titulo: 'Ningún cliente tiene precio', texto: 'Este modelo todavía no está en el tabulador de nadie.' }}
            columnas={[
              { id: 'c', titulo: 'Cliente', celda: (p) => <Link href={`/clientes/${p.clienteId}`}>{p.cliente}</Link> },
              { id: 'd', titulo: 'Dueño', secundaria: true, celda: (p) => p.duenio },
              { id: 'p', titulo: 'Precio', numerica: true, celda: (p) => formatearMoneda(p.precioCent) },
              { id: 'mi', titulo: 'Margen vs Isaac', numerica: true, celda: (p) => { const m = p.margenes.find((x) => x.proveedor === 'Isaac'); return m ? <CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${p.clienteId}:${elegido.id}`} comprobacion="cuadra" /> : <SinDato />; } },
              { id: 'mk', titulo: 'Margen vs Karen', numerica: true, celda: (p) => { const m = p.margenes.find((x) => x.proveedor === 'Karen'); return m ? <><CifraComprobada texto={formatearMoneda(m.margenCent)} cifra={`margen:${p.clienteId}:${elegido.id}`} comprobacion="cuadra" /> {m.supuesto && <EstadoTexto tono="atencion">supuesto</EstadoTexto>}</> : <SinDato />; } },
            ]}
          />
          {precios.length >= 2 && (
            <GraficaBarras
              titulo={`Precio de ${elegido.nombre} por cliente`}
              unidad="Precio"
              descripcion={`Precio del tabulador de ${precios.length} clientes; el más alto está resaltado.`}
              datos={precios.map((p) => ({ etiqueta: p.cliente, valor: Number(p.precioCent), texto: formatearMoneda(p.precioCent), destacado: p.precioCent === mayor }))}
            />
          )}
        </section>
      )}
    </>
  );
}
