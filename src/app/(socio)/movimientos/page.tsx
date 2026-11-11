import type { Metadata } from 'next';
import Link from 'next/link';
import { movimientosDeSocio } from '@/composicion/apertura';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, type EstadoMovimiento } from '@/dominio/movimientos/tipos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { AccionesMovimiento } from './acciones-movimiento';

export const metadata: Metadata = { title: 'Movimientos' };

const ESTADOS: EstadoMovimiento[] = ['sin_clasificar', 'clasificado', 'conciliado', 'duplicado', 'descartado'];
const TONO: Record<EstadoMovimiento, 'ok' | 'atencion' | 'malo' | 'neutro'> = { sin_clasificar: 'atencion', clasificado: 'neutro', conciliado: 'ok', duplicado: 'neutro', descartado: 'neutro' };
const PAGINA = 40;

export default async function Pagina({ searchParams }: { searchParams: Promise<{ estado?: string; p?: string }> }) {
  const q = await searchParams;
  const estado = ESTADOS.includes(q.estado as EstadoMovimiento) ? (q.estado as EstadoMovimiento) : null;
  const pag = Math.max(Number(q.p) || 0, 0);
  const lector = await movimientosDeSocio();
  const [resumen, lista, refs] = await Promise.all([lector.resumen(), lector.lista(estado, PAGINA, pag * PAGINA), lector.referencias()]);
  const href = (e: string | null, p = 0) => `/movimientos?${new URLSearchParams({ ...(e ? { estado: e } : {}), ...(p ? { p: String(p) } : {}) })}`;
  return (
    <>
      <EncabezadoPagina
        eyebrow="Movimientos · bandeja"
        antes="Lo que llegó, aún por"
        enfasis="clasificar"
        contexto="Los movimientos históricos entran sin clasificar. Clasificarlos los asigna a un cliente, pedido, socio o proveedor; conciliarlos exige un hecho existente con la misma suma. Ninguna de las dos cosas mueve un saldo."
      />
      <div className="rtm-filtros-estado" role="navigation" aria-label="Filtrar por estado">
        <Link href={href(null)} aria-current={estado === null ? 'true' : undefined} data-testid="filtro-todos">Todos ({resumen.total})</Link>
        {ESTADOS.map((e) => {
          const n = resumen.estados.find((x) => x.estado === e)?.n ?? 0;
          return <Link key={e} href={href(e)} aria-current={estado === e ? 'true' : undefined} data-testid={`filtro-${e}`}>{ETIQUETA_ESTADO[e]} ({n})</Link>;
        })}
      </div>
      <DataTable
        etiqueta="Movimientos"
        clave={(f) => f.id}
        filas={lista.filas}
        vacio={{ titulo: 'Sin movimientos', texto: 'Pega o sube los movimientos históricos en la pestaña Pegar o subir.', accion: <Link className="rtm-boton rtm-boton-primario" href="/movimientos/importar">Pegar o subir</Link> }}
        columnas={[
          { id: 'f', titulo: 'Fecha', celda: (f) => etiquetaFecha(f.fecha_neg) },
          { id: 'm', titulo: 'Monto', numerica: true, celda: (f) => <span data-testid={`monto-${f.id}`}>{formatearMoneda(f.monto_cent, { conSigno: true })}</span> },
          { id: 'x', titulo: 'Mensaje', celda: (f) => <>{f.mensaje}<br /><span className="rtm-nota">{[f.cuenta, f.origen].filter(Boolean).join(' · ')}</span></> },
          { id: 'e', titulo: 'Estado', celda: (f) => <EstadoTexto tono={TONO[f.estado]}>{ETIQUETA_ESTADO[f.estado]}</EstadoTexto> },
          { id: 't', titulo: 'Clasificación', secundaria: true, celda: (f) => (f.tipo ? <>{ETIQUETA_TIPO[f.tipo]}<br /><span className="rtm-nota">{[f.cliente, f.pedido, f.socio, f.proveedor].filter(Boolean).join(' · ')}</span></> : '') },
          { id: 'a', titulo: '', celda: (f) => <AccionesMovimiento fila={f} refs={refs} /> },
        ]}
      />
      <p className="rtm-nota" data-testid="paginacion">
        {lista.total === 0 ? '' : `${pag * PAGINA + 1} a ${Math.min((pag + 1) * PAGINA, lista.total)} de ${lista.total}`}
        {pag > 0 && <> · <Link href={href(estado, pag - 1)}>Anteriores</Link></>}
        {(pag + 1) * PAGINA < lista.total && <> · <Link href={href(estado, pag + 1)}>Siguientes</Link></>}
      </p>
      {resumen.importaciones.length > 0 && (
        <section className="rtm-seccion" aria-label="Importaciones">
          <h2>Últimas importaciones</h2>
          <DataTable
            etiqueta="Importaciones recientes"
            clave={(i) => i.id}
            filas={resumen.importaciones}
            columnas={[
              { id: 'n', titulo: 'Origen', celda: (i) => (i.fuente === 'archivo' ? i.nombre_archivo ?? 'Archivo' : 'Texto pegado') },
              { id: 't', titulo: 'Filas', numerica: true, celda: (i) => i.filas_total },
              { id: 'w', titulo: 'Nuevas', numerica: true, celda: (i) => i.filas_nuevas },
              { id: 'd', titulo: 'Ya existían', numerica: true, secundaria: true, celda: (i) => i.filas_duplicadas },
            ]}
          />
        </section>
      )}
    </>
  );
}
