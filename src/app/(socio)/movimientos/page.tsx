import type { Metadata } from 'next';
import Link from 'next/link';
import { movimientosDeSocio } from '@/composicion/apertura';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { ETIQUETA_ESTADO, ETIQUETA_TIPO, type EstadoMovimiento } from '@/dominio/movimientos/tipos';
import { ChipEstado, Pestanas } from '@/ui/componentes/controles';
import { BarList, Paginador } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AccionesMovimiento } from './acciones-movimiento';

export const metadata: Metadata = { title: 'Movimientos' };

const ESTADOS: EstadoMovimiento[] = ['sin_clasificar', 'clasificado', 'conciliado', 'duplicado', 'descartado'];
const TONO: Record<EstadoMovimiento, 'ok' | 'atencion' | 'info' | 'apagado'> = { sin_clasificar: 'atencion', clasificado: 'info', conciliado: 'ok', duplicado: 'apagado', descartado: 'apagado' };
const PAGINA = 40;

export default async function PaginaBandeja({ searchParams }: { searchParams: Promise<{ estado?: string; p?: string }> }) {
  const q = await searchParams;
  const estado = ESTADOS.includes(q.estado as EstadoMovimiento) ? (q.estado as EstadoMovimiento) : null;
  const pag = Math.max(Number(q.p) || 0, 0);
  const lector = await movimientosDeSocio();
  const [resumen, lista, refs] = await Promise.all([lector.resumen(), lector.lista(estado, PAGINA, pag * PAGINA), lector.referencias()]);
  const href = (e: string | null, p = 0) => `/movimientos?${new URLSearchParams({ ...(e ? { estado: e } : {}), ...(p ? { p: String(p) } : {}) })}`;
  const de = (e: EstadoMovimiento) => resumen.estados.find((x) => x.estado === e);
  const n = (e: EstadoMovimiento) => de(e)?.n ?? 0;
  const entradas = resumen.estados.reduce((a, x) => a + x.entradas_cent, 0n);
  const salidas = resumen.estados.reduce((a, x) => a + x.salidas_cent, 0n);
  const pct = (parte: number) => (resumen.total > 0 ? (parte / resumen.total) * 100 : null);
  const desde = pag * PAGINA + 1;
  const hasta = Math.min((pag + 1) * PAGINA, lista.total);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Movimientos · bandeja"
        titulo={resumen.total === 0 ? 'Sin movimientos todavía' : `${resumen.total} movimientos, ${n('sin_clasificar')} por clasificar`}
        descripcion="Los históricos entran sin clasificar. Clasificar asigna a un cliente, pedido, socio o proveedor; conciliar exige un hecho con la misma suma. Ninguna de las dos mueve un saldo."
        acciones={<Link className="rtm-boton rtm-boton-primario" href="/movimientos/importar">Pegar o subir</Link>}
      />
      <KpiLinea
        etiquetaAria="Estado de los movimientos"
        celdas={[
          { id: 'tot', etiqueta: 'Movimientos', valor: String(resumen.total), categoria: 1, nota: `${resumen.importaciones.length} importaciones recientes` },
          { id: 'sin', etiqueta: 'Sin clasificar', valor: String(n('sin_clasificar')), categoria: 6, progreso: pct(n('sin_clasificar')) === null ? undefined : { pct: pct(n('sin_clasificar'))! }, nota: 'No afectan ningún saldo' },
          { id: 'ent', etiqueta: 'Entradas', valor: formatearMoneda(entradas), categoria: 3, nota: 'Suma de todos los estados' },
          { id: 'sal', etiqueta: 'Salidas', valor: formatearMoneda(salidas), categoria: 5, nota: `Neto ${formatearMoneda(entradas - salidas, { conSigno: true })}` },
        ]}
      />
      <Pestanas
        etiquetaAria="Filtrar por estado"
        items={[{ id: 'todos', etiqueta: 'Todos', href: href(null), activa: estado === null, contador: resumen.total, testid: 'filtro-todos' }, ...ESTADOS.map((e) => ({ id: e, etiqueta: ETIQUETA_ESTADO[e], href: href(e), activa: estado === e, contador: n(e), testid: `filtro-${e}` }))]}
      />
      <Rejilla dividir="8-4">
        <Tarjeta plana titulo={estado ? ETIQUETA_ESTADO[estado] : 'Todos los movimientos'} descripcion={lista.total === 0 ? undefined : `${desde} a ${hasta} de ${lista.total}`}>
          <DataTable
            etiqueta="Movimientos"
            densidad="densa" plana pegajosa primeraFija
            clave={(f) => f.id}
            filas={lista.filas}
            vacio={{ titulo: 'Sin movimientos', texto: 'Pega o sube los movimientos históricos en Pegar o subir.', accion: <Link className="rtm-boton rtm-boton-primario" href="/movimientos/importar">Pegar o subir</Link> }}
            columnas={[
              { id: 'f', titulo: 'Fecha', ancho: 's', prioridadMovil: 'titulo', celda: (f) => etiquetaFecha(f.fecha_neg) },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => <span data-testid={`monto-${f.id}`}>{formatearMoneda(f.monto_cent, { conSigno: true })}</span> },
              { id: 'x', titulo: 'Mensaje', ancho: 'l', truncar: 'l', prioridadMovil: 'detalle', celda: (f) => <>{f.mensaje}<span className="rtm-celda-sub">{[f.cuenta, f.origen].filter(Boolean).join(' · ')}</span></> },
              { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'normal', celda: (f) => <ChipEstado tono={TONO[f.estado]}>{ETIQUETA_ESTADO[f.estado]}</ChipEstado> },
              { id: 't', titulo: 'Clasificación', ancho: 'l', prioridadMovil: 'normal', celda: (f) => (f.tipo ? <>{ETIQUETA_TIPO[f.tipo]}<span className="rtm-celda-sub">{[f.cliente, f.pedido, f.socio, f.proveedor].filter(Boolean).join(' · ')}</span></> : '') },
              { id: 'a', titulo: 'Acciones', ancho: 'l', prioridadMovil: 'detalle', celda: (f) => <AccionesMovimiento fila={f} refs={refs} /> },
            ]}
          />
          <div data-testid="paginacion">
            <Paginador mostrados={lista.filas.length} total={lista.total} anterior={pag > 0 ? href(estado, pag - 1) : undefined} siguiente={(pag + 1) * PAGINA < lista.total ? href(estado, pag + 1) : undefined} />
          </div>
        </Tarjeta>
        <div className="rtm-pila-llena">
          <Tarjeta titulo="Por estado" descripcion="Cantidad de movimientos">
            <BarList etiquetaAria="Movimientos por estado" items={ESTADOS.map((e) => ({ id: e, etiqueta: ETIQUETA_ESTADO[e], texto: String(n(e)), pct: pct(n(e)), tono: e === 'sin_clasificar' && n(e) > 0 ? ('atencion' as const) : undefined, href: href(e) }))} />
          </Tarjeta>
          <Tarjeta titulo="Últimas importaciones" descripcion="Lo ya cargado no se duplica si se vuelve a pegar">
            {resumen.importaciones.length === 0 ? (
              <p className="rtm-lista-vacia">Todavía no hay importaciones.</p>
            ) : (
              <DataTable
                etiqueta="Importaciones recientes"
                densidad="densa" plana
                clave={(i) => i.id}
                filas={resumen.importaciones}
                columnas={[
                  { id: 'n', titulo: 'Origen', truncar: 'm', celda: (i) => (i.fuente === 'archivo' ? i.nombre_archivo ?? 'Archivo' : 'Texto pegado') },
                  { id: 't', titulo: 'Filas', numerica: true, ancho: 's', celda: (i) => i.filas_total },
                  { id: 'w', titulo: 'Nuevas', numerica: true, ancho: 's', celda: (i) => i.filas_nuevas },
                  { id: 'd', titulo: 'Repetidas', numerica: true, ancho: 's', celda: (i) => i.filas_duplicadas },
                ]}
              />
            )}
          </Tarjeta>
        </div>
      </Rejilla>
    </Pagina>
  );
}
