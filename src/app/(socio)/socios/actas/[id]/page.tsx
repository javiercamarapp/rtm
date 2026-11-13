import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { historialDeSocio } from '@/composicion/historial';
import { etiquetaFecha, etiquetaFechaHora } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { BotonAccion } from '../../../operacion/formulario-accion';
import { Estado, Pie, m } from '../../../_a3/util';
import { NOMBRES } from '../../../_historial/util';

export const metadata: Metadata = { title: 'Acta de corte' };

/** El resultado de las dos vias lo decide la base; la pantalla solo lo muestra (null = sin comprobar). */
const estadoComprobacion = (v: boolean | null | undefined) => (v === true ? 'cuadra' as const : v === false ? 'no_cuadra' as const : 'sin_comprobar' as const);

const ESTADO = { propuesto: 'Propuesta: faltan las dos firmas', firmado_por_uno: 'Firmada por uno: falta el otro socio', cerrado: 'Cerrada y firmada por los dos', anulado: 'Anulada' } as const;

export default async function PaginaActa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const d = await (await historialDeSocio()).acta(n);
  if (!d) notFound();
  const c = d.cierre;
  const s = c.snapshot;
  const contra = c.tipo === 'contra';
  const k = d.sello?.contenido ?? null;
  const filas = NOMBRES.map((nombre) => {
    const x = contra ? null : s.por_socio[nombre];
    const dec = c.decisiones[nombre] ?? { retira: 0n, reinvierte: 0n };
    const calc = d.por_socio_acta?.[nombre];
    return { nombre, x, dec, disp: calc?.disponible_cent ?? 0n, cuadra: calc?.cuadra ?? null, resto: calc?.queda_cent ?? 0n, sello: k?.por_socio[nombre] ?? null, valor: k?.valor_participacion_cent?.[nombre] ?? null, firma: c.firmas.find((f) => f.socio === nombre) ?? null };
  });
  const pendiente = c.estado === 'propuesto' || c.estado === 'firmado_por_uno';

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/socios/cascada', texto: 'Cascada y actas' }}
        eyebrow={contra ? 'Contra-acta de corte' : 'Acta de corte mensual'}
        titulo={`${c.folio} · ${etiquetaFecha(c.periodo_ini)} al ${etiquetaFecha(c.periodo_fin)}`}
        descripcion={`${ESTADO[c.estado]}${d.corrige_folio ? ` · deshace el acta ${d.corrige_folio}` : ''}${d.contra_acta_folio ? ` · corregida por ${d.contra_acta_folio}` : ''}`}
        acciones={
          <>
            {c.estado !== 'anulado' && <a className="rtm-boton" href={`/socios/actas/${c.id}/pdf`} data-testid="acta-pdf">PDF del acta</a>}
            {pendiente && !c.yo_firme && <BotonAccion primario texto="Firmar" titulo={`Firmar ${c.folio}`} confirmarTexto="Firmar" accion="firmar_cierre_reparto" args={{ p_cierre: c.id }} testid="firmar-acta" />}
            {pendiente && <BotonAccion texto="Anular" accion="anular_cierre_reparto" args={{ p_cierre: c.id }} motivo="Motivo" titulo={`Anular ${c.folio}`} />}
            {c.estado === 'cerrado' && c.tipo === 'periodo' && !c.corregida && <BotonAccion texto="Contra-acta" accion="contra_acta_reparto" args={{ p_cierre: c.id }} motivo="Motivo" titulo={`Corregir ${c.folio} con una contra-acta`} />}
          </>
        }
      />
      {c.utilidad_provisional && <Aviso tono="atencion" titulo="Utilidad provisional.">Había guías sin costo real cuando se propuso el acta.</Aviso>}
      {c.estado === 'cerrado' && !d.sello && !contra && <Aviso tono="atencion" titulo="Sin sello.">El acta se cerró antes de que existiera el sello inmutable; sus cifras siguen en el acta.</Aviso>}

      {contra ? (
        <Tarjeta titulo="Qué corrige esta contra-acta" descripcion="Deshace renglón por renglón los asientos del acta original; el original no se toca">
          <p data-testid="acta-contra-motivo">{c.nota}</p>
        </Tarjeta>
      ) : (
        <>
          <KpiLinea
            etiquetaAria="Cifras del acta"
            celdas={[
              { id: 'u', etiqueta: 'Utilidad neta del periodo', testid: 'acta-utilidad', valor: <CifraComprobada texto={m(c.utilidad_cent, c.utilidad_cent < 0n)} cifra={`cascada:utilidad:${c.periodo_ini}:${c.periodo_fin}`} comprobacion={estadoComprobacion(d.utilidad_cuadra)} />, categoria: 2, nota: c.utilidad_provisional ? 'Provisional' : `Arrastre previo ${m(c.arrastre_ini_cent, c.arrastre_ini_cent < 0n)}` },
              { id: 're', etiqueta: 'Reembolsos pagados', valor: m(s.reembolsos.pagado_cent), categoria: 6, nota: `Pendientes ${m(s.reembolsos.pendiente_cent)}` },
              { id: 'ef', etiqueta: 'Efectivo de la sociedad', valor: m(s.efectivo.total_cent), categoria: 1, nota: s.limitado_por_efectivo ? 'Reparto limitado por el efectivo' : `Comprometido ${m(s.efectivo.comprometido_cent)}` },
              { id: 'rp', etiqueta: 'Utilidad repartida 50/50', testid: 'acta-repartible', valor: m(s.repartible_cent), categoria: 7, nota: `Pasa al siguiente periodo ${m(c.arrastre_fin_cent, c.arrastre_fin_cent < 0n)}` },
              { id: 'cc', etiqueta: 'Capital contable al corte', valor: k?.capital_contable_cent == null ? null : m(k.capital_contable_cent), categoria: 4, nota: k ? `Al ${etiquetaFecha(k.al_corte ?? c.periodo_fin)}, sellado` : 'Se sella al cerrarse el acta' },
              { id: 'va', etiqueta: 'Valuación personal de Angelo', valor: k?.valor_participacion_cent == null ? null : m(k.valor_participacion_cent.Angelo!), categoria: 5, nota: k?.valor_participacion_cent == null ? 'Al corte del acta' : `Javier ${m(k.valor_participacion_cent.Javier!)} · al corte, la misma de Capital por mes` },
            ]}
          />
          <Tarjeta plana titulo="Por socio" descripcion="Su parte 50/50, lo que retira y lo que reinvierte; la reinversión queda como inversión suya">
            <DataTable
              etiqueta="Acta por socio" densidad="densa" plana primeraFija clave={(f) => f.nombre} filas={filas}
              totales={{ etiqueta: 'Suma', celdas: { p: m(filas.reduce((a, f) => a + (f.x?.utilidad_cent ?? 0n), 0n)), r: m(filas.reduce((a, f) => a + f.dec.retira, 0n)), i: m(filas.reduce((a, f) => a + f.dec.reinvierte, 0n)), q: m(filas.reduce((a, f) => a + f.resto, 0n)) } }}
              columnas={[
                { id: 's', titulo: 'Socio', ancho: 'm', prioridadMovil: 'titulo' as const, celda: (f) => <Link href={`/socios/${f.nombre}/historial`} data-testid={`acta-historial-${f.nombre}`}>{f.nombre}</Link> },
                { id: 'rb', titulo: 'Reembolso recibido', numerica: true, ancho: 'm', secundaria: true, celda: (f) => m(f.x?.paga_reembolso_cent ?? 0n) },
                { id: 'p', titulo: 'Su parte (50/50)', numerica: true, ancho: 'm', prioridadMovil: 'normal' as const, celda: (f) => m(f.x?.utilidad_cent ?? 0n) },
                { id: 'a', titulo: 'Retiros previos', numerica: true, ancho: 'm', secundaria: true, celda: (f) => m(f.x?.anticipo_cent ?? 0n) },
                { id: 'd', titulo: 'Disponible', numerica: true, ancho: 'm', celda: (f) => <span className="a3-sin-corte"><CifraComprobada texto={m(f.disp)} cifra={`historial:parte:${c.id}:${f.nombre}`} comprobacion={estadoComprobacion(f.cuadra)} /></span> },
                { id: 'r', titulo: 'Retira', numerica: true, ancho: 'm', celda: (f) => m(f.dec.retira) },
                { id: 'i', titulo: 'Reinvierte', numerica: true, ancho: 'm', celda: (f) => m(f.dec.reinvierte) },
                { id: 'q', titulo: 'Queda por distribuir', numerica: true, ancho: 'm', celda: (f) => m(f.resto) },
                { id: 'fp', titulo: 'Fondos en su poder', numerica: true, ancho: 'm', secundaria: true, celda: (f) => (f.sello?.fondos_en_poder_cent != null ? m(f.sello.fondos_en_poder_cent) : <span className="rtm-sin-dato">Sin dato</span>) },
                { id: 'co', titulo: 'Compensaciones', etiquetaMovil: 'Compens.', numerica: true, ancho: 'm', secundaria: true, celda: (f) => (f.sello ? m(f.sello.compensaciones_cent) : <span className="rtm-sin-dato">Sin dato</span>) },
                { id: 'iv', titulo: 'Invertido tras el acta', etiquetaMovil: 'Invertido', numerica: true, ancho: 'm', secundaria: true, celda: (f) => (f.sello?.invertido_tras_acta_cent != null ? m(f.sello.invertido_tras_acta_cent) : <span className="rtm-sin-dato">Sin dato</span>) },
                { id: 'v', titulo: 'Valuación personal al corte', etiquetaMovil: 'Valuación', numerica: true, ancho: 'l', prioridadMovil: 'normal' as const, celda: (f) => (f.valor === null ? <span className="rtm-sin-dato">Sin dato</span> : m(f.valor)) },
              ]}
            />
          </Tarjeta>
        </>
      )}

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Firmas" descripcion="Las firman los dos socios (web y botón en Telegram); cada firma recalcula con los libros de ese momento">
          <DataTable
            etiqueta="Firmas del acta" densidad="densa" plana clave={(f) => f.nombre} filas={filas}
            columnas={[
              { id: 's', titulo: 'Socio', ancho: 'm', prioridadMovil: 'titulo' as const, celda: (f) => f.nombre },
              { id: 'e', titulo: 'Estado', ancho: 'l', prioridadMovil: 'principal' as const, celda: (f) => (f.firma ? <Estado tono="ok">Firmada</Estado> : <Estado tono={c.estado === 'anulado' ? 'neutro' : 'atencion'}>{c.estado === 'anulado' ? 'No aplica' : 'Pendiente'}</Estado>) },
              { id: 'f', titulo: 'Fecha', ancho: 'l', celda: (f) => (f.firma ? <span className="rtm-nowrap">{etiquetaFechaHora(f.firma.firmado_at)}</span> : <span className="rtm-sin-dato">Sin dato</span>) },
            ]}
          />
          <Pie>Propuesta por {c.propuesto_por ?? 'un socio'} el {etiquetaFechaHora(c.creado_at)}. Un acta firmada por los dos no se edita: se corrige con una contra-acta.</Pie>
        </Tarjeta>
        <Tarjeta titulo="Sello del acta" descripcion="Foto inmutable al cerrarse con las dos firmas">
          {d.sello ? (
            <FilaRatios etiqueta="Sello" items={[
              { etiqueta: 'Sellado', valor: etiquetaFechaHora(d.sello.sellado_at) },
              { etiqueta: 'Huella SHA-256', valor: <span className="rtm-mono" data-testid="acta-huella" title={d.sello.huella}>{d.sello.huella.slice(0, 16)}…{d.sello.huella.slice(-8)}</span> },
              { etiqueta: 'Deudas de la sociedad', valor: k?.deudas_cent == null ? null : m(k.deudas_cent) },
              { etiqueta: 'Valuación al costo', valor: k?.valuacion_cent == null ? null : m(k.valuacion_cent) },
            ]} />
          ) : <p className="a3-grafica-vacia"><strong>{contra ? 'Las contra-actas no se sellan' : 'Sin sello todavía'}</strong>{contra ? 'Su efecto queda en los renglones contrarios del libro.' : 'El sello se toma al firmar el segundo socio.'}</p>}
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
