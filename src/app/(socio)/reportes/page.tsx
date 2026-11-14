import type { Metadata } from 'next';
import Link from 'next/link';
import { reportesDeSocio } from '@/composicion/reportes';
import { etiquetaFechaHora } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { PrepararReporte } from './preparar';

export const metadata: Metadata = { title: 'Reportes' };

const NOMBRE: Record<string, string> = { DEFINITIVO: 'Definitivo', PRELIMINAR: 'Preliminar', PARCIAL: 'Parcial', BORRADOR: 'Borrador' };

export default async function PaginaReportes() {
  const r = await reportesDeSocio();
  const historial = await r.historial();
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Reportes"
        titulo="Lo que pasó, comprobado"
        descripcion="El semanal sale el lunes a las 6:00 y el mensual el día 1." ayudaResumen="Reemisión" ayuda="Un reporte publicado se reemite como versión nueva y se conserva la anterior."
      />
      <Tarjeta titulo="Preparar un reporte" descripcion="Definitivo exige el periodo aprobado; Preliminar, que alguna comprobación falle; Parcial, datos incompletos o periodo en curso">
        <PrepararReporte />
      </Tarjeta>
      <Tarjeta plana titulo="Historial" descripcion={`${historial.length} ${historial.length === 1 ? 'versión publicada' : 'versiones publicadas'}`}>
        <DataTable
          plana
          densidad="densa"
          etiqueta="Reportes publicados"
          clave={(f) => `${f.clave}:${f.version}`}
          filas={historial}
          vacio={{ titulo: 'Sin reportes', texto: 'Prepara el primero con el formulario de arriba. El PDF solo sale si pasan las comprobaciones bloqueantes.' }}
          columnas={[
            { id: 'p', titulo: 'Periodo', ancho: 'l', prioridadMovil: 'titulo', celda: (f) => <Link href={`/reportes/${encodeURIComponent(f.clave)}/${f.version}`} data-testid={`reporte-${f.clave}-${f.version}`}>{f.clave.startsWith('semanal') ? 'Semanal' : 'Mensual'} {f.clave.split(':')[1]}</Link> },
            { id: 'v', titulo: 'Versión', numerica: true, celda: (f) => <>{f.version}{f.ultima ? '' : ' (anterior)'}</> },
            { id: 'f', titulo: 'Folio', secundaria: true, celda: (f) => `${f.folio} · ${f.huella}` },
            { id: 'e', titulo: 'Estado', prioridadMovil: 'principal', celda: (f) => <EstadoTexto tono={f.estado === 'borrador' ? 'malo' : f.etiquetas.includes('DEFINITIVO') ? 'ok' : 'atencion'}>{f.estado === 'borrador' ? 'Borrador: no salió' : f.etiquetas.map((e) => NOMBRE[e] ?? e).join(' · ')}</EstadoTexto> },
            { id: 'a', titulo: 'Aviso', secundaria: true, celda: (f) => (f.entrega_telegram ? 'Enviado al grupo' : 'Pendiente') },
            { id: 'c', titulo: 'Creado', secundaria: true, celda: (f) => etiquetaFechaHora(f.creado_at) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
