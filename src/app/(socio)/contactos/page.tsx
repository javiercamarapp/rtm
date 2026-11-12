import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorContactosDeSocio } from '@/composicion/contactos';
import { desplazamientoDePagina, etiquetaOrigen, type FiltroContactos, type ListaContactos, type ResumenContactos } from '@/dominio/contactos/vista';
import { formatearEntero } from '@/dominio/formato';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
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

export default async function Pagina({ searchParams }: { searchParams: Promise<Params> }) {
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
      antes="Tus"
      enfasis={resumen ? `${formatearEntero(resumen.total)} contactos` : 'contactos'}
      despues="de menudeo"
      contexto="Se segmentan por origen: Meta por anuncio, Toocloudy, Vapeunion y los lotes de Google. El teléfono sale oculto; al revelarlo o exportarlo queda registro. El agente de IA nunca ve teléfonos."
    />
  );

  if (fallo || !resumen || !lista) {
    return (
      <>
        {cabecera}
        <div className="rtm-dt-aviso" role="alert">
          <strong>No se pudo cargar</strong>
          <p>No se pudieron leer los contactos. Intenta de nuevo en un momento.</p>
          <Link className="rtm-boton" href="/contactos">Reintentar</Link>
        </div>
      </>
    );
  }

  if (resumen.total === 0) {
    return (
      <>
        {cabecera}
        <div className="rtm-dt-aviso">
          <strong>Sin contactos cargados</strong>
          <p>Todavía no se ha cargado ninguna base. La carga a producción la autoriza el dueño después de revisar los conteos.</p>
        </div>
      </>
    );
  }

  const pagina = desplazamiento / LIMITE + 1;
  const paginas = Math.max(1, Math.ceil(lista.total / LIMITE));
  const sinPagina = (o: string) => enlace({ busqueda: filtro.busqueda, origen: o, anuncio: '', colonia: filtro.colonia }, 1);

  return (
    <>
      {cabecera}
      <form className="rtm-barra-filtros" method="get" action="/contactos" role="search" aria-label="Buscar contactos">
        <label className="rtm-etiqueta-campo">
          Nombre, correo o dígitos del teléfono
          <input className="rtm-campo rtm-campo-ancho" type="search" name="q" defaultValue={filtro.busqueda} maxLength={80} />
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
        <Link className="rtm-boton" href="/contactos">Limpiar</Link>
      </form>
      <nav className="rtm-barra-filtros" aria-label="Filtrar por origen">
        <Link className="rtm-chip-filtro" href={sinPagina('')} aria-current={filtro.origen === ''}>Todos · {formatearEntero(resumen.total)}</Link>
        {resumen.porOrigen.map((o) => (
          <Link key={o.origen} className="rtm-chip-filtro" href={sinPagina(o.origen)} aria-current={filtro.origen === o.origen}>{etiquetaOrigen(o.origen)} · {formatearEntero(o.contactos)}</Link>
        ))}
      </nav>
      <p className="rtm-nota">
        {formatearEntero(lista.total)} {lista.total === 1 ? 'contacto coincide' : 'contactos coinciden'} · {formatearEntero(resumen.conCorreo)} con correo · {formatearEntero(resumen.conColonia)} con colonia · {formatearEntero(resumen.sinLada)} con número sin lada · {formatearEntero(resumen.correoCompartido)} con correo compartido por revisar · página {formatearEntero(pagina)} de {formatearEntero(paginas)}
      </p>
      <TablaContactos filas={lista.filas} total={lista.total} filtro={filtro} />
      <nav className="rtm-barra-filtros" aria-label="Páginas">
        {pagina > 1 && <Link className="rtm-boton" href={enlace(filtro, pagina - 1)}>Anterior</Link>}
        {pagina < paginas && <Link className="rtm-boton" href={enlace(filtro, pagina + 1)}>Siguiente</Link>}
      </nav>
    </>
  );
}
