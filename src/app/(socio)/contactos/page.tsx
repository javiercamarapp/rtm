import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorContactosDeSocio } from '@/composicion/contactos';
import { desplazamientoDePagina, etiquetaOrigen, type FiltroContactos, type ListaContactos, type ResumenContactos } from '@/dominio/contactos/vista';
import { formatearEntero } from '@/dominio/formato';
import { Chip } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, EstadoError, EstadoVacio, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';
import { TablaContactos } from './tabla-contactos';

export const metadata: Metadata = { title: 'Contactos' };

const LIMITE = 50;
type Params = { q?: string; origen?: string; anuncio?: string; colonia?: string; pag?: string };

function enlace(f: FiltroContactos, pag: number): string {
  const p = new URLSearchParams();
  if (f.busqueda) p.set('q', f.busqueda);
  if (f.origen) p.set('origen', f.origen);
  if (f.anuncio) p.set('anuncio', f.anuncio);
  if (f.colonia) p.set('colonia', f.colonia);
  if (pag > 1) p.set('pag', String(pag));
  const s = p.toString();
  return s ? `/contactos?${s}` : '/contactos';
}

export default async function PaginaContactos({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const filtro: FiltroContactos = { busqueda: (sp.q ?? '').trim().slice(0, 80), origen: (sp.origen ?? '').slice(0, 80), anuncio: (sp.anuncio ?? '').slice(0, 200), colonia: (sp.colonia ?? '').trim().slice(0, 120) };
  const desplazamiento = desplazamientoDePagina(sp.pag, LIMITE);
  const lector = await lectorContactosDeSocio();

  let resumen: ResumenContactos | null = null;
  let lista: ListaContactos | null = null;
  let fallo = false;
  try {
    [resumen, lista] = await Promise.all([lector.resumen(), lector.lista(filtro, LIMITE, desplazamiento)]);
  } catch {
    fallo = true;
  }

  const cabecera = (
    <EncabezadoPagina
      eyebrow={`Contactos · ${etiquetaHoy()}`}
      titulo={resumen ? `${formatearEntero(resumen.total)} contactos de menudeo` : 'Contactos de menudeo'}
      descripcion="Segmentados por origen: Meta por anuncio, Toocloudy, Vapeunion y lotes de Google. El teléfono sale oculto; revelarlo o exportarlo deja registro. El agente de IA nunca ve teléfonos."
    />
  );

  if (fallo || !resumen || !lista) {
    return (
      <Pagina ancho="normal">
        {cabecera}
        <EstadoError texto="No se pudieron leer los contactos. Intenta de nuevo en un momento." accion={<Link className="rtm-boton" href="/contactos">Reintentar</Link>} />
      </Pagina>
    );
  }

  if (resumen.total === 0) {
    return (
      <Pagina ancho="normal">
        {cabecera}
        <EstadoVacio titulo="Sin contactos cargados" texto="Todavía no se ha cargado ninguna base. La carga a producción la autoriza el dueño después de revisar los conteos." />
      </Pagina>
    );
  }

  const pagina = desplazamiento / LIMITE + 1;
  const paginas = Math.max(1, Math.ceil(lista.total / LIMITE));
  const sinPagina = (o: string) => enlace({ busqueda: filtro.busqueda, origen: o, anuncio: '', colonia: filtro.colonia }, 1);
  const pctDe = (n: number) => (resumen.total > 0 ? (n / resumen.total) * 100 : null);
  const anuncios = resumen.porAnuncio.slice(0, 6);
  const maxAnuncio = anuncios.reduce((a, x) => Math.max(a, x.contactos), 0);

  return (
    <Pagina ancho="tablero">
      {cabecera}
      <KpiLinea
        etiquetaAria="Resumen de contactos"
        celdas={[
          { id: 'tot', etiqueta: 'Contactos', valor: formatearEntero(resumen.total), categoria: 1, nota: `${formatearEntero(lista.total)} con este filtro` },
          { id: 'cor', etiqueta: 'Con correo', valor: formatearEntero(resumen.conCorreo), categoria: 3, progreso: { pct: pctDe(resumen.conCorreo) ?? 0 }, nota: `${formatearEntero(resumen.correoCompartido)} con correo compartido` },
          { id: 'col', etiqueta: 'Con colonia', valor: formatearEntero(resumen.conColonia), categoria: 4, progreso: { pct: pctDe(resumen.conColonia) ?? 0 }, nota: `${formatearEntero(resumen.coloniaEnConflicto)} en conflicto` },
          { id: 'lad', etiqueta: 'Teléfono sin lada', valor: formatearEntero(resumen.sinLada), categoria: 6, nota: 'Revisar antes de contactar' },
        ]}
      />
      <Tarjeta titulo="Buscar" descripcion={`${formatearEntero(lista.total)} ${lista.total === 1 ? 'contacto coincide' : 'contactos coinciden'}`} acciones={<Chip href="/contactos">Limpiar</Chip>}>
        <form className="rtm-filtros-linea" method="get" action="/contactos" role="search" aria-label="Buscar contactos">
          <label className="rtm-etiqueta-campo">
            Nombre, correo o teléfono
            <input className="rtm-campo rtm-campo-ancho" type="search" name="q" placeholder="Nombre, correo o dígitos" defaultValue={filtro.busqueda} maxLength={80} />
          </label>
          <label className="rtm-etiqueta-campo">
            Origen
            <select className="rtm-campo" name="origen" defaultValue={filtro.origen}>
              <option value="">Todos</option>
              <option value="google-lote">Google (todos los lotes)</option>
              {resumen.porOrigen.map((o) => <option key={o.origen} value={o.origen}>{etiquetaOrigen(o.origen)} ({formatearEntero(o.contactos)})</option>)}
            </select>
          </label>
          {resumen.porAnuncio.length > 0 && (
            <label className="rtm-etiqueta-campo">
              Anuncio de Meta
              <select className="rtm-campo" name="anuncio" defaultValue={filtro.anuncio}>
                <option value="">Todos</option>
                {[...new Set(resumen.porAnuncio.map((a) => a.anuncio))].map((a) => <option key={a} value={a}>{a || 'Sin anuncio'}</option>)}
              </select>
            </label>
          )}
          <label className="rtm-etiqueta-campo">
            Colonia
            <input className="rtm-campo" type="search" name="colonia" list="colonias-contactos" defaultValue={filtro.colonia} maxLength={120} />
            <datalist id="colonias-contactos">
              {resumen.porColonia.map((c) => <option key={c.colonia} value={c.colonia}>{formatearEntero(c.contactos)}</option>)}
            </datalist>
          </label>
          <button type="submit" className="rtm-boton rtm-boton-primario">Buscar</button>
        </form>
      </Tarjeta>
      <Rejilla dividir="12">
        <Tarjeta plana titulo="Contactos" descripcion={`Página ${pagina} de ${paginas}`}>
          <TablaContactos filas={lista.filas} total={lista.total} filtro={filtro} />
          <nav className="rtm-paginador" aria-label="Páginas">
            <span>Mostrando {lista.filas.length} de {formatearEntero(lista.total)}</span>
            <span className="rtm-paginador-botones">
              {pagina > 1 ? <Link className="rtm-boton rtm-boton-chico" href={enlace(filtro, pagina - 1)}>Anterior</Link> : <span className="rtm-boton rtm-boton-chico" aria-disabled="true">Anterior</span>}
              {pagina < paginas ? <Link className="rtm-boton rtm-boton-chico" href={enlace(filtro, pagina + 1)}>Siguiente</Link> : <span className="rtm-boton rtm-boton-chico" aria-disabled="true">Siguiente</span>}
            </span>
          </nav>
        </Tarjeta>
      </Rejilla>
      <Rejilla dividir="6-6" alinear="inicio">
        <>
          <Tarjeta titulo="Por origen" descripcion="Un clic filtra la lista">
            <BarList etiquetaAria="Contactos por origen" items={resumen.porOrigen.map((o) => ({ id: o.origen, etiqueta: etiquetaOrigen(o.origen), texto: formatearEntero(o.contactos), pct: pctDe(o.contactos), href: sinPagina(o.origen) }))} />
          </Tarjeta>
          {anuncios.length > 0 && (
            <Tarjeta titulo="Por anuncio de Meta" descripcion="Los seis con más contactos">
              <BarList etiquetaAria="Contactos por anuncio" items={anuncios.map((a) => ({ id: `${a.anuncio}-${a.formulario}`, etiqueta: a.anuncio || 'Sin anuncio', nota: a.formulario || undefined, texto: formatearEntero(a.contactos), pct: maxAnuncio > 0 ? (a.contactos / maxAnuncio) * 100 : null }))} />
            </Tarjeta>
          )}
        </>
      </Rejilla>
    </Pagina>
  );
}
