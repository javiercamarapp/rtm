import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, etiquetaFechaHora, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, Segmentado } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada, ColumnasPeriodo } from '@/ui/graficas';
import { Dos, Estado, Pie, m, pct, suma } from '../_a3/util';
import { CerrarSemana, ExportarCsv, FormularioToma, PagoOmar, ResolverToma } from './acciones-omar';

export const metadata: Metadata = { title: 'Cuenta con Omar' };

type Vista = 'renta' | 'tomas' | 'pagos' | 'liquidaciones';
const VISTAS: Vista[] = ['renta', 'tomas', 'pagos', 'liquidaciones'];

export default async function PaginaOmar({ searchParams }: { searchParams: Promise<{ semana?: string; vista?: string }> }) {
  const { semana, vista: vq = '' } = await searchParams;
  const sem = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : null;
  const vista: Vista = (VISTAS as string[]).includes(vq) ? (vq as Vista) : 'renta';
  const o = await (await operacionDeSocio()).omarCuenta(sem);
  const neto = o.neto_cent;
  const nav = (dias: number) => `/omar?semana=${sumarDias(o.semana_ini, dias)}${vista !== 'renta' ? `&vista=${vista}` : ''}`;
  const enlace = (v: Vista) => `/omar?${sem ? `semana=${sem}&` : ''}vista=${v}`.replace(/[?&]vista=renta$/, '').replace(/\?$/, '');
  const pasos = [
    { id: 'r', etiqueta: 'Renta devengada', valor: Number(o.renta_cent), tipo: 'inicio' as const, texto: m(o.renta_cent) },
    { id: 't', etiqueta: 'Tomas a su precio', valor: -Number(o.tomas_cent), tipo: 'delta' as const, texto: m(-o.tomas_cent, true) },
    { id: 'n', etiqueta: 'Neto de la semana', valor: Number(neto), tipo: 'total' as const, texto: m(neto, true) },
  ];
  const liq = [...o.liquidaciones].sort((a, b) => (a.semana_ini < b.semana_ini ? -1 : 1));
  const etiquetaSemana = (ini: string) => etiquetaFecha(ini).replace(/ de \d{4}$/, '');
  const colRenta = [
    ...liq.map((l) => ({ id: l.folio, etiqueta: etiquetaSemana(l.semana_ini), valor: Number(l.renta_cent), texto: m(l.renta_cent), detalle: `Tomas ${m(l.tomas_cent)} · neto ${m(l.neto_cent, true)} · ${l.palabra}` })),
    ...(o.estado === 'abierta' ? [{ id: 'abierta', etiqueta: etiquetaSemana(o.semana_ini), valor: Number(o.renta_cent), texto: m(o.renta_cent), parcial: true, detalle: 'Semana abierta' }] : []),
  ];
  const colTomas = [
    ...liq.map((l) => ({ id: l.folio, etiqueta: etiquetaSemana(l.semana_ini), valor: Number(l.tomas_cent), texto: m(l.tomas_cent) })),
    ...(o.estado === 'abierta' ? [{ id: 'abierta', etiqueta: etiquetaSemana(o.semana_ini), valor: Number(o.tomas_cent), texto: m(o.tomas_cent), parcial: true }] : []),
  ];
  const piezasRenta = o.renta.reduce((a, r) => a + r.piezas, 0);
  const piezasTomas = o.tomas.reduce((a, t) => a + t.piezas, 0);
  const pagosA = suma(o.pagos.filter((p) => p.sentido === 'a_omar').map((p) => p.monto_cent));
  const pagosDe = suma(o.pagos.filter((p) => p.sentido === 'de_omar').map((p) => p.monto_cent));
  const pestanas = { etiquetaAria: 'Vistas de la cuenta con Omar', items: ([['renta', 'Renta por pieza', o.renta.length], ['tomas', 'Tomas a su precio', o.tomas.length], ['pagos', 'Pagos', o.pagos.length], ['liquidaciones', 'Liquidaciones cerradas', o.liquidaciones.length]] as [Vista, string, number][]).map(([id, etiqueta, contador]) => ({ id, etiqueta, href: enlace(id), activa: vista === id, contador })) };
  const csv = [
    ['Tipo', 'Fecha', 'Referencia', 'Pieza', 'Piezas', 'Importe'],
    ...o.renta.map((r) => ['Renta', r.fecha, r.folio, r.modelo, String(r.piezas), m(r.monto_cent)]),
    ...o.tomas.filter((t) => t.subtotal_cent !== null).map((t) => ['Toma', t.fecha, t.folio, `${t.modelo} ${t.sabor}`, String(t.piezas), m(-(t.subtotal_cent ?? 0n))]),
    ['Neto', o.semana_ini, '', '', '', m(neto)],
  ];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Cuenta con Omar"
        titulo="Cuenta con Omar"
        descripcion={`Del ${etiquetaFecha(o.semana_ini)} al ${etiquetaFecha(o.semana_fin)} · ${o.estado === 'cerrada' ? `liquidada (${o.liquidacion})` : 'abierta'} · ${neto === 0n ? 'saldo cero' : neto > 0n ? `le debemos ${m(neto)}` : `Omar nos debe ${m(-neto)}`}`}
        acciones={
          <div className="a3-acciones">
            <Segmentado etiquetaAria="Semana" opciones={[{ valor: 'a', etiqueta: 'Semana anterior', href: nav(-7), activa: false }, { valor: 'h', etiqueta: 'Esta semana', href: '/omar', activa: !sem }, { valor: 's', etiqueta: 'Semana siguiente', href: nav(7), activa: false }]} />
            <FormularioToma skus={o.skus.map((s) => ({ sku_id: s.sku_id, etiqueta: `${s.modelo} · ${s.sabor} (${s.existencia} pz${s.precio_cent === null ? ', sin precio' : ` a ${m(s.precio_cent)}`})` }))} />
            <PagoOmar />
            <CerrarSemana semana={o.semana_ini} desactivado={!o.puede_cerrar} />
          </div>
        }
      />
      {o.semana_anterior_sin_cerrar && (
        <div data-testid="semana-sin-cerrar"><Aviso tono="atencion" titulo="Semana sin cerrar.">La semana del {etiquetaFecha(o.semana_anterior_sin_cerrar)} sigue sin cerrar. <Link href={`/omar?semana=${o.semana_anterior_sin_cerrar}`}>Revisarla</Link></Aviso></div>
      )}
      {o.tomas_sin_precio > 0 && <Aviso tono="atencion" titulo={`${o.tomas_sin_precio} ${o.tomas_sin_precio === 1 ? 'toma' : 'tomas'} sin precio.`}>No entran al saldo hasta que tengan precio.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores de la cuenta con Omar"
        celdas={[
          { id: 'renta', etiqueta: 'Renta devengada', valor: m(o.renta_cent), categoria: 1, nota: `${formatearPiezas(piezasRenta)} piezas surtidas · ${m(o.renta_por_pieza_cent)} por pieza` },
          { id: 'tomas', etiqueta: 'Tomas a su precio', valor: m(o.tomas_cent), categoria: 6, nota: `${formatearPiezas(piezasTomas)} piezas · compensado ${m(o.compensado_cent)}` },
          { id: 'neto', etiqueta: 'Neto de la semana', testid: 'neto-omar', valor: <CifraComprobada texto={m(neto, true)} cifra={`omar:neto:${o.semana_ini}`} comprobacion="cuadra" />, categoria: 2, nota: <span data-testid="palabra-omar"><Estado tono={neto === 0n ? 'ok' : 'atencion'}>{o.palabra}</Estado></span> },
          { id: 'saldo', etiqueta: 'Saldo acumulado de la cuenta', valor: m(o.saldo_cuenta_cent, true), categoria: 4, nota: `Pagos de la semana ${m(o.pagos_semana_cent)}` },
          { id: 'pend', etiqueta: 'Tomas pendientes de autorizar', valor: String(o.tomas_pendientes), categoria: 7, nota: o.tomas_pendientes > 0 ? 'Caducan solas si nadie las autoriza' : 'Nada por autorizar' },
        ]}
      />
      <FilaRatios
        etiqueta="Razones de la semana"
        items={[
          { etiqueta: 'Renta por pieza', valor: m(o.renta_por_pieza_cent) },
          { etiqueta: 'Tomas sobre renta', valor: pct(o.tomas_cent, o.renta_cent) === null ? null : `${pct(o.tomas_cent, o.renta_cent)!.toFixed(1)} %` },
          { etiqueta: 'Pagos a Omar', valor: m(pagosA) },
          { etiqueta: 'Pagos de Omar', valor: m(pagosDe) },
          { etiqueta: 'Piezas surtidas / tomadas', valor: `${formatearPiezas(piezasRenta)} / ${formatearPiezas(piezasTomas)}` },
        ]}
      />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Renta menos tomas igual al neto" descripcion="De lo que se devenga a lo que se liquida">
          <Cascada titulo="Cascada de la semana con Omar" descripcion={`Renta ${m(o.renta_cent)}, tomas ${m(o.tomas_cent)}, neto ${m(neto, true)}.`} pasos={pasos} unidad="Pesos" />
        </Tarjeta>
        <Tarjeta titulo="Renta devengada por semana" descripcion="La semana abierta va con trama">
          {colRenta.length >= 2 ? (
            <ColumnasPeriodo titulo="Renta por semana" descripcion={`Renta devengada de ${colRenta.length} semanas.`} unidad="Pesos" procedencia="observado" pie="Fuente: liquidaciones cerradas y semana en curso" datos={colRenta} />
          ) : <p className="a3-grafica-vacia"><strong>Pocas semanas</strong>Con dos o más semanas se dibuja la renta por semana.</p>}
        </Tarjeta>
      </Rejilla>
      {colTomas.length >= 2 && (
        <Tarjeta titulo="Tomas por semana" descripcion="Lo que Omar tomó a su precio">
          <ColumnasPeriodo titulo="Tomas por semana" descripcion={`Tomas a su precio de ${colTomas.length} semanas.`} unidad="Pesos" procedencia="observado" pie="Fuente: tomas autorizadas" datos={colTomas} alto={140} />
        </Tarjeta>
      )}

      {o.pendientes.length > 0 && (
        <Tarjeta plana titulo="Pendientes de autorización" descripcion="No cambian el saldo ni el inventario hasta que un socio las autorice; caducan solas">
          <DataTable etiqueta="Tomas pendientes" densidad="densa" plana clave={(t) => t.id} filas={o.pendientes}
            columnas={[
              { id: 'f', titulo: 'Toma', ancho: 'm', celda: (t) => <span className="rtm-mono">{t.folio}</span> },
              { id: 'm', titulo: 'Pieza', ancho: 'xl', celda: (t) => `${t.modelo} · ${t.sabor}` },
              { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (t) => formatearPiezas(t.piezas) },
              { id: 'r', titulo: 'Precio', numerica: true, ancho: 'm', secundaria: true, celda: (t) => (t.precio_cent === null ? <Estado tono="atencion">Falta precio</Estado> : m(t.precio_cent)) },
              { id: 'c', titulo: 'Caduca', ancho: 'l', secundaria: true, celda: (t) => etiquetaFechaHora(t.caduca_at) },
              { id: 'a', titulo: '', ancho: 'l', celda: (t) => <ResolverToma id={t.id} /> },
            ]} />
        </Tarjeta>
      )}

      <Tarjeta plana titulo={pestanas.items.find((i) => i.activa)?.etiqueta} acciones={<ExportarCsv nombre={`omar-${o.semana_ini}.csv`} filas={csv} />}>
        {vista === 'renta' && (
          <DataTable etiqueta="Renta devengada" densidad="densa" plana pegajosa primeraFija pestanas={pestanas} interactiva={{ busqueda: 'Buscar pedido o modelo', porPagina: 50 }} clave={(r) => r.id} filas={o.renta}
            totales={{ etiqueta: `Total (${o.renta.length})`, celdas: { p: formatearPiezas(piezasRenta), s: m(o.renta_cent) } }}
            vacio={{ titulo: 'Sin renta', texto: 'La renta se devenga solo cuando una pieza sale de la Bodega Omar al marcar enviado el pedido. Aún no hay movimientos esta semana.' }}
            columnas={[
              { id: 'f', titulo: 'Pedido', ancho: 'm', celda: (r) => <span className="rtm-mono">{r.folio}</span> },
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (r) => etiquetaFecha(r.fecha) },
              { id: 'm', titulo: 'Modelo y sabor', ancho: 'xl', celda: (r) => `${r.modelo}${r.sabores ? ` · ${r.sabores}` : ''}` },
              { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (r) => formatearPiezas(r.piezas) },
              { id: 't', titulo: 'Tarifa', numerica: true, ancho: 'm', secundaria: true, celda: (r) => (r.tarifa_cent === null ? <SinDato /> : m(r.tarifa_cent)) },
              { id: 's', titulo: 'Subtotal', numerica: true, ancho: 'm', celda: (r) => m(r.monto_cent, r.monto_cent < 0n) },
            ]} />
        )}
        {vista === 'tomas' && (
          <DataTable etiqueta="Tomas de Omar" densidad="densa" plana pegajosa primeraFija pestanas={pestanas} interactiva={{ busqueda: 'Buscar toma', porPagina: 50 }} clave={(t) => t.id} filas={o.tomas}
            totales={{ etiqueta: `Total (${o.tomas.length})`, celdas: { p: formatearPiezas(piezasTomas), s: m(suma(o.tomas.map((t) => t.subtotal_cent ?? 0n))) } }}
            vacio={{ titulo: 'Sin tomas', texto: 'Las piezas que Omar toma a crédito aparecen aquí con su precio.' }}
            columnas={[
              { id: 'f', titulo: 'Toma', ancho: 'm', celda: (t) => <span className="rtm-mono">{t.folio}</span> },
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (t) => etiquetaFecha(t.fecha) },
              { id: 'm', titulo: 'Pieza', ancho: 'xl', celda: (t) => <Dos a={t.modelo} b={t.sabor} /> },
              { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (t) => formatearPiezas(t.piezas) },
              { id: 'r', titulo: 'Precio', numerica: true, ancho: 'm', secundaria: true, celda: (t) => (t.precio_cent === null ? <Estado tono="atencion">Falta precio</Estado> : m(t.precio_cent)) },
              { id: 's', titulo: 'Subtotal', numerica: true, ancho: 'm', celda: (t) => (t.subtotal_cent === null ? <SinDato /> : m(t.subtotal_cent)) },
              { id: 'e', titulo: 'Estado', ancho: 'm', secundaria: true, celda: (t) => t.estado },
            ]} />
        )}
        {vista === 'pagos' && (
          <DataTable etiqueta="Pagos con Omar" densidad="densa" plana pegajosa primeraFija pestanas={pestanas} clave={(p) => p.id} filas={o.pagos}
            totales={{ etiqueta: `Total (${o.pagos.length})`, celdas: { m: m(suma(o.pagos.map((p) => p.monto_cent))) } }}
            vacio={{ titulo: 'Sin pagos', texto: 'No se ha registrado ningún pago con Omar esta semana.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'm', celda: (p) => <span className="rtm-mono">{p.folio}</span> },
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (p) => etiquetaFecha(p.fecha) },
              { id: 's', titulo: 'Sentido', ancho: 'm', celda: (p) => (p.sentido === 'a_omar' ? 'A Omar' : 'De Omar') },
              { id: 'v', titulo: 'Vía y socio', ancho: 'l', secundaria: true, celda: (p) => <Dos a={p.via} b={p.socio} /> },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (p) => m(p.monto_cent) },
            ]} />
        )}
        {vista === 'liquidaciones' && (
          <DataTable etiqueta="Liquidaciones de Omar" densidad="densa" plana pegajosa primeraFija pestanas={pestanas} clave={(l) => l.folio} filas={o.liquidaciones}
            totales={{ etiqueta: `Total (${o.liquidaciones.length})`, celdas: { r: m(suma(o.liquidaciones.map((l) => l.renta_cent))), t: m(suma(o.liquidaciones.map((l) => l.tomas_cent))), n: m(suma(o.liquidaciones.map((l) => l.neto_cent)), true) } }}
            vacio={{ titulo: 'Sin liquidaciones', texto: 'La semana se cierra el lunes siguiente, con corte el lunes.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'm', celda: (l) => <span className="rtm-mono">{l.folio}</span> },
              { id: 's', titulo: 'Semana', ancho: 'l', celda: (l) => `${etiquetaFecha(l.semana_ini)} al ${etiquetaFecha(l.semana_fin)}` },
              { id: 'r', titulo: 'Renta', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.renta_cent) },
              { id: 't', titulo: 'Tomas', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.tomas_cent) },
              { id: 'c', titulo: 'Compensado', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.compensado_cent) },
              { id: 'n', titulo: 'Neto', numerica: true, ancho: 'm', celda: (l) => m(l.neto_cent, true) },
              { id: 'p', titulo: 'Resultado', ancho: 'm', celda: (l) => l.palabra },
              { id: 'k', titulo: 'Cierre', ancho: 's', secundaria: true, celda: (l) => etiquetaFecha(l.fecha_cierre) },
            ]} />
        )}
        <div className="a3-pie-tarjeta"><Pie>Omar (bodega) no es Omar Aguilar (cliente). Omar presta el lugar, no despacha y su acceso sigue desactivado. La renta se devenga por pieza surtida desde su bodega.</Pie></div>
      </Tarjeta>
    </Pagina>
  );
}
