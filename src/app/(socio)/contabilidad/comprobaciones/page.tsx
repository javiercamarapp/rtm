import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { formatearMoneda, formatearPiezas, etiquetaFecha, etiquetaFechaHora } from '@/dominio/formato';
import type { Comprobacion } from '@/dominio/contabilidad/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SubnavContabilidad } from '../subnav';
import { AccionesPeriodo } from './acciones-periodo';

export const metadata: Metadata = { title: 'Comprobaciones' };

function mostrar(c: Comprobacion, cent: bigint): string {
  if (c.unidad === 'pz') return formatearPiezas(Number(cent));
  if (c.unidad === 'n') return String(cent);
  return formatearMoneda(cent);
}

export default async function Pagina() {
  const lector = await contabilidadDeSocio();
  const [c, p] = await Promise.all([lector.comprobaciones(), lector.periodos()]);
  const fallan = c.comprobaciones.filter((x) => !x.ok);
  const bloqueantes = fallan.filter((x) => x.bloqueante);
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · comprobaciones"
        antes={bloqueantes.length > 0 ? 'Un reporte no puede salir:' : 'Todo'}
        enfasis={bloqueantes.length > 0 ? `${bloqueantes.length} comprobación bloqueante falla` : 'cuadra'}
        contexto="Cada comprobación calcula la cifra por dos vías independientes y exige igualdad exacta. Las bloqueantes impiden preparar, aprobar y publicar un periodo."
      />
      <p className="rtm-nota" data-testid="resumen-comprobaciones">
        <EstadoTexto tono={fallan.length === 0 ? 'ok' : bloqueantes.length > 0 ? 'malo' : 'atencion'}>
          {fallan.length === 0 ? `Las ${c.comprobaciones.length} comprobaciones cuadran` : `${fallan.length} de ${c.comprobaciones.length} no cuadran`}
        </EstadoTexto>
        {c.cadena_hash_cabecera && <> · hash de cabecera del libro <span className="rtm-mono">{c.cadena_hash_cabecera.slice(0, 16)}…</span></>}
      </p>
      <DataTable
        etiqueta="Comprobaciones por dos vías"
        clave={(x) => x.codigo}
        filas={c.comprobaciones}
        columnas={[
          { id: 'c', titulo: 'Código', celda: (x) => <span className="rtm-mono" data-testid={`comprobacion-${x.codigo}`}>{x.codigo}</span> },
          { id: 'n', titulo: 'Comprobación', celda: (x) => <>{x.nombre}{x.bloqueante && <span className="rtm-nota"> · bloqueante</span>}</> },
          { id: 'a', titulo: 'Vía A', numerica: true, celda: (x) => <>{mostrar(x, x.via_a_cent)}<br /><span className="rtm-nota">{x.via_a_nombre}</span></> },
          { id: 'b', titulo: 'Vía B', numerica: true, secundaria: true, celda: (x) => <>{mostrar(x, x.via_b_cent)}<br /><span className="rtm-nota">{x.via_b_nombre}</span></> },
          { id: 'o', titulo: 'Estado', celda: (x) => <><EstadoTexto tono={x.ok ? 'ok' : x.bloqueante ? 'malo' : 'atencion'}>{x.ok ? 'Cuadra' : 'No cuadra'}</EstadoTexto>{x.codigo === 'C23' && <><br /><span className="rtm-nota">Diferencia: </span><CifraComprobada texto={formatearMoneda(x.via_a_cent - x.via_b_cent)} cifra="conta:efectivo" comprobacion={x.ok ? 'cuadra' : 'no_cuadra'} /></>}</> },
        ]}
      />

      <section className="rtm-seccion" aria-label="Auxiliares contra el libro">
        <h2>Auxiliares contra el libro</h2>
        <DataTable
          etiqueta="Auxiliares operativos contra cuentas de control"
          clave={(x) => x.clave}
          filas={c.auxiliares}
          columnas={[
            { id: 'd', titulo: 'Auxiliar', celda: (x) => x.descripcion },
            { id: 'm', titulo: 'Libro', numerica: true, celda: (x) => formatearMoneda(x.mayor_cent) },
            { id: 'o', titulo: 'Auxiliar', numerica: true, celda: (x) => formatearMoneda(x.operativo_cent) },
            { id: 'k', titulo: 'Estado', celda: (x) => <EstadoTexto tono={x.ok ? 'ok' : 'malo'}>{x.ok ? 'Cuadra' : 'No cuadra'}</EstadoTexto> },
          ]}
        />
      </section>

      <section className="rtm-seccion" aria-label="Periodos">
        <h2>Periodos</h2>
        <p className="rtm-nota">Abierto, preparado, aprobado y publicado. El periodo semanal se aprueba a partir del lunes siguiente; lo que llega tarde se registra en el periodo abierto y se marca como ajuste del anterior.</p>
        <DataTable
          etiqueta="Periodos contables"
          clave={(x) => x.id}
          filas={p.periodos}
          vacio={{ titulo: 'Sin periodos', texto: 'El primer asiento crea su semana y su mes.' }}
          columnas={[
            { id: 't', titulo: 'Periodo', celda: (x) => <>{x.tipo === 'semana' ? 'Semana' : 'Mes'} {etiquetaFecha(x.ini)} al {etiquetaFecha(x.fin)}</> },
            { id: 'e', titulo: 'Estado', celda: (x) => <span data-testid={`estado-periodo-${x.id}`}><EstadoTexto tono={x.estado === 'abierto' ? 'neutro' : 'ok'}>{x.estado}</EstadoTexto></span> },
            { id: 'a', titulo: 'Asientos', numerica: true, secundaria: true, celda: (x) => `${x.asientos}${x.afectados > 0 ? ` (+${x.afectados} ajustes)` : ''}` },
            { id: 'h', titulo: 'Hash de cabecera', secundaria: true, celda: (x) => (x.hash_cabecera ? <span className="rtm-mono">{x.hash_cabecera.slice(0, 12)}…{x.aprobado_at ? ` · ${etiquetaFechaHora(x.aprobado_at)}` : ''}</span> : '') },
            { id: 'x', titulo: '', celda: (x) => <AccionesPeriodo p={x} terminado={x.fin < p.hoy} /> },
          ]}
        />
      </section>
    </>
  );
}
