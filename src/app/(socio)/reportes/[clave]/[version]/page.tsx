import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { reportesDeSocio } from '@/composicion/reportes';
import { ChipEstado } from '@/ui/componentes/controles';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';

export const metadata: Metadata = { title: 'Vista previa del reporte' };

export default async function PaginaVistaReporte({ params }: { params: Promise<{ clave: string; version: string }> }) {
  const p = await params;
  const clave = decodeURIComponent(p.clave);
  const version = Number(p.version);
  if (!/^(semanal|mensual):\d{4}-\d{2}-\d{2}$/.test(clave) || !Number.isInteger(version) || version < 1) notFound();
  const r = await reportesDeSocio();
  const historial = await r.historial();
  const fila = historial.find((f) => f.clave === clave && f.version === version);
  if (!fila) notFound();
  const base = `/reportes/${encodeURIComponent(clave)}/${version}`;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/reportes', texto: 'Reportes' }}
        eyebrow={`Reporte · ${fila.folio} · versión ${version}`}
        titulo={`${clave.startsWith('semanal') ? 'Semanal' : 'Mensual'} ${clave.split(':')[1]} · ${fila.etiquetas.length ? fila.etiquetas.join(' · ').toLowerCase() : 'borrador'}`}
        descripcion={fila.estado === 'borrador' ? 'Este reporte no salió: falla una comprobación bloqueante. No lo uses para decidir.' : 'Es el mismo documento del PDF. Se abre con tu sesión; no hay enlaces públicos.'}
        acciones={fila.tiene_pdf ? <a className="rtm-boton rtm-boton-primario" href={`${base}/pdf`} data-testid="abrir-pdf">Abrir el PDF</a> : undefined}
      />
      <p className="rtm-linea-estado"><ChipEstado tono={fila.estado === 'borrador' ? 'malo' : fila.etiquetas.includes('DEFINITIVO') ? 'ok' : 'atencion'}>{fila.estado === 'borrador' ? 'Borrador' : fila.etiquetas.join(' · ')}</ChipEstado><span className="rtm-nota">huella {fila.huella}</span></p>
      <iframe className="rtm-reportes-marco" title={`Reporte ${fila.folio}`} src={`${base}/html`} sandbox="" data-testid="marco-reporte" />
    </Pagina>
  );
}
