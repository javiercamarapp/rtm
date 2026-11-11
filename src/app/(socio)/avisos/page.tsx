import type { Metadata } from 'next';
import Link from 'next/link';
import { notificacionesDeSocio } from '@/composicion/inventario';
import { etiquetaFechaHora } from '@/dominio/formato';
import { destinoAviso } from '@/dominio/notificaciones/tipos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';
import { SEVERIDAD } from '../operacion/etiquetas';
import { BotonLeido } from './boton-leido';

export const metadata: Metadata = { title: 'Avisos' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ pestana?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const pestana = sp.pestana === 'sin_leer' ? 'sin_leer' : 'todas';
  const pagina = Number(sp.pagina) > 0 ? Math.floor(Number(sp.pagina)) : 0;
  const lista = await (await notificacionesDeSocio()).mis(pestana, pagina);
  const enlace = (p: string, n = 0) => `/avisos?pestana=${p}${n > 0 ? `&pagina=${n}` : ''}`;
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Avisos · ${etiquetaHoy()}`}
        antes={lista.notificaciones.length === 0 ? 'No hay' : 'Tienes'}
        enfasis={lista.notificaciones.length === 0 ? 'avisos' : `${lista.sin_leer} sin leer`}
        contexto="La campana es la fuente de verdad: Telegram solo la espeja. Cada aviso nace en la misma operación que lo provoca; leído y resuelto son cosas distintas, y un aviso con acción sigue pendiente hasta que la condición deja de existir."
      />
      <div className="rtm-barra-filtros" aria-label="Pestañas de avisos">
        <Link className="rtm-chip-filtro" href={enlace('todas')} aria-current={pestana === 'todas'} data-testid="avisos-todas">Todas</Link>
        <Link className="rtm-chip-filtro" href={enlace('sin_leer')} aria-current={pestana === 'sin_leer'} data-testid="avisos-sin-leer">Sin leer ({lista.sin_leer})</Link>
      </div>
      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Lista de avisos">
        <DataTable
          etiqueta="Avisos"
          clave={(a) => a.id}
          filas={lista.notificaciones}
          vacio={{ titulo: pestana === 'sin_leer' ? 'No tienes avisos sin leer' : 'Sin avisos', texto: 'Los avisos aparecen cuando una operación necesita atención: una diferencia de recepción, un paquete por empacar, un pago sin identificar, un conteo con diferencia...' }}
          columnas={[
            { id: 's', titulo: 'Severidad', celda: (a) => <EstadoTexto tono={SEVERIDAD[a.severidad]!.tono}>{SEVERIDAD[a.severidad]!.texto}</EstadoTexto> },
            { id: 't', titulo: 'Aviso', celda: (a) => {
              const d = destinoAviso(a.entidad_tipo, a.entidad_id);
              return <>{d ? <Link href={d}>{a.titulo}</Link> : a.titulo}<br /><span className="rtm-nota">{a.nt}{a.conteo > 1 ? ` · ${a.conteo} veces` : ''}{a.requiere_accion && a.botones.length > 0 ? ` · ${a.botones.join(' / ')}` : ''}{a.telegram_no_salio ? ' · Telegram no salió' : ''}</span></>;
            } },
            { id: 'h', titulo: 'Cuándo', secundaria: true, celda: (a) => etiquetaFechaHora(a.creado_at) },
            { id: 'e', titulo: 'Estado', secundaria: true, celda: (a) => (a.estado === 'abierta' ? 'Pendiente' : a.estado === 'resuelta' ? 'Resuelto' : a.estado === 'caducada' ? 'Caducó' : 'Descartado') },
            { id: 'a', titulo: 'Acción', celda: (a) => (a.leida ? <span className="rtm-nota">Leído</span> : <BotonLeido avisoId={a.id} />) },
          ]}
        />
      </section>
      {(pagina > 0 || lista.hay_mas) && (
        <div className="rtm-barra-filtros">
          {pagina > 0 && <Link className="rtm-chip-filtro" href={enlace(pestana, pagina - 1)}>Anteriores</Link>}
          {lista.hay_mas && <Link className="rtm-chip-filtro" href={enlace(pestana, pagina + 1)}>Siguientes</Link>}
        </div>
      )}
    </>
  );
}
