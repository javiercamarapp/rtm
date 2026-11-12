import type { Metadata } from 'next';
import Link from 'next/link';
import type { CostoHistorico } from '@/aplicacion/catalogo/alta';
import { altaDeSocio, lectorDeSocio } from '@/composicion/catalogo';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { Aviso } from '@/ui/componentes/controles';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { fijarCostoAccion } from '../../alta/acciones';
import { etiquetaHoy } from '../../contexto';
import { FormularioCosto } from './formulario-costo';

export const metadata: Metadata = { title: 'Costos de Isaac y Karen' };

export default async function PaginaCostosCatalogo({ searchParams }: { searchParams: Promise<{ modelo?: string; p?: string }> }) {
  const sp = await searchParams;
  const modelos = await (await lectorDeSocio()).modelos();
  const elegidoId = Number(sp.modelo);
  const elegido = Number.isInteger(elegidoId) ? modelos.find((m) => m.id === elegidoId) : undefined;
  const proveedor = sp.p === 'Karen' ? 'Karen' : 'Isaac';

  // El historial viene de una funcion que quiza aun no esta instalada: si falla, la pantalla lo dice y sigue funcionando.
  let historial: CostoHistorico[] | null = null;
  if (elegido) {
    try {
      historial = await (await altaDeSocio()).historialCostos(elegido.id);
    } catch {
      historial = null;
    }
  }

  const paraForm = modelos.map((m) => ({
    id: m.id,
    nombre: `${m.marca} ${m.nombre}`,
    vigentes: Object.fromEntries(m.costos.filter((c) => c.esLista).map((c) => [c.proveedor, { cent: c.costoCent.toString(), desde: c.desde }])),
  }));
  const costo = (m: (typeof modelos)[number], p: 'Isaac' | 'Karen') => m.costos.find((c) => c.proveedor === p);

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/catalogo', texto: 'Catálogo y precios' }}
        eyebrow={`Costos · ${etiquetaHoy()}`}
        titulo="Costos de Isaac y Karen"
        descripcion="Cada costo vale desde una fecha; el anterior se cierra ese día y queda en el historial. El costo de lista es el normal del proveedor; cualquier otro lleva su motivo."
      />

      <Tarjeta plana titulo="Costos vigentes por modelo" descripcion={`${modelos.length} modelos`}>
        <DataTable
          plana
          densidad="densa"
          pegajosa
          etiqueta="Costos vigentes por modelo"
          clave={(m) => m.id}
          filas={modelos}
          vacio={{ titulo: 'Sin modelos', texto: 'Primero se carga el catálogo.', accion: <Link className="rtm-boton" href="/catalogo">Ir al catálogo</Link> }}
          columnas={[
            { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (m) => `${m.marca} ${m.nombre}` },
            { id: 'i', titulo: 'Isaac', numerica: true, prioridadMovil: 'normal', celda: (m) => { const c = costo(m, 'Isaac'); return c ? <>{formatearMoneda(c.costoCent)}<span className="rtm-celda-sub">desde {etiquetaFecha(c.desde)}{c.supuesto ? ' · supuesto' : ''}</span></> : <SinDato />; } },
            { id: 'k', titulo: 'Karen', numerica: true, prioridadMovil: 'normal', celda: (m) => { const c = costo(m, 'Karen'); return c ? <>{formatearMoneda(c.costoCent)}<span className="rtm-celda-sub">desde {etiquetaFecha(c.desde)}{c.supuesto ? ' · supuesto' : ''}</span></> : <SinDato />; } },
            { id: 'a', titulo: 'Acción', celda: (m) => <Link href={`/catalogo/costos?modelo=${m.id}&p=${proveedor}#cambiar`}>Cambiar o ver historial</Link> },
          ]}
        />
      </Tarjeta>

      <Tarjeta titulo="Fijar o cambiar un costo" descripcion="El anterior se cierra el día anterior" className="rtm-ancla">
        <span id="cambiar" className="rtm-ancla-punto" />
        <FormularioCosto key={`${sp.modelo ?? ''}-${proveedor}`} modelos={paraForm} hoy={fechaNeg(new Date())} proveedorInicial={proveedor} {...(elegido ? { modeloInicial: elegido.id } : {})} accion={fijarCostoAccion} />
      </Tarjeta>

      {elegido && (
        <Tarjeta plana titulo={`Historial de costos: ${elegido.marca} ${elegido.nombre}`}>
          {historial === null ? (
            <div data-testid="historial-pendiente">
              <Aviso tono="atencion" titulo="Historial no disponible todavía">La base aún no tiene la función que lista el historial de costos (ver docs/pendiente-sql-alta.md). Los costos vigentes de arriba sí son correctos.</Aviso>
            </div>
          ) : (
            <DataTable
              plana
              densidad="densa"
              etiqueta={`Historial de costos de ${elegido.nombre}`}
              clave={(h) => `${h.proveedor}-${h.desde}-${h.costoCent}`}
              filas={historial}
              vacio={{ titulo: 'Sin historial', texto: 'Este modelo aún no tiene costos registrados.' }}
              columnas={[
                { id: 'p', titulo: 'Proveedor', celda: (h) => h.proveedor },
                { id: 'c', titulo: 'Costo', numerica: true, celda: (h) => formatearMoneda(h.costoCent) },
                { id: 'd', titulo: 'Desde', celda: (h) => etiquetaFecha(h.desde) },
                { id: 'h', titulo: 'Hasta', secundaria: true, celda: (h) => (h.hasta ? etiquetaFecha(h.hasta) : '—') },
                { id: 'f', titulo: 'Fuente', secundaria: true, celda: (h) => <>{h.fuente}{h.motivo && <span className="rtm-celda-sub">{h.motivo}</span>}</> },
                { id: 'e', titulo: 'Estado', celda: (h) => (h.vigente ? <EstadoTexto tono="ok">Vigente</EstadoTexto> : <EstadoTexto tono="neutro">Reemplazado</EstadoTexto>) },
              ]}
            />
          )}
        </Tarjeta>
      )}
    </Pagina>
  );
}
