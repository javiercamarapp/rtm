import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { Chip, ChipEstado, Pestanas } from '@/ui/componentes/controles';
import { LineaTiempo, ListaClaveValor, Pasos } from '@/ui/componentes/datos';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import '@/ui/estilos/paginas-a1.css';
import { aNumero } from '@/dominio/tablero/agregados';
import { origenSurtido } from '@/dominio/dropshipping/calculos';
import { etiquetaHoy } from '../../contexto';
import { AVISO_PEDIDO, ESTADO_PEDIDO, ORIGEN } from '../../operacion/etiquetas';
import { AccionesPedido } from './acciones-pedido';
import { BotonCopiar } from './boton-copiar';
import { NotaCliente } from './nota-vista';
import { AnularDevolucionCliente, DevolverMercancia } from './devolucion-pedido';

export const metadata: Metadata = { title: 'Pedido' };

const TONO_ESTADO = { borrador: 'apagado', confirmado: 'atencion', enviado: 'ok', cancelado: 'apagado', anulado: 'malo' } as const;
const VISTAS = [{ clave: 'nota', texto: 'Nota' }, { clave: 'interna', texto: 'Hoja interna' }, { clave: 'versiones', texto: 'Versiones' }] as const;

export default async function PaginaPedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vista?: string; nota?: string }> }) {
  const { id } = await params;
  const { vista = 'nota', nota: notaSel } = await searchParams;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const lector = await operacionDeSocio();
  const [p, ctx, dev] = await Promise.all([lector.pedido(n), lector.contextoPagos(), lector.pedidoDevoluciones(n)]);
  if (!p) notFound();

  const notas = p.notas;
  const vigente = notas.find((x) => x.vigente) ?? null;
  const verNota = (notaSel ? notas.find((x) => x.id === Number(notaSel)) : null) ?? vigente;
  const avisosPendientes = p.avisos.filter((a) => a.decidido_por === null).length;
  const cuentas = ctx.cuentas.map((c) => c.nombre);
  const enviado = p.estado === 'enviado';
  const anulado = p.estado === 'anulado';

  const hechos = [true, p.estado !== 'borrador', p.empacado_at !== null || enviado, p.enviado_at !== null || enviado, p.entregado_at !== null, enviado && p.saldo_cent === 0n];
  const actualPaso = anulado ? -1 : hechos.findIndex((h) => !h) === -1 ? hechos.length : hechos.findIndex((h) => !h);
  const piezasPedidas = p.lineas.reduce((a, l) => a + l.piezas_pedidas, 0);
  const piezasSurtidas = p.lineas.reduce((a, l) => a + l.piezas_surtidas, 0);
  const interno = (verNota ?? vigente)?.interno ?? null;
  const cas = interno?.cascada ?? null;
  // Con devoluciones vigentes las cifras salen netas desde la base: la utilidad y el margen se leen sobre lo cobrado neto, no sobre la nota original.
  const neta = dev && dev.devuelto_cent > 0n && cas ? dev.cascada_neta : null;
  const costoVista = neta ? neta.costo_cent : cas?.costo_cent ?? null;
  const utilidadVista = neta ? neta.utilidad_cent : cas?.utilidad_cent ?? null;
  const totalVista = neta ? neta.total_cent : cas?.total_cent ?? null;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/pedidos', texto: 'Volver a pedidos' }}
        eyebrow={`Pedido ${p.folio} · ${etiquetaHoy()}`}
        titulo={`${p.cliente.nombre} · ${p.folio}`}
        acciones={
          <AccionesPedido
            pedidoId={p.id} folio={p.folio} clienteId={p.cliente.id} estado={p.estado} empacado={p.empacado_at !== null} entregado={p.entregado_at !== null}
            puedeEmpacar={p.origen === 'bodega_omar' || p.origen === 'castores'} avisosPendientes={avisosPendientes} cuentas={cuentas} saldoCent={p.saldo_cent}
            fichaDs={origenSurtido(p.origen) === 'dropshipping' ? `/dropshipping/pedidos/${p.id}` : undefined}
            renglones={p.lineas.map((l) => ({ linea_id: l.id, modelo: l.modelo, sabor: l.sabor, piezas: l.piezas_pedidas, disponible: l.disponible }))}
            lineasNota={p.lineas.filter((l) => l.piezas_surtidas > 0).map((l) => ({ id: l.id, etiqueta: `${nombreVape(l.modelo)} ${saborMayus(l.sabor)}`, precio_cent: l.precio_cent }))}
          />
        }
        descripcion={`${ORIGEN[p.origen]} · creado el ${etiquetaFecha(p.fecha_neg)}${p.fecha_envio ? ` · enviado el ${etiquetaFecha(p.fecha_envio)}` : ''}. Nada se descuenta ni devenga renta antes de marcarlo enviado.`}
      />
      <div className="rtm-a1-etiquetas" aria-label="Estado del pedido">
        <span className="rtm-etiqueta" data-testid="estado-pedido"><ChipEstado tono={TONO_ESTADO[p.estado]}>{ESTADO_PEDIDO[p.estado].texto}</ChipEstado></span>
        {p.plazo_dias !== null && <Chip>Plazo {p.plazo_dias} días</Chip>}
        {p.paqueteria && <Chip>{p.paqueteria}</Chip>}
        {p.guias.map((g) => <Chip key={g.id}>{`Guía ${g.paqueteria} ${g.numero}${g.costo_cent !== null ? ` · ${formatearMoneda(g.costo_cent)}` : ' · sin costear'}`}</Chip>)}
      </div>
      <Tarjeta titulo="Avance del pedido">
        <Pasos
          etiquetaAria="Avance del pedido" actual={actualPaso === -1 ? 0 : actualPaso}
          items={[
            { id: 'a', etiqueta: 'Solicitado', detalle: etiquetaFecha(p.fecha_neg) }, { id: 'b', etiqueta: 'Confirmado' }, { id: 'c', etiqueta: 'Empacado', detalle: p.empacado_at ? etiquetaFechaHora(p.empacado_at) : undefined },
            { id: 'd', etiqueta: 'Enviado', detalle: p.fecha_envio ? etiquetaFecha(p.fecha_envio) : undefined }, { id: 'e', etiqueta: 'Entregado', detalle: p.entregado_at ? etiquetaFechaHora(p.entregado_at) : undefined }, { id: 'f', etiqueta: 'Cobrado' },
          ]}
        />
        {anulado && <p className="rtm-a1-nota">El pedido está anulado: el avance se detuvo.</p>}
      </Tarjeta>
      <KpiLinea
        etiquetaAria="Cifras del pedido"
        celdas={[
          { id: 'venta', etiqueta: enviado || anulado ? 'Total a saldar' : 'Total estimado si sale todo', valor: <CifraComprobada texto={formatearMoneda(enviado || anulado ? p.cobrado_cent : p.estimado_cent)} cifra={`pedido:total:${p.id}`} comprobacion="cuadra" />, categoria: 1, nota: `${formatearPiezas(piezasPedidas)} pedidas · ${formatearPiezas(piezasSurtidas)} surtidas` },
          { id: 'costo', etiqueta: neta ? 'Costo neto' : 'Costo de las piezas', valor: costoVista !== null ? formatearMoneda(costoVista) : null, categoria: 5, nota: neta ? `Regresaron ${formatearMoneda(neta.costo_regresado_cent)} a inventario${neta.merma_cent > 0n ? ` · merma ${formatearMoneda(neta.merma_cent)}` : ''}` : cas ? undefined : 'Se calcula al enviar' },
          { id: 'utilidad', etiqueta: cas?.utilidad_provisional ? 'Utilidad (provisional)' : 'Utilidad', valor: utilidadVista !== null ? formatearMoneda(utilidadVista) : null, categoria: 3, nota: utilidadVista !== null && totalVista !== null && totalVista > 0n ? `Margen ${((aNumero(utilidadVista) / aNumero(totalVista)) * 100).toFixed(1)} % ${neta ? 'del total cobrado neto' : 'del total'}` : cas?.guia_pendiente ? 'Guía por costear' : undefined },
          ...(dev && dev.devuelto_cent > 0n ? [{ id: 'devuelto', etiqueta: 'Devuelto (crédito)', valor: formatearMoneda(-dev.devuelto_cent), categoria: 6 as const, nota: `${dev.devoluciones.filter((x) => !x.anulada).length} devolución(es) vigentes` }] : []),
          { id: 'abonado', etiqueta: 'Abonado', valor: enviado || anulado ? formatearMoneda(p.aplicado_cent) : null, categoria: 2, progreso: enviado && p.cobrado_cent > 0n ? { pct: (aNumero(p.aplicado_cent) / aNumero(p.cobrado_cent)) * 100 } : undefined },
          { id: 'cobro', etiqueta: 'Por cobrar', valor: enviado ? (p.saldo_cent === null ? null : <CifraComprobada texto={formatearMoneda(p.saldo_cent)} cifra={`pedido:saldo:${p.id}`} comprobacion="cuadra" />) : null, categoria: 4, nota: p.saldo_favor_cliente_cent > 0n ? `Saldo a favor del cliente ${formatearMoneda(p.saldo_favor_cliente_cent)}` : undefined },
        ]}
      />

      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo="Datos del pedido">
          <ListaClaveValor columnas={2} items={[
            { k: 'Cliente', v: <Link href={`/clientes/${p.cliente.id}`}>{p.cliente.nombre}</Link> }, { k: 'Origen', v: ORIGEN[p.origen] }, { k: 'Fecha', v: etiquetaFecha(p.fecha_neg) },
            { k: 'Envío cobrado', v: formatearMoneda(p.envio_cent) }, { k: 'Descuento', v: formatearMoneda(p.descuento_cent) }, { k: 'Recargo', v: formatearMoneda(p.recargo_cent) },
            { k: 'Plazo', v: p.plazo_dias === null ? 'Sin plazo acordado' : `${p.plazo_dias} días` }, { k: 'Paquetería', v: p.paqueteria ?? 'Sin asignar' },
          ]} />
        </Tarjeta>
        <Tarjeta titulo="Cargos y pagos" descripcion={`${p.pagos.length} ${p.pagos.length === 1 ? 'pago aplicado' : 'pagos aplicados'}`}>
          <ListaClaveValor columnas={2} items={[
            ...p.cargos.map((c) => ({ k: c.concepto.replaceAll('_', ' '), v: formatearMoneda(c.monto_cent) })),
            ...p.pagos.map((x) => ({ k: `${x.folio} · ${x.cuenta}`, v: formatearMoneda(x.monto_cent) })),
            { k: 'Abonado', v: formatearMoneda(p.aplicado_cent) }, { k: 'Saldo', v: p.saldo_cent === null ? <SinDato /> : formatearMoneda(p.saldo_cent) },
          ]} />
        </Tarjeta>
      </Rejilla>

      {p.avisos.length > 0 && (
        <section className="rtm-seccion" aria-label="Avisos del pedido">
          <h2>Avisos</h2>
          <ul className="rtm-avisos">
            {p.avisos.map((a) => (
              <li key={a.id} className="rtm-aviso" data-testid="aviso-pedido">
                <strong>{AVISO_PEDIDO[a.codigo] ?? a.codigo}{a.nt ? ` · ${a.nt}` : ''}</strong>
                <p>{a.detalle}</p>
                <p>{a.decidido_por ? `Aceptado por ${a.decidido_por}` : 'No bloquea: se acepta con “Enviar de todos modos”.'}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Renglones del pedido">
        <h2>Pedidas, surtidas y cobradas</h2>
        <DataTable
          etiqueta={`Renglones de ${p.folio}`}
          clave={(l) => l.id}
          filas={p.lineas}
          columnas={[
            { id: 'm', titulo: 'Modelo', celda: (l) => nombreVape(l.modelo) },
            { id: 's', titulo: 'Sabor', celda: (l) => saborMayus(l.sabor) },
            { id: 'p', titulo: 'Pedidas', numerica: true, celda: (l) => formatearPiezas(l.piezas_pedidas) },
            { id: 'u', titulo: 'Surtidas', numerica: true, celda: (l) => (enviado || anulado ? formatearPiezas(l.piezas_surtidas) : <SinDato />) },
            { id: 'e', titulo: 'Disponible', numerica: true, secundaria: true, celda: (l) => (enviado || anulado ? '' : formatearPiezas(Math.max(l.disponible, 0))) },
            { id: 'pr', titulo: 'Precio', numerica: true, celda: (l) => formatearMoneda(l.precio_cent) },
            { id: 't', titulo: 'Tabulador', numerica: true, secundaria: true, celda: (l) => (l.precio_tabulador_cent === null ? <SinDato /> : formatearMoneda(l.precio_tabulador_cent)) },
            { id: 'c', titulo: 'Cobradas', numerica: true, celda: (l) => (enviado ? formatearPiezas(l.piezas_surtidas) : <SinDato />) },
          ]}
        />
        {p.ajustes.length > 0 && <p className="rtm-nota">Pendiente de surtir: {p.ajustes.map((a) => `${a.piezas} pz de ${a.modelo} ${a.sabor} (${a.tipo === 'entrega_diferida' ? 'entrega diferida' : a.tipo === 'pieza_no_llego' ? 'pieza que no llegó' : a.tipo})`).join('; ')}.</p>}
      </section>

      {enviado && dev && (
        <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Devoluciones del pedido" data-testid="seccion-devoluciones">
          <div className="rtm-acciones-fila">
            <h2>Devoluciones</h2>
            {dev.puede ? <DevolverMercancia pedidoId={p.id} folio={p.folio} renglones={dev.renglones} /> : <EstadoTexto tono="neutro">{dev.motivo_no ?? 'No admite devoluciones.'}</EstadoTexto>}
          </div>
          {dev.devoluciones.length === 0 ? <p className="rtm-nota">Este pedido no tiene devoluciones. Una devolución baja lo que el cliente debe, regresa las piezas a la bodega y emite una nota de crédito.</p> : (
            <DataTable
              etiqueta={`Devoluciones de ${p.folio}`}
              clave={(d) => d.id}
              filas={dev.devoluciones}
              columnas={[
                { id: 'f', titulo: 'Nota de crédito', celda: (d) => <a href={`/devoluciones/cliente/${d.id}/pdf`} target="_blank" rel="noreferrer">{d.folio}</a> },
                { id: 'fe', titulo: 'Fecha', celda: (d) => etiquetaFecha(d.fecha_neg) },
                { id: 'p', titulo: 'Piezas', numerica: true, celda: (d) => formatearPiezas(d.piezas) },
                { id: 'm', titulo: 'Crédito', numerica: true, celda: (d) => <CifraComprobada texto={formatearMoneda(d.monto_cent)} cifra={`devolucion:cliente:${d.id}`} comprobacion="cuadra" /> },
                { id: 'l', titulo: 'Pagos liberados', numerica: true, secundaria: true, celda: (d) => formatearMoneda(d.liberado_cent) },
                { id: 'mo', titulo: 'Motivo', celda: (d) => d.motivo },
                { id: 'e', titulo: 'Estado', celda: (d) => (d.anulada ? <EstadoTexto tono="atencion">Anulada</EstadoTexto> : <EstadoTexto tono="neutro">Vigente</EstadoTexto>) },
                { id: 'a', titulo: '', celda: (d) => (d.anulada ? '' : <AnularDevolucionCliente id={d.id} folio={d.folio} />) },
              ]}
            />
          )}
        </section>
      )}

      {enviado || anulado ? (
        <>
          <Pestanas etiquetaAria="Documento" items={VISTAS.map((v) => ({ id: v.clave, etiqueta: v.texto, href: `/pedidos/${p.id}?vista=${v.clave}`, activa: vista === v.clave, contador: v.clave === 'versiones' ? notas.length : undefined }))} />

          {vista === 'nota' && verNota && (
            <section className="rtm-seccion" aria-label="Nota para el cliente">
              <div className="rtm-acciones-fila">
                <BotonCopiar texto={verNota.texto_whatsapp} />
                <a className="rtm-boton" href={`/notas/${verNota.id}/pdf?v=cliente`} target="_blank" rel="noreferrer" data-testid="descargar-pdf">Descargar PDF de la nota</a>
                {!verNota.vigente && <EstadoTexto tono="atencion">Versión anterior</EstadoTexto>}
                {verNota.corregida_por && <EstadoTexto tono="atencion">Corregida por {verNota.corregida_por}</EstadoTexto>}
              </div>
              <pre className="rtm-texto-copiable" data-testid="texto-whatsapp">{verNota.texto_whatsapp}</pre>
              <NotaCliente nota={verNota} pedidoId={p.id} />
            </section>
          )}

          {vista === 'interna' && verNota && (
            <section className="rtm-seccion" aria-label="Hoja interna">
              <h2>Hoja interna de {verNota.folio_documento} <EstadoTexto tono="neutro">solo socios</EstadoTexto></h2>
              <div className="rtm-acciones-fila"><a className="rtm-boton" href={`/notas/${verNota.id}/pdf?v=interna`} target="_blank" rel="noreferrer">Descargar PDF de la hoja interna</a></div>
              <DataTable
                etiqueta="Utilidad por modelo"
                clave={(m) => m.modelo}
                filas={verNota.interno.por_modelo}
                columnas={[
                  { id: 'm', titulo: 'Modelo', celda: (m) => nombreVape(m.modelo) },
                  { id: 'p', titulo: 'Piezas', numerica: true, celda: (m) => formatearPiezas(m.piezas) },
                  { id: 'v', titulo: 'Venta', numerica: true, celda: (m) => formatearMoneda(m.venta_cent) },
                  { id: 'c', titulo: 'Costo', numerica: true, celda: (m) => formatearMoneda(m.costo_cent) },
                  { id: 'u', titulo: 'Utilidad', numerica: true, celda: (m) => formatearMoneda(m.utilidad_cent) },
                ]}
              />
              {(() => {
                const c = verNota.interno.cascada;
                const pasos = [
                  { id: 'venta', etiqueta: 'Venta', valor: aNumero(c.venta_cent), tipo: 'inicio' as const, texto: formatearMoneda(c.venta_cent) },
                  { id: 'envio', etiqueta: 'Envío', valor: aNumero(c.envio_cent), tipo: 'delta' as const, texto: `+${formatearMoneda(c.envio_cent)}` },
                  { id: 'recargo', etiqueta: 'Recargo', valor: aNumero(c.recargo_cent), tipo: 'delta' as const, texto: `+${formatearMoneda(c.recargo_cent)}` },
                  { id: 'desc', etiqueta: 'Descuento', valor: -Math.abs(aNumero(c.descuento_cent)), tipo: 'delta' as const, texto: formatearMoneda(-(c.descuento_cent < 0n ? -c.descuento_cent : c.descuento_cent)) },
                  { id: 'costo', etiqueta: 'Costo', valor: -aNumero(c.costo_cent), tipo: 'delta' as const, texto: formatearMoneda(-c.costo_cent) },
                  { id: 'renta', etiqueta: 'Renta', valor: -aNumero(c.renta_cent), tipo: 'delta' as const, texto: formatearMoneda(-c.renta_cent) },
                  ...(c.guia_cent === null ? [] : [{ id: 'guia', etiqueta: 'Guía', valor: -aNumero(c.guia_cent), tipo: 'delta' as const, texto: formatearMoneda(-c.guia_cent) }]),
                  { id: 'util', etiqueta: c.utilidad_provisional ? 'Utilidad (prov.)' : 'Utilidad', valor: aNumero(c.utilidad_cent), tipo: 'total' as const, texto: formatearMoneda(c.utilidad_cent) },
                ];
                return <Cascada titulo="De la venta a la utilidad" descripcion="Venta, envío, recargo, descuento, costo, renta y guía hasta la utilidad del pedido." unidad="Importe" procedencia={c.utilidad_provisional ? 'estimado' : 'observado'} pie={c.guia_pendiente ? 'La guía aún no tiene costo: la utilidad es provisional.' : 'Fuente: hoja interna'} pasos={pasos} />;
              })()}
              <h3>Cascada de la utilidad</h3>
              <ul className="rtm-cascada" data-testid="cascada">
                <li><span>Venta</span><span>{formatearMoneda(verNota.interno.cascada.venta_cent)}</span></li>
                <li><span>Envío cobrado</span><span>{formatearMoneda(verNota.interno.cascada.envio_cent)}</span></li>
                {verNota.interno.cascada.descuento_cent !== 0n && <li><span>Descuento</span><span>{formatearMoneda(verNota.interno.cascada.descuento_cent)}</span></li>}
                {verNota.interno.cascada.recargo_cent > 0n && <li><span>Recargo</span><span>{formatearMoneda(verNota.interno.cascada.recargo_cent)}</span></li>}
                <li data-total><span>Total del pedido</span><span>{formatearMoneda(verNota.interno.cascada.total_cent)}</span></li>
                <li><span>Costo de las piezas</span><span>{formatearMoneda(-verNota.interno.cascada.costo_cent)}</span></li>
                <li><span>Renta de bodega</span><span>{formatearMoneda(-verNota.interno.cascada.renta_cent)}</span></li>
                <li><span>Guía</span><span>{verNota.interno.cascada.guia_cent === null ? 'Sin costear' : formatearMoneda(-verNota.interno.cascada.guia_cent)}</span></li>
                <li data-total><span>{verNota.interno.cascada.utilidad_provisional ? 'Utilidad provisional' : 'Utilidad'}</span><span>{formatearMoneda(verNota.interno.cascada.utilidad_cent)}</span></li>
              </ul>
              <h3>Comprobaciones</h3>
              <ul className="rtm-avisos">
                <li className="rtm-aviso"><strong>C1 · renglón por renglón = por modelo</strong><p>{formatearMoneda(verNota.interno.comprobaciones.c1.renglones_cent)} y {formatearMoneda(verNota.interno.comprobaciones.c1.modelos_cent)} · <EstadoTexto tono={verNota.interno.comprobaciones.c1.cuadra ? 'ok' : 'malo'}>{verNota.interno.comprobaciones.c1.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto></p></li>
                <li className="rtm-aviso"><strong>C2 · pedidas, salidas, en nota y cobradas</strong><p>{verNota.interno.comprobaciones.c2.pedidas} pedidas · {verNota.interno.comprobaciones.c2.salidas} salidas · {verNota.interno.comprobaciones.c2.en_nota} en la nota · {verNota.interno.comprobaciones.c2.cobradas} cobradas · {verNota.interno.comprobaciones.c2.pendientes} pendientes · <EstadoTexto tono={verNota.interno.comprobaciones.c2.cuadra ? 'ok' : 'malo'}>{verNota.interno.comprobaciones.c2.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto></p></li>
              </ul>
            </section>
          )}

          {vista === 'versiones' && (
            <section className="rtm-seccion" aria-label="Versiones de la nota">
              <h2>Versiones de la nota</h2>
              <DataTable
                etiqueta="Versiones de la nota"
                clave={(x) => x.id}
                filas={notas}
                columnas={[
                  { id: 'f', titulo: 'Documento', celda: (x) => <Link className="rtm-mono" href={`/pedidos/${p.id}?vista=nota&nota=${x.id}`}>{x.folio_documento}</Link> },
                  { id: 't', titulo: 'Tipo', celda: (x) => (x.tipo === 'original' ? 'Original' : 'Corrección') },
                  { id: 'm', titulo: 'Motivo', secundaria: true, celda: (x) => x.motivo_correccion ?? '' },
                  { id: 'e', titulo: 'Emitida', secundaria: true, celda: (x) => etiquetaFechaHora(x.emitida_at) },
                  { id: 'tt', titulo: 'Total', numerica: true, celda: (x) => formatearMoneda(x.total_cent) },
                  { id: 'v', titulo: 'Estado', celda: (x) => (x.vigente ? <EstadoTexto tono="ok">Vigente</EstadoTexto> : <EstadoTexto tono="neutro">{x.corregida_por ? `Corregida por ${x.corregida_por}` : 'Anterior'}</EstadoTexto>) },
                ]}
              />
              <p className="rtm-nota">Una nota emitida nunca se edita: lo posterior aparece como una corrección enlazada o como movimientos aparte.</p>
            </section>
          )}
        </>
      ) : (
        <>
          <p className="rtm-nota">La nota y la hoja interna se emiten al marcar el pedido como enviado, y se cobra solo lo que realmente salga.</p>
        </>
      )}

      {p.pagos.length > 0 && (
        <section className="rtm-seccion" aria-label="Pagos aplicados">
          <h2>Pagos aplicados</h2>
          <DataTable etiqueta="Pagos aplicados" clave={(x) => x.folio} filas={p.pagos}
            columnas={[{ id: 'f', titulo: 'Folio', celda: (x) => <span className="rtm-mono">{x.folio}</span> }, { id: 'd', titulo: 'Fecha', celda: (x) => etiquetaFecha(x.fecha_neg) }, { id: 'c', titulo: 'Cuenta', celda: (x) => x.cuenta }, { id: 'm', titulo: 'Aplicado', numerica: true, celda: (x) => formatearMoneda(x.monto_cent) }]} />
        </section>
      )}

      <Tarjeta titulo="Línea de tiempo" descripcion={`${p.linea_tiempo.length} eventos registrados`}>
        <LineaTiempo eventos={p.linea_tiempo.map((e) => ({ id: e.evento, fecha: etiquetaFechaHora(e.hora), titulo: (e.tipo ?? 'evento').replaceAll('_', ' '), detalle: `${e.evento} · ${e.autor ?? e.canal}${e.mensaje_origen ? ` · “${e.mensaje_origen}”` : ''}` }))} />
      </Tarjeta>
    </Pagina>
  );
}
