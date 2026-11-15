import type { Metadata } from 'next';
import Link from 'next/link';
import { movimientosDeSocio } from '@/composicion/apertura';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { DIMENSIONES, ETIQUETA_ESTADO, ETIQUETA_TIPO, type DimensionMovimientos } from '@/dominio/movimientos/tipos';
import { DataTable } from '@/ui/componentes/data-table';
import { Segmentado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';

export const metadata: Metadata = { title: 'Agrupar y utilidad' };

export default async function PaginaResumen({ searchParams }: { searchParams: Promise<{ dim?: string; id?: string }> }) {
  const q = await searchParams;
  const dim: DimensionMovimientos = DIMENSIONES.some((d) => d.id === q.dim) ? (q.dim as DimensionMovimientos) : 'cliente';
  const idSel = /^\d+$/.test(q.id ?? '') ? Number(q.id) : null;
  const lector = await movimientosDeSocio();
  const [grupos, utilidad, desglose] = await Promise.all([lector.agrupado(dim), lector.utilidad(), idSel ? lector.desglose(dim, idSel) : Promise.resolve(null)]);
  const sel = idSel ? grupos.find((g) => g.id === idSel) : null;
  const deuda = utilidad.deuda_entre_socios_cent;
  const frase = deuda === 0n || !utilidad.deudor ? 'Entre socios: en paz.' : `${utilidad.deudor} le debe a ${utilidad.acreedor} ${formatearMoneda(deuda)}.`;
  const brecha = utilidad.posicion_diferencia_cent;
  const maxG = grupos.reduce((a, g) => (g.neto_cent < 0n ? -g.neto_cent : g.neto_cent) > a ? (g.neto_cent < 0n ? -g.neto_cent : g.neto_cent) : a, 0n);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Movimientos · agrupar"
        titulo={`Utilidad total acumulada ${formatearMoneda(utilidad.utilidad_total_cent, { conSigno: true })}`}
        descripcion="Solo cuentan los movimientos clasificados o conciliados. La utilidad sale de las notas y de la cuenta de socios; aquí no se recalcula."
      />
      <KpiLinea
        etiquetaAria="Utilidad y posición de los socios"
        celdas={[
          { id: 'ut', etiqueta: 'Utilidad total', valor: formatearMoneda(utilidad.utilidad_total_cent, { conSigno: true }), categoria: 2, nota: utilidad.provisional ? 'Incluye pedidos con costo provisional' : 'De los pedidos enviados' },
          { id: 'pe', etiqueta: 'Utilidad de pedidos', valor: formatearMoneda(utilidad.utilidad_pedidos_cent, { conSigno: true }), categoria: 1, nota: `${utilidad.pedidos.length} pedidos enviados` },
          { id: 'de', etiqueta: 'Deuda entre socios', valor: formatearMoneda(deuda), categoria: 7, nota: deuda === 0n || !utilidad.deudor ? 'En paz' : `${utilidad.deudor} a ${utilidad.acreedor}` },
          { id: 'gr', etiqueta: `Grupos ${DIMENSIONES.find((d) => d.id === dim)!.etiqueta.toLowerCase()}`, valor: String(grupos.length), categoria: 4, nota: 'Con movimientos clasificados' },
        ]}
      />
      <Segmentado etiquetaAria="Agrupar por" opciones={DIMENSIONES.map((d) => ({ valor: d.id, etiqueta: d.etiqueta, href: `/movimientos/resumen?dim=${d.id}`, activa: dim === d.id, testid: `dim-${d.id}` }))} />
      <Rejilla dividir="8-4">
        <Tarjeta plana titulo={`Movimientos agrupados ${DIMENSIONES.find((d) => d.id === dim)!.etiqueta.toLowerCase()}`}>
          <DataTable
            etiqueta="Movimientos agrupados"
            densidad="densa" plana pegajosa primeraFija
            clave={(g) => g.id}
            filas={grupos}
            totales={grupos.length ? { etiqueta: 'Totales', celdas: { n: String(grupos.reduce((a, g) => a + g.n, 0)), e: formatearMoneda(grupos.reduce((a, g) => a + g.entradas_cent, 0n)), s: formatearMoneda(grupos.reduce((a, g) => a + g.salidas_cent, 0n)), x: formatearMoneda(grupos.reduce((a, g) => a + g.neto_cent, 0n), { conSigno: true }) } } : undefined}
            vacio={{ titulo: 'Nada que agrupar', texto: 'Clasifica movimientos en la bandeja y aparecerán aquí.' }}
            columnas={[
              { id: 'g', titulo: DIMENSIONES.find((d) => d.id === dim)!.etiqueta.replace('Por ', ''), ancho: 'l', prioridadMovil: 'titulo', celda: (g) => <Link href={`/movimientos/resumen?dim=${dim}&id=${g.id}`} data-testid={`grupo-${g.id}`}>{g.etiqueta}</Link> },
              { id: 'n', titulo: 'Mov.', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (g) => g.n },
              { id: 'e', titulo: 'Entradas', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (g) => formatearMoneda(g.entradas_cent) },
              { id: 's', titulo: 'Salidas', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (g) => formatearMoneda(g.salidas_cent) },
              { id: 'x', titulo: 'Neto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (g) => formatearMoneda(g.neto_cent, { conSigno: true }) },
              { id: 'c', titulo: 'Conciliados', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (g) => `${g.conciliados} de ${g.n}` },
            ]}
          />
        </Tarjeta>
        <div className="rtm-pila-llena">
          <Tarjeta titulo="Neto por grupo" descripcion="En magnitud; el signo va en el dato">
            {grupos.length === 0 ? <p className="rtm-lista-vacia">Sin grupos todavía.</p> : <BarList etiquetaAria="Neto por grupo" items={grupos.slice(0, 8).map((g) => ({ id: String(g.id), etiqueta: g.etiqueta, texto: formatearMoneda(g.neto_cent, { conSigno: true }), pct: maxG > 0n ? (Number(g.neto_cent < 0n ? -g.neto_cent : g.neto_cent) / Number(maxG)) * 100 : null }))} />}
          </Tarjeta>
          <Tarjeta titulo="Quién debe a quién">
            <p data-testid="quien-debe"><EstadoTexto tono={deuda === 0n ? 'ok' : 'atencion'}>{frase}</EstadoTexto></p>
            <p className="rtm-nota" data-testid="posiciones-socios">Posición de cada socio con la sociedad (más: la sociedad le debe; menos: él le debe): Angelo {formatearMoneda(utilidad.posicion_angelo_cent, { conSigno: true })}, Javier {formatearMoneda(utilidad.posicion_javier_cent, { conSigno: true })}. Sale de lo aportado, lo pagado y lo que cada uno tiene en su poder.</p>
            <p className="rtm-nota" data-testid="brecha-socios">{brecha === 0n ? 'Las dos posiciones son iguales.' : `El encabezado muestra la brecha entre las dos posiciones (${utilidad.posicion_mayor} +${formatearMoneda(brecha)}); lo que un socio le debe al otro es la mitad de la diferencia de lo aportado neto (sin lo pagado de más fuera de la sociedad), porque al pagarlo uno baja y el otro sube lo mismo.`} <Link href="/socios">Ver la cuenta de socios</Link>.</p>
          </Tarjeta>
        </div>
      </Rejilla>
      {sel && desglose && (
        <Tarjeta plana titulo={`Desglose de ${sel.etiqueta}`}>
          <div data-testid="desglose">
            <DataTable
              etiqueta={`Movimientos de ${sel.etiqueta}`}
              densidad="densa" plana
              clave={(f) => f.id}
              filas={desglose}
              columnas={[
                { id: 'f', titulo: 'Fecha', ancho: 's', prioridadMovil: 'titulo', celda: (f) => etiquetaFecha(f.fecha_neg) },
                { id: 't', titulo: 'Tipo', ancho: 'm', prioridadMovil: 'normal', celda: (f) => (f.tipo ? ETIQUETA_TIPO[f.tipo] : '') },
                { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => formatearMoneda(f.monto_cent, { conSigno: true }) },
                { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'normal', celda: (f) => ETIQUETA_ESTADO[f.estado] },
                { id: 'x', titulo: 'Mensaje', ancho: 'l', truncar: 'l', prioridadMovil: 'detalle', celda: (f) => f.mensaje ?? '' },
              ]}
            />
          </div>
        </Tarjeta>
      )}
      <Rejilla dividir="6-6">
        <Tarjeta plana titulo="Utilidad por pedido" descripcion="La utilidad de cada pedido sale de su nota al enviarse">
          <DataTable
            etiqueta="Utilidad por pedido enviado"
            densidad="densa" plana pegajosa
            clave={(p) => p.pedido_id}
            filas={utilidad.pedidos}
            totales={utilidad.pedidos.length ? { etiqueta: 'Total', celdas: { u: formatearMoneda(utilidad.utilidad_pedidos_cent, { conSigno: true }), k: formatearMoneda(utilidad.pedidos.reduce((a, p) => a + p.cobrado_cent, 0n)) } } : undefined}
            vacio={{ titulo: 'Sin pedidos enviados', texto: 'La utilidad de cada pedido sale de su nota cuando se envía.' }}
            columnas={[
              { id: 'p', titulo: 'Pedido', ancho: 's', prioridadMovil: 'titulo', celda: (p) => <span className="rtm-mono">{p.folio}</span> },
              { id: 'c', titulo: 'Cliente', ancho: 'l', truncar: 'm', prioridadMovil: 'normal', celda: (p) => p.cliente },
              { id: 'f', titulo: 'Envío', ancho: 's', prioridadMovil: 'normal', celda: (p) => etiquetaFecha(p.fecha_envio) },
              { id: 'u', titulo: 'Utilidad', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (p) => <>{formatearMoneda(p.utilidad_cent, { conSigno: true })}{p.provisional && <span className="rtm-celda-sub">provisional</span>}</> },
              { id: 'k', titulo: 'Cobrado', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (p) => formatearMoneda(p.cobrado_cent) },
            ]}
          />
        </Tarjeta>
        <Tarjeta plana titulo="Utilidad acumulada por socio" descripcion="Su mitad, lo retirado y lo retenido en su poder">
          <p className="rtm-nota" data-testid="utilidad-total">Utilidad total acumulada: <strong>{formatearMoneda(utilidad.utilidad_total_cent, { conSigno: true })}</strong>{utilidad.provisional ? ' · incluye pedidos con costo provisional' : ''}. Se reparte 50/50; el centavo impar va a Angelo.</p>
          <DataTable
            etiqueta="Utilidad acumulada, retirado y retenido por socio"
            densidad="densa" plana
            clave={(s) => s.socio}
            filas={utilidad.socios}
            columnas={[
              { id: 's', titulo: 'Socio', ancho: 'm', prioridadMovil: 'titulo', celda: (s) => s.socio },
              { id: 'm', titulo: 'Su mitad', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (s) => formatearMoneda(s.mitad_cent, { conSigno: true }) },
              { id: 'r', titulo: 'Retirado', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (s) => formatearMoneda(s.retirado_cent) },
              { id: 't', titulo: 'Retenido en su poder', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (s) => formatearMoneda(s.retenido_cent) },
            ]}
          />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
