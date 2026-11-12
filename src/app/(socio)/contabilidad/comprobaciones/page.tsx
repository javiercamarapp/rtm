import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import type { Comprobacion } from '@/dominio/contabilidad/tipos';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Dos, Estado, Pie, m, pct } from '../../_a3/util';
import { SubnavContabilidad } from '../subnav';
import { AccionesPeriodo } from './acciones-periodo';

export const metadata: Metadata = { title: 'Comprobaciones' };

function mostrar(c: Comprobacion, cent: bigint): string {
  if (c.unidad === 'pz') return formatearPiezas(Number(cent));
  if (c.unidad === 'n') return String(cent);
  return m(cent);
}

export default async function PaginaComprobaciones() {
  const lector = await contabilidadDeSocio();
  const [c, p] = await Promise.all([lector.comprobaciones(), lector.periodos()]);
  const todas = c.comprobaciones;
  const fallan = todas.filter((x) => !x.ok);
  const bloqueantes = fallan.filter((x) => x.bloqueante);
  const bloqueantesTotal = todas.filter((x) => x.bloqueante).length;
  const auxFallan = c.auxiliares.filter((x) => !x.ok).length;
  const estados = (['abierto', 'preparado', 'aprobado', 'publicado'] as const).map((e) => ({ e, n: p.periodos.filter((x) => x.estado === e).length }));

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · comprobaciones"
        titulo={bloqueantes.length > 0 ? `Un reporte no puede salir: ${bloqueantes.length} ${bloqueantes.length === 1 ? 'comprobación bloqueante falla' : 'comprobaciones bloqueantes fallan'}` : 'Todo cuadra'}
        descripcion="Cada comprobación calcula la cifra por dos vías independientes y exige igualdad exacta; las bloqueantes impiden aprobar y publicar un periodo."
      />
      {bloqueantes.length > 0 && <Aviso tono="error" titulo="Reporte bloqueado.">{bloqueantes.map((x) => x.codigo).join(', ')} no cuadran.</Aviso>}
      <KpiLinea
        etiquetaAria="Indicadores de comprobaciones"
        celdas={[
          { id: 'total', etiqueta: 'Comprobaciones', valor: String(todas.length), categoria: 1, partes: todas.length > 0 ? [{ etiqueta: 'Cuadran', valor: todas.length - fallan.length }, { etiqueta: 'No cuadran', valor: fallan.length }] : undefined, nota: <span data-testid="resumen-comprobaciones"><Estado tono={fallan.length === 0 ? 'ok' : bloqueantes.length > 0 ? 'malo' : 'atencion'}>{fallan.length === 0 ? `Las ${todas.length} comprobaciones cuadran` : `${fallan.length} de ${todas.length} no cuadran`}</Estado></span> },
          { id: 'bloq', etiqueta: 'Bloqueantes', valor: String(bloqueantesTotal), categoria: 4, nota: bloqueantes.length === 0 ? 'Ninguna falla' : `${bloqueantes.length} fallan` },
          { id: 'aux', etiqueta: 'Auxiliares contra el libro', valor: String(c.auxiliares.length), categoria: 2, nota: auxFallan === 0 ? 'Todos cuadran' : `${auxFallan} no cuadran` },
          { id: 'per', etiqueta: 'Periodos contables', valor: String(p.periodos.length), categoria: 6, nota: `${estados.find((x) => x.e === 'publicado')?.n ?? 0} publicados` },
        ]}
      />
      <FilaRatios etiqueta="Libro" items={[{ etiqueta: 'Hash de cabecera del libro', valor: c.cadena_hash_cabecera ? <span className="rtm-mono">{c.cadena_hash_cabecera.slice(0, 16)}…</span> : null }, { etiqueta: 'Corte', valor: etiquetaFecha(c.hoy) }]} />

      <Tarjeta plana titulo="Comprobaciones por dos vías" descripcion="Vía A contra vía B, exactas al centavo">
        <DataTable
          etiqueta="Comprobaciones por dos vías"
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar comprobación', porPagina: 50, exportar: 'comprobaciones' }}
          clave={(x) => x.codigo}
          filas={todas}
          totales={{ etiqueta: `Total (${todas.length})`, celdas: { o: `${todas.length - fallan.length} cuadran · ${fallan.length} no` } }}
          columnas={[
            { id: 'c', titulo: 'Código', ancho: 's', celda: (x) => <span className="rtm-mono" data-testid={`comprobacion-${x.codigo}`}>{x.codigo}</span> },
            { id: 'n', titulo: 'Comprobación', ancho: 'xl', celda: (x) => <Dos a={x.nombre} b={x.bloqueante ? 'bloqueante' : undefined} /> },
            { id: 'a', titulo: 'Vía A', numerica: true, ancho: 'l', celda: (x) => <Dos a={mostrar(x, x.via_a_cent)} b={x.via_a_nombre} /> },
            { id: 'b', titulo: 'Vía B', numerica: true, ancho: 'l', secundaria: true, celda: (x) => <Dos a={mostrar(x, x.via_b_cent)} b={x.via_b_nombre} /> },
            { id: 'o', titulo: 'Estado', ancho: 'm', celda: (x) => <><Estado tono={x.ok ? 'ok' : x.bloqueante ? 'malo' : 'atencion'}>{x.ok ? 'Cuadra' : 'No cuadra'}</Estado>{x.codigo === 'C23' && <><br /><span className="rtm-nota">Diferencia: </span><CifraComprobada texto={formatearMoneda(x.via_a_cent - x.via_b_cent)} cifra="conta:efectivo" comprobacion={x.ok ? 'cuadra' : 'no_cuadra'} /></>}</> },
          ]}
        />
      </Tarjeta>

      <Rejilla dividir="12">
        <Tarjeta plana titulo="Auxiliares contra el libro" descripcion="Cada auxiliar operativo contra su cuenta de control">
          <DataTable
            etiqueta="Auxiliares operativos contra cuentas de control"
            densidad="densa" plana
            clave={(x) => x.clave}
            filas={c.auxiliares}
            columnas={[
              { id: 'd', titulo: 'Auxiliar', ancho: 'xl', celda: (x) => x.descripcion },
              { id: 'm', titulo: 'Libro', numerica: true, ancho: 'm', celda: (x) => m(x.mayor_cent) },
              { id: 'o', titulo: 'Auxiliar', numerica: true, ancho: 'm', celda: (x) => m(x.operativo_cent) },
              { id: 'k', titulo: 'Estado', ancho: 'm', celda: (x) => <Estado tono={x.ok ? 'ok' : 'malo'}>{x.ok ? 'Cuadra' : 'No cuadra'}</Estado> },
            ]}
          />
        </Tarjeta>
        <Tarjeta titulo="Ciclo de los periodos" descripcion="Abierto, preparado, aprobado y publicado">
          <BarList etiquetaAria="Periodos por estado" items={estados.map((x) => ({ id: x.e, etiqueta: x.e.charAt(0).toUpperCase() + x.e.slice(1), texto: String(x.n), pct: p.periodos.length > 0 ? pct(BigInt(x.n), BigInt(p.periodos.length)) : null }))} />
          <Pie>El periodo semanal se aprueba a partir del lunes siguiente; lo que llega tarde se registra en el periodo abierto y se marca como ajuste del anterior.</Pie>
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="Periodos" descripcion="Preparar, aprobar y publicar; cada uno con clave de idempotencia">
        <DataTable
          etiqueta="Periodos contables"
          densidad="densa" plana
          clave={(x) => x.id}
          filas={p.periodos}
          vacio={{ titulo: 'Sin periodos', texto: 'El primer asiento crea su semana y su mes.' }}
          columnas={[
            { id: 't', titulo: 'Periodo', ancho: 'xl', celda: (x) => <>{x.tipo === 'semana' ? 'Semana' : 'Mes'} {etiquetaFecha(x.ini)} al {etiquetaFecha(x.fin)}</> },
            { id: 'e', titulo: 'Estado', ancho: 'm', celda: (x) => <span data-testid={`estado-periodo-${x.id}`}><Estado tono={x.estado === 'abierto' ? 'neutro' : 'ok'}>{x.estado}</Estado></span> },
            { id: 'a', titulo: 'Asientos', numerica: true, ancho: 's', secundaria: true, celda: (x) => `${x.asientos}${x.afectados > 0 ? ` (+${x.afectados} ajustes)` : ''}` },
            { id: 'h', titulo: 'Hash de cabecera', ancho: 'l', secundaria: true, celda: (x) => (x.hash_cabecera ? <span className="rtm-mono">{x.hash_cabecera.slice(0, 12)}…{x.aprobado_at ? ` · ${etiquetaFechaHora(x.aprobado_at)}` : ''}</span> : '') },
            { id: 'x', titulo: '', ancho: 'l', celda: (x) => <AccionesPeriodo p={x} terminado={x.fin < p.hoy} /> },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
