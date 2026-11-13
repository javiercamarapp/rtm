import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, etiquetaFechaHora, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, Chip } from '@/ui/componentes/controles';
import { LineaTiempo } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Dos, Estado, m } from '../../../_a3/util';
import { ESTADO_COMPRA } from '../../../operacion/etiquetas';
import { progresoRecepcion } from '@/dominio/operacion/devoluciones';
import { AccionesCompra, AsignarDiferencia, FormularioLlegada, FormularioRecepcion, type SaborOpcion } from './acciones-compra';

export const metadata: Metadata = { title: 'Orden de compra' };

export default async function PaginaCompra({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const lector = await operacionDeSocio();
  const [c, rec] = await Promise.all([lector.compra(n), lector.compraRecepcion(n)]);
  if (!c) notFound();
  // Una sola verdad por proveedor: su posicion completa del libro (no solo la cuenta corriente).
  const posicion = (await lector.cuentaProveedor(c.proveedor.nombre)).posicion_cent;
  const enRecepcion = c.estado === 'recibida_parcial';
  const cerrada = c.estado !== 'recibida_parcial';
  const recibible = ['confirmada', 'enviada', 'en_trayecto', 'llego_merida', 'recibida_parcial'].includes(c.estado);
  const catalogo = recibible ? await lector.catalogoCompra(c.proveedor.nombre) : null;
  const sabores: Record<string, SaborOpcion[]> = {};
  for (const s of catalogo?.skus ?? []) (sabores[s.modelo] ??= []).push({ sku_id: s.sku_id, sabor: s.sabor });
  const palabra = posicion > 0n ? 'A favor' : posicion < 0n ? 'Se le debe' : 'Saldo cero';

  const piezasPag = c.lineas.reduce((a, l) => a + l.pagadas, 0);
  const piezasFac = c.lineas.reduce((a, l) => a + l.facturadas, 0);
  const piezasRec = c.lineas.every((l) => l.recibidas !== null) ? c.lineas.reduce((a, l) => a + (l.recibidas ?? 0), 0) : null;
  const costoPuesto = c.lineas.every((l) => l.lote) ? c.lineas.reduce((a, l) => a + (l.lote?.valor_entrada_cent ?? 0n), 0n) : null;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: `/proveedores?p=${c.proveedor.nombre}`, texto: 'Proveedores' }}
        eyebrow={`Orden de compra ${c.folio}`}
        titulo={`Orden de compra a ${c.proveedor.nombre}`}
        descripcion={`Creada el ${etiquetaFecha(c.fecha_neg)}. El dinero se aplica al confirmar; las piezas suman al inventario cuando un socio confirma la recepción.`}
        acciones={<AccionesCompra compra={c} />}
      />
      <div className="rtm-acciones-fila" aria-label="Estado de la orden">
        <span data-testid="estado-oc"><Estado tono={ESTADO_COMPRA[c.estado].tono}>{ESTADO_COMPRA[c.estado].texto}</Estado></span>
        {c.guias.map((g) => <Chip key={g.id}>Guía {g.paqueteria} {g.numero}</Chip>)}
        {c.llegada_estimada && <Chip>Llegada estimada {etiquetaFecha(c.llegada_estimada)}</Chip>}
      </div>

      <KpiLinea
        etiquetaAria="Indicadores de la orden"
        celdas={[
          { id: 'mer', etiqueta: 'Mercancía', valor: m(c.mercancia_cent), categoria: 1, nota: `${formatearPiezas(piezasPag)} piezas pagadas` },
          { id: 'gs', etiqueta: 'Guía y seguro', valor: m(c.guia_cent + c.seguro_cent), categoria: 6, nota: `Guía ${m(c.guia_cent)} · seguro ${m(c.seguro_cent)}` },
          { id: 'tot', etiqueta: 'Total de la orden', valor: m(c.total_cent), categoria: 2, nota: costoPuesto === null ? 'Costo puesto: sin dato hasta recibir' : `${enRecepcion ? 'Ya entró al inventario' : 'Costo puesto'} ${m(costoPuesto)}` },
          { id: 'rec', etiqueta: 'Piezas recibidas', valor: piezasRec === null ? null : formatearPiezas(piezasRec), categoria: 4, nota: `Pagadas ${formatearPiezas(piezasPag)} · facturadas ${formatearPiezas(piezasFac)}` },
          { id: 'sal', etiqueta: `Cuenta con ${c.proveedor.nombre} (${palabra})`, valor: <CifraComprobada texto={m(posicion < 0n ? -posicion : posicion)} cifra={`proveedor:posicion:${c.proveedor.nombre}`} comprobacion="cuadra" />, categoria: 7 },
        ]}
      />

      {c.partidas_fuera_sociedad.map((f, i) => <Aviso key={i} tono="atencion" titulo="Fuera de la sociedad.">{f.socio} pagó {m(f.monto_cent)}{f.piezas ? ` por ${formatearPiezas(f.piezas)} de más` : ''}. No entra al balance de la sociedad ni se mezcla con las diferencias de recepción.</Aviso>)}

      <Tarjeta plana titulo="Pagadas, facturadas y recibidas" descripcion="Costo por pieza y costo puesto (con guía y seguro) de cada renglón">
        <DataTable
          etiqueta={`Renglones de ${c.folio}`}
          densidad="densa" plana primeraFija
          clave={(l) => l.id}
          filas={c.lineas}
          totales={{ etiqueta: 'Total', celdas: { p: formatearPiezas(piezasPag), f: formatearPiezas(piezasFac), r: piezasRec === null ? 'Sin dato' : formatearPiezas(piezasRec) } }}
          columnas={[
            { id: 'm', titulo: 'Modelo', ancho: 'l', celda: (l) => <Dos a={l.modelo} b={l.sabor} /> },
            { id: 'p', titulo: 'Pagadas', numerica: true, ancho: 's', celda: (l) => formatearPiezas(l.pagadas) },
            { id: 'f', titulo: 'Facturadas', numerica: true, ancho: 's', celda: (l) => formatearPiezas(l.facturadas) },
            { id: 'r', titulo: 'Recibidas', numerica: true, ancho: 's', celda: (l) => (l.recibidas === null ? <SinDato /> : formatearPiezas(l.recibidas)) },
            { id: 'c', titulo: 'Costo', numerica: true, ancho: 'm', celda: (l) => <Dos a={m(l.costo_unit_cent)} b={l.motivo_costo ? `Motivo: ${l.motivo_costo}` : l.costo_lista_cent !== null ? `lista ${m(l.costo_lista_cent)}` : undefined} /> },
            { id: 'cp', titulo: 'Costo puesto', numerica: true, ancho: 'm', secundaria: true, celda: (l) => (l.lote ? m(l.lote.costo_puesto_cent) : <SinDato />) },
            { id: 'vl', titulo: 'Valor de entrada', numerica: true, ancho: 'm', secundaria: true, celda: (l) => (l.lote ? m(l.lote.valor_entrada_cent) : <SinDato />) },
          ]}
        />
      </Tarjeta>

      {rec && (enRecepcion || rec.llegadas.length > 0) && (
        <Tarjeta plana titulo="Llegadas de la orden" descripcion={cerrada ? `Recepción cerrada: llegaron ${formatearPiezas(rec.lineas.reduce((a, l) => a + l.recibidas, 0))} de ${formatearPiezas(rec.lineas.reduce((a, l) => a + l.facturadas, 0))} facturadas; el faltante pasó a diferencia` : `${progresoRecepcion(rec.lineas)} % de lo facturado ya llegó`}>
          <DataTable etiqueta="Avance de la recepción por renglón" densidad="densa" plana primeraFija clave={(l) => l.linea_id} filas={rec.lineas}
            totales={{ etiqueta: 'Total', celdas: { f: formatearPiezas(rec.lineas.reduce((a, l) => a + l.facturadas, 0)), r: formatearPiezas(rec.lineas.reduce((a, l) => a + l.recibidas, 0)), p: formatearPiezas(rec.lineas.reduce((a, l) => a + l.pendientes, 0)), e: m(rec.lineas.reduce((a, l) => a + l.entrada_cent, 0n)), c: m(rec.lineas.reduce((a, l) => a + l.puesto_cent, 0n)) } }}
            columnas={[
              { id: 'm', titulo: 'Modelo', ancho: 'l', celda: (l) => <Dos a={l.modelo} b={l.sabor} /> },
              { id: 'f', titulo: 'Facturadas', numerica: true, ancho: 's', celda: (l) => formatearPiezas(l.facturadas) },
              { id: 'r', titulo: 'Llegadas', numerica: true, ancho: 's', celda: (l) => formatearPiezas(l.recibidas) },
              { id: 'p', titulo: cerrada ? 'No llegaron' : 'Pendientes', numerica: true, ancho: 's', celda: (l) => formatearPiezas(l.pendientes) },
              { id: 'e', titulo: 'Entró al inventario', numerica: true, ancho: 'm', celda: (l) => m(l.entrada_cent) },
              { id: 'c', titulo: 'Costo puesto', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.puesto_cent) },
            ]}
          />
          {rec.llegadas.length > 0 && (
            <DataTable etiqueta="Llegadas registradas" densidad="densa" plana clave={(x) => `${x.n}-${x.contado_at}-${x.piezas}`} filas={rec.llegadas}
              columnas={[
                { id: 'h', titulo: 'Contada', ancho: 'l', celda: (x) => etiquetaFechaHora(x.contado_at) },
                { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => formatearPiezas(x.piezas) },
                { id: 'v', titulo: 'Valor que entró', numerica: true, ancho: 'm', celda: (x) => m(x.valor_cent) },
              ]}
            />
          )}
        </Tarjeta>
      )}

      {enRecepcion && rec && <FormularioLlegada compra={c} recepcion={rec} sabores={sabores} />}
      {recibible && !enRecepcion && rec && rec.llegadas.length === 0 && (
        <>
          <FormularioRecepcion compra={c} sabores={sabores} />
          <FormularioLlegada compra={c} recepcion={rec} sabores={sabores} />
        </>
      )}

      <Rejilla dividir="12">
        <div className="a3-pila">
          {c.recepciones.length > 0 && (
            <Tarjeta plana titulo="Recepción por sabor">
              <DataTable etiqueta="Recepción por sabor" densidad="densa" plana clave={(r) => `${r.modelo}-${r.sabor}-${r.contado_at}`} filas={c.recepciones}
                totales={{ etiqueta: 'Total', celdas: { p: formatearPiezas(c.recepciones.reduce((a, r) => a + r.piezas, 0)) } }}
                columnas={[{ id: 'm', titulo: 'Modelo · sabor', ancho: 'l', celda: (r) => <Dos a={r.modelo} b={r.sabor} /> }, { id: 'p', titulo: 'Contadas', numerica: true, ancho: 's', celda: (r) => formatearPiezas(r.piezas) }, { id: 'h', titulo: 'Contadas el', ancho: 'm', secundaria: true, celda: (r) => etiquetaFechaHora(r.contado_at) }]} />
            </Tarjeta>
          )}
          {c.diferencias.length > 0 && (
            <Tarjeta plana titulo="Diferencias de recepción" descripcion="Mientras nadie sea responsable, la diferencia vive en la cuenta puente">
              <DataTable
                etiqueta="Diferencias de recepción"
                densidad="densa" plana
                clave={(d) => d.id}
                filas={c.diferencias}
                totales={{ etiqueta: 'Total', celdas: { p: formatearPiezas(c.diferencias.reduce((a, d) => a + d.piezas, 0)), v: m(c.diferencias.reduce((a, d) => a + d.valor_cent, 0n)) } }}
                columnas={[
                  { id: 'm', titulo: 'Modelo', ancho: 'l', celda: (d) => d.modelo },
                  { id: 't', titulo: 'Tipo', ancho: 's', celda: (d) => (d.tipo === 'faltante' ? 'Faltante' : 'Sobrante') },
                  { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (d) => formatearPiezas(d.piezas) },
                  { id: 'v', titulo: 'Valor al costo promedio', numerica: true, ancho: 'm', celda: (d) => m(d.valor_cent) },
                  { id: 'r', titulo: 'Responsable', ancho: 'l', celda: (d) => (d.tipo === 'faltante' ? <AsignarDiferencia diferenciaId={d.id} actual={d.responsable ?? 'sociedad'} /> : 'La sociedad (cuenta puente)') },
                ]}
              />
            </Tarjeta>
          )}
        </div>
        <Tarjeta titulo="Línea de tiempo">
          <LineaTiempo columnas={2} eventos={c.linea_tiempo.map((e) => ({ id: e.evento, fecha: etiquetaFechaHora(e.hora), titulo: (e.tipo ?? e.evento).replaceAll('_', ' '), detalle: `${e.autor ?? e.canal} · ${e.evento}` }))} />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
