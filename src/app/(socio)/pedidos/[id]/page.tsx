import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { AVISO_PEDIDO, ESTADO_PEDIDO, ORIGEN } from '../../operacion/etiquetas';
import { AccionesPedido } from './acciones-pedido';
import { BotonCopiar } from './boton-copiar';
import { NotaCliente } from './nota-vista';

export const metadata: Metadata = { title: 'Pedido' };

const VISTAS = [{ clave: 'nota', texto: 'Nota' }, { clave: 'interna', texto: 'Hoja interna' }, { clave: 'versiones', texto: 'Versiones' }] as const;

export default async function Pagina({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vista?: string; nota?: string }> }) {
  const { id } = await params;
  const { vista = 'nota', nota: notaSel } = await searchParams;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();
  const lector = await operacionDeSocio();
  const [p, ctx] = await Promise.all([lector.pedido(n), lector.contextoPagos()]);
  if (!p) notFound();

  const notas = p.notas;
  const vigente = notas.find((x) => x.vigente) ?? null;
  const verNota = (notaSel ? notas.find((x) => x.id === Number(notaSel)) : null) ?? vigente;
  const avisosPendientes = p.avisos.filter((a) => a.decidido_por === null).length;
  const cuentas = ctx.cuentas.map((c) => c.nombre);
  const enviado = p.estado === 'enviado';
  const anulado = p.estado === 'anulado';

  return (
    <>
      <p className="rtm-migaja"><Link href="/pedidos">Pedidos y notas</Link> / {p.folio}</p>
      <EncabezadoPagina
        eyebrow={`Pedido ${p.folio} · ${etiquetaHoy()}`}
        antes={enviado ? 'Enviado a' : 'Pedido de'}
        enfasis={p.cliente.nombre}
        despues={`· ${p.cliente.duenio}`}
        contexto={`${ORIGEN[p.origen]} · creado el ${etiquetaFecha(p.fecha_neg)}${p.fecha_envio ? ` · enviado el ${etiquetaFecha(p.fecha_envio)}` : ''}. Nada se descuenta ni devenga renta antes de marcarlo enviado.`}
      />
      <div className="rtm-etiquetas" aria-label="Estado del pedido">
        <span className="rtm-etiqueta" data-testid="estado-pedido"><EstadoTexto tono={ESTADO_PEDIDO[p.estado].tono}>{ESTADO_PEDIDO[p.estado].texto}</EstadoTexto></span>
        {p.empacado_at && <span className="rtm-etiqueta">Empacado</span>}
        {p.entregado_at && <span className="rtm-etiqueta">Entregado</span>}
        {p.plazo_dias !== null && <span className="rtm-etiqueta">Plazo: {p.plazo_dias} días</span>}
        {p.guias.map((g) => <span key={g.id} className="rtm-etiqueta">Guía {g.paqueteria} {g.numero}{g.costo_cent !== null ? ` · ${formatearMoneda(g.costo_cent)}` : ' · sin costear'}</span>)}
      </div>

      <AccionesPedido
        pedidoId={p.id} folio={p.folio} clienteId={p.cliente.id} estado={p.estado} empacado={p.empacado_at !== null} entregado={p.entregado_at !== null}
        puedeEmpacar={p.origen === 'bodega_omar' || p.origen === 'castores'} avisosPendientes={avisosPendientes} cuentas={cuentas} saldoCent={p.saldo_cent}
        renglones={p.lineas.map((l) => ({ linea_id: l.id, modelo: l.modelo, sabor: l.sabor, piezas: l.piezas_pedidas, disponible: l.disponible }))}
        lineasNota={p.lineas.filter((l) => l.piezas_surtidas > 0).map((l) => ({ id: l.id, etiqueta: `${l.modelo} ${l.sabor}`, precio_cent: l.precio_cent }))}
      />

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
            { id: 'm', titulo: 'Modelo', celda: (l) => l.modelo },
            { id: 's', titulo: 'Sabor', celda: (l) => l.sabor },
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

      {enviado || anulado ? (
        <>
          <div className="rtm-kpis">
            <div className="rtm-kpi"><span>Total a saldar</span><strong><CifraComprobada texto={formatearMoneda(p.cobrado_cent)} cifra={`pedido:total:${p.id}`} comprobacion="cuadra" /></strong></div>
            <div className="rtm-kpi"><span>Abonado</span><strong>{formatearMoneda(p.aplicado_cent)}</strong></div>
            <div className="rtm-kpi"><span>Por cobrar</span><strong>{p.saldo_cent === null ? <SinDato /> : <CifraComprobada texto={formatearMoneda(p.saldo_cent)} cifra={`pedido:saldo:${p.id}`} comprobacion="cuadra" />}</strong></div>
            {p.saldo_favor_cliente_cent > 0n && <div className="rtm-kpi"><span>Saldo a favor del cliente</span><strong>{formatearMoneda(p.saldo_favor_cliente_cent)}</strong></div>}
          </div>
          <div className="rtm-segmentado" role="group" aria-label="Documento">
            {VISTAS.map((v) => <Link key={v.clave} href={`/pedidos/${p.id}?vista=${v.clave}`} aria-current={vista === v.clave}>{v.texto}</Link>)}
          </div>

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
                  { id: 'm', titulo: 'Modelo', celda: (m) => m.modelo },
                  { id: 'p', titulo: 'Piezas', numerica: true, celda: (m) => formatearPiezas(m.piezas) },
                  { id: 'v', titulo: 'Venta', numerica: true, celda: (m) => formatearMoneda(m.venta_cent) },
                  { id: 'c', titulo: 'Costo', numerica: true, celda: (m) => formatearMoneda(m.costo_cent) },
                  { id: 'u', titulo: 'Utilidad', numerica: true, celda: (m) => formatearMoneda(m.utilidad_cent) },
                ]}
              />
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
          <div className="rtm-kpis"><div className="rtm-kpi"><span>Total estimado si sale todo</span><strong>{formatearMoneda(p.estimado_cent)}</strong></div></div>
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

      <section className="rtm-seccion" aria-label="Línea de tiempo">
        <h2>Línea de tiempo</h2>
        <ul className="rtm-linea-tiempo">
          {p.linea_tiempo.map((e) => <li key={e.evento}><span className="rtm-mono">{e.evento}</span> · {etiquetaFechaHora(e.hora)} · {(e.tipo ?? '').replaceAll('_', ' ')} · {e.autor ?? e.canal}{e.mensaje_origen ? ` · “${e.mensaje_origen}”` : ''}</li>)}
        </ul>
      </section>
    </>
  );
}
