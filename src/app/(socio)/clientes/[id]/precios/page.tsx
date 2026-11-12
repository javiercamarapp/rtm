import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lectorDeSocio } from '@/composicion/catalogo';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { fijarPrecioAccion } from '../../../alta/acciones';
import { etiquetaHoy } from '../../../contexto';
import { FormularioPrecio } from './formulario-precio';

export const metadata: Metadata = { title: 'Precios del cliente' };

export default async function PaginaPreciosCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ modelo?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const lector = await lectorDeSocio();
  const [f, modelos] = await Promise.all([lector.ficha(n), lector.modelos()]);
  if (!f) notFound();
  const vigentes = new Map(f.tabulador.map((t) => [t.modeloId, t]));
  const paraForm = modelos.map((m) => {
    const t = vigentes.get(m.id);
    return { id: m.id, nombre: `${m.marca} ${m.nombre}`, actual: t ? { cent: t.precioCent.toString(), desde: t.desde } : null };
  });
  const elegido = Number(sp.modelo);

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: `/clientes/${f.id}`, texto: f.nombre }}
        eyebrow={`Precios del cliente · ${etiquetaHoy()}`}
        titulo={`Tabulador de ${f.nombre}`}
        descripcion="Un precio nuevo empieza en una fecha y el anterior pasa al historial; nada se borra ni se corrige hacia atrás. Un precio de una nota no cambia el tabulador: solo cambia aquí."
        acciones={<Link className="rtm-boton" href={`/clientes/${f.id}/editar`}>Editar datos del cliente</Link>}
      />

      <Tarjeta plana titulo="Precios vigentes" descripcion={`${f.tabulador.length} ${f.tabulador.length === 1 ? 'modelo con precio' : 'modelos con precio'}`}>
        <DataTable
          plana
          densidad="densa"
          etiqueta={`Precios vigentes de ${f.nombre}`}
          clave={(t) => t.modeloId}
          filas={f.tabulador}
          vacio={{ titulo: 'Sin precios todavía', texto: 'Este cliente aún no tiene precio en ningún modelo. Usa el formulario de abajo para fijar el primero.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (t) => t.modelo },
            { id: 'p', titulo: 'Precio', numerica: true, prioridadMovil: 'principal', celda: (t) => <CifraComprobada texto={formatearMoneda(t.precioCent)} cifra={`margen:${f.id}:${t.modeloId}`} comprobacion="cuadra" /> },
            { id: 'mi', titulo: 'Margen vs Isaac', numerica: true, secundaria: true, celda: (t) => { const m = t.margenes.find((x) => x.proveedor === 'Isaac'); return m ? formatearMoneda(m.margenCent) : <SinDato />; } },
            { id: 'd', titulo: 'Vale desde', secundaria: true, celda: (t) => etiquetaFecha(t.desde) },
            { id: 'a', titulo: 'Acción', celda: (t) => <Link href={`/clientes/${f.id}/precios?modelo=${t.modeloId}#cambiar`}>Cambiar</Link> },
          ]}
        />
      </Tarjeta>

      <Tarjeta titulo="Fijar o cambiar un precio" descripcion="El precio anterior pasa al historial" className="rtm-ancla">
        <span id="cambiar" className="rtm-ancla-punto" />
        <FormularioPrecio key={sp.modelo ?? ''} clienteId={f.id} clienteNombre={f.nombre} modelos={paraForm} hoy={fechaNeg(new Date())} {...(Number.isInteger(elegido) ? { modeloInicial: elegido } : {})} accion={fijarPrecioAccion} />
      </Tarjeta>

      <Tarjeta plana titulo="Historial de precios" descripcion={`${f.historial.length} ${f.historial.length === 1 ? 'registro' : 'registros'}`}>
        <DataTable
          plana
          densidad="densa"
          etiqueta={`Historial de precios de ${f.nombre}`}
          clave={(h) => `${h.modelo}-${h.desde}-${h.precioCent}-${h.externo}`}
          filas={f.historial}
          vacio={{ titulo: 'Sin historial', texto: 'Aún no se ha registrado ningún precio.' }}
          columnas={[
            { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (h) => h.modelo },
            { id: 'p', titulo: 'Precio', numerica: true, prioridadMovil: 'principal', celda: (h) => formatearMoneda(h.precioCent) },
            { id: 'd', titulo: 'Desde', celda: (h) => etiquetaFecha(h.desde) },
            { id: 'h', titulo: 'Hasta', secundaria: true, celda: (h) => (h.hasta ? etiquetaFecha(h.hasta) : '—') },
            { id: 'n', titulo: 'Nota', secundaria: true, celda: (h) => h.nota ?? '—' },
            { id: 'e', titulo: 'Estado', celda: (h) => (h.externo ? <EstadoTexto tono="atencion">Solo referencia</EstadoTexto> : h.vigente ? <EstadoTexto tono="ok">Vigente</EstadoTexto> : <EstadoTexto tono="neutro">Reemplazado</EstadoTexto>) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
