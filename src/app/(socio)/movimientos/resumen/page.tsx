import type { Metadata } from 'next';
import Link from 'next/link';
import { movimientosDeSocio } from '@/composicion/apertura';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { DIMENSIONES, ETIQUETA_ESTADO, ETIQUETA_TIPO, type DimensionMovimientos } from '@/dominio/movimientos/tipos';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';

export const metadata: Metadata = { title: 'Agrupar y utilidad' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ dim?: string; id?: string }> }) {
  const q = await searchParams;
  const dim: DimensionMovimientos = DIMENSIONES.some((d) => d.id === q.dim) ? (q.dim as DimensionMovimientos) : 'cliente';
  const idSel = /^\d+$/.test(q.id ?? '') ? Number(q.id) : null;
  const lector = await movimientosDeSocio();
  const [grupos, utilidad, desglose] = await Promise.all([lector.agrupado(dim), lector.utilidad(), idSel ? lector.desglose(dim, idSel) : Promise.resolve(null)]);
  const sel = idSel ? grupos.find((g) => g.id === idSel) : null;
  const debe = utilidad.javier_debe_a_angelo_cent;
  const frase = debe === 0n ? 'Los socios están en paz.' : debe > 0n ? `Javier le debe a Angelo ${formatearMoneda(debe)}.` : `Angelo le debe a Javier ${formatearMoneda(-debe)}.`;
  return (
    <>
      <EncabezadoPagina
        eyebrow="Movimientos · agrupar"
        antes="Por dónde se mueve el"
        enfasis="dinero"
        contexto="Solo cuentan los movimientos ya clasificados o conciliados; los que siguen sin clasificar no entran a ninguna agrupación. La utilidad sale de las notas y de la cuenta de socios, no se recalcula aquí."
      />
      <div className="rtm-filtros-estado" role="navigation" aria-label="Agrupar por">
        {DIMENSIONES.map((d) => <Link key={d.id} href={`/movimientos/resumen?dim=${d.id}`} aria-current={dim === d.id ? 'true' : undefined} data-testid={`dim-${d.id}`}>{d.etiqueta}</Link>)}
      </div>
      <DataTable
        etiqueta="Movimientos agrupados"
        clave={(g) => g.id}
        filas={grupos}
        vacio={{ titulo: 'Nada que agrupar', texto: 'Clasifica movimientos en la bandeja y aparecerán aquí.' }}
        columnas={[
          { id: 'g', titulo: DIMENSIONES.find((d) => d.id === dim)!.etiqueta.replace('Por ', ''), celda: (g) => <Link href={`/movimientos/resumen?dim=${dim}&id=${g.id}`} data-testid={`grupo-${g.id}`}>{g.etiqueta}</Link> },
          { id: 'n', titulo: 'Mov.', numerica: true, secundaria: true, celda: (g) => g.n },
          { id: 'e', titulo: 'Entradas', numerica: true, celda: (g) => formatearMoneda(g.entradas_cent) },
          { id: 's', titulo: 'Salidas', numerica: true, celda: (g) => formatearMoneda(g.salidas_cent) },
          { id: 'x', titulo: 'Neto', numerica: true, celda: (g) => formatearMoneda(g.neto_cent, { conSigno: true }) },
          { id: 'c', titulo: 'Conciliados', numerica: true, secundaria: true, celda: (g) => `${g.conciliados} de ${g.n}` },
        ]}
      />
      {sel && desglose && (
        <section className="rtm-seccion" aria-label="Desglose" data-testid="desglose">
          <h2>Desglose de {sel.etiqueta}</h2>
          <DataTable
            etiqueta={`Movimientos de ${sel.etiqueta}`}
            clave={(f) => f.id}
            filas={desglose}
            columnas={[
              { id: 'f', titulo: 'Fecha', celda: (f) => etiquetaFecha(f.fecha_neg) },
              { id: 't', titulo: 'Tipo', celda: (f) => (f.tipo ? ETIQUETA_TIPO[f.tipo] : '') },
              { id: 'm', titulo: 'Monto', numerica: true, celda: (f) => formatearMoneda(f.monto_cent, { conSigno: true }) },
              { id: 'e', titulo: 'Estado', secundaria: true, celda: (f) => ETIQUETA_ESTADO[f.estado] },
              { id: 'x', titulo: 'Mensaje', secundaria: true, celda: (f) => f.mensaje ?? '' },
            ]}
          />
        </section>
      )}

      <section className="rtm-seccion" aria-label="Utilidad por pedido">
        <h2>Utilidad por pedido</h2>
        <DataTable
          etiqueta="Utilidad por pedido enviado"
          clave={(p) => p.pedido_id}
          filas={utilidad.pedidos}
          vacio={{ titulo: 'Sin pedidos enviados', texto: 'La utilidad de cada pedido sale de su nota cuando se envía.' }}
          columnas={[
            { id: 'p', titulo: 'Pedido', celda: (p) => <span className="rtm-mono">{p.folio}</span> },
            { id: 'c', titulo: 'Cliente', celda: (p) => p.cliente },
            { id: 'f', titulo: 'Envío', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_envio) },
            { id: 'u', titulo: 'Utilidad', numerica: true, celda: (p) => <>{formatearMoneda(p.utilidad_cent, { conSigno: true })}{p.provisional && <span className="rtm-nota"> · provisional</span>}</> },
            { id: 'k', titulo: 'Cobrado', numerica: true, secundaria: true, celda: (p) => formatearMoneda(p.cobrado_cent) },
          ]}
        />
      </section>

      <section className="rtm-seccion" aria-label="Utilidad acumulada por socio">
        <h2>Utilidad acumulada por socio</h2>
        <p className="rtm-nota" data-testid="utilidad-total">Utilidad total acumulada: <strong>{formatearMoneda(utilidad.utilidad_total_cent, { conSigno: true })}</strong>{utilidad.provisional ? ' · incluye pedidos con costo provisional' : ''}. Se reparte 50/50; el centavo impar va a Angelo.</p>
        <DataTable
          etiqueta="Utilidad acumulada, retirado y retenido por socio"
          clave={(s) => s.socio}
          filas={utilidad.socios}
          columnas={[
            { id: 's', titulo: 'Socio', celda: (s) => s.socio },
            { id: 'm', titulo: 'Su mitad', numerica: true, celda: (s) => formatearMoneda(s.mitad_cent, { conSigno: true }) },
            { id: 'r', titulo: 'Retirado', numerica: true, celda: (s) => formatearMoneda(s.retirado_cent) },
            { id: 't', titulo: 'Retenido (fondos en su poder)', numerica: true, celda: (s) => formatearMoneda(s.retenido_cent) },
          ]}
        />
      </section>

      <section className="rtm-seccion" aria-label="Quién debe a quién">
        <h2>Quién debe a quién</h2>
        <p data-testid="quien-debe"><EstadoTexto tono={debe === 0n ? 'ok' : 'atencion'}>{frase}</EstadoTexto></p>
        <p className="rtm-nota">Sale de la cuenta de socios: lo puesto por cada uno contra la mitad del costo de la compra ({formatearMoneda(utilidad.costo_cent)}). {utilidad.cuadra ? 'Las dos vías de la cifra coinciden.' : 'Las dos vías no coinciden: revisa la cuenta de socios.'} <Link href="/socios">Ver la cuenta de socios</Link>.</p>
      </section>
    </>
  );
}
