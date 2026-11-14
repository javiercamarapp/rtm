import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSocio } from '@/composicion/acceso';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, BarraFiltros, Chip, ChipEstado } from '@/ui/componentes/controles';
import { FiltrosPlegables } from '@/ui/componentes/filtros-plegables';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../contexto';
import { fechaOpcional } from '../dropshipping/comun';
import { DecidirPago, MarcarPagado, ReprogramarCompromiso, VerEvidencia } from './formulario-pago-menudeo';

export const metadata: Metadata = { title: 'Pedidos menudeo' };
const ESTADO_PAGO = { pagado: 'Pagado', no_pagado: 'Pendiente de pago', pago_reportado: 'Pago reportado', vencido: 'Vencido', por_confirmar: 'Por confirmar' } as const;
const TONO = { pagado: 'ok', no_pagado: 'atencion', pago_reportado: 'info', vencido: 'malo', por_confirmar: 'apagado' } as const;
const METODO = { transferencia: 'Transferencia', deposito: 'Depósito', efectivo: 'Efectivo' } as const;

export default async function PaginaMenudeo({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { perfil } = await exigirSocio();
  const sp = await searchParams;
  const desde = fechaOpcional(sp['desde']);
  const hasta = fechaOpcional(sp['hasta']);
  const proveedor = sp['proveedor'] === 'Karen' || sp['proveedor'] === 'Isaac' ? sp['proveedor'] : null;
  const estadoPago = sp['estado'] === 'pagado' || sp['estado'] === 'no_pagado' || sp['estado'] === 'pago_reportado' || sp['estado'] === 'vencido' || sp['estado'] === 'por_confirmar' ? sp['estado'] : null;
  const ds = await dropshippingDeSocio();
  // Pagina del socio de menudeo (por omision Angelo, su menudeo en Playa del Carmen): el otro socio la ve en modo lectura (confirma o rechaza pagos reportados).
  const socio = await ds.socioMenudeo();
  const esMenudeo = perfil.socio_nombre === socio;
  const [m, fondos] = await Promise.all([ds.menudeo(socio, { desde, hasta, proveedor, estadoPago }), ds.fondosEnPoder(socio)]);
  const [d, h] = [desde ?? '-', hasta ?? '-'];
  const cif = (met: string, texto: string) => <CifraComprobada texto={texto} cifra={`dsm:${socio}:${met}:${d}:${h}`} comprobacion="cuadra" />;
  const t = m.totales;
  const hayFiltros = Boolean(desde || hasta || proveedor || estadoPago);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Pedidos menudeo ${socio} · ${etiquetaHoy()}`}
        titulo={t.pedidos ? `Pedidos menudeo de ${socio}: ${t.pedidos} ${t.pedidos === 1 ? 'pedido' : 'pedidos'}, ${formatearMoneda(t.pendiente_cent)} pendiente de pago` : `Pedidos menudeo de ${socio}: sin pedidos todavía`}
        descripcion={esMenudeo ? 'Tu menudeo en Playa del Carmen. Se cobra solo el costo; no generan utilidad ni restan a tu valuación ni a tu aportación neta.' : `Solo lectura: supervisas los pedidos de ${socio} (menudeo en Playa del Carmen) y confirmas o rechazas sus pagos reportados.`}
        acciones={esMenudeo ? <Link className="rtm-boton rtm-boton-primario" href="/dropshipping/nuevo" data-testid="nuevo-pedido-costo">Nuevo pedido a costo</Link> : undefined}
      />
      <BarraFiltros etiquetaAria="Filtros" extras={hayFiltros ? <Chip href="/menudeo">Quitar filtros</Chip> : undefined}>
        <form className="rtm-ds-filtros-linea" method="get" aria-label="Filtrar pedidos">
          <FiltrosPlegables etiqueta="Filtros" titulo="Filtrar pedidos por periodo, proveedor y estado de pago" activos={[desde, hasta, proveedor, estadoPago].filter(Boolean).length}>
          <label className="rtm-etiqueta-campo">Desde<input className="rtm-campo" type="date" name="desde" defaultValue={desde ?? ''} /></label>
          <label className="rtm-etiqueta-campo">Hasta<input className="rtm-campo" type="date" name="hasta" defaultValue={hasta ?? ''} /></label>
          <label className="rtm-etiqueta-campo">Proveedor<select className="rtm-campo" name="proveedor" defaultValue={proveedor ?? ''}><option value="">Todos</option><option>Karen</option><option>Isaac</option></select></label>
          <label className="rtm-etiqueta-campo">Estado de pago<select className="rtm-campo" name="estado" defaultValue={estadoPago ?? ''}><option value="">Todos</option><option value="pagado">Pagado</option><option value="no_pagado">Pendiente de pago</option><option value="pago_reportado">Pago reportado</option><option value="vencido">Vencido</option><option value="por_confirmar">Por confirmar</option></select></label>
          <button type="submit" className="rtm-boton rtm-boton-primario" data-testid="menudeo-filtrar">Filtrar</button>
          </FiltrosPlegables>
        </form>
      </BarraFiltros>

      {t.sin_fecha > 0 && <Aviso tono="atencion" titulo="Sin fecha comprometida."><span data-testid="alerta-sin-fecha">{t.sin_fecha} {t.sin_fecha === 1 ? 'pedido' : 'pedidos'} sin fecha comprometida de pago.</span>{esMenudeo ? ' Fíjala en cada pedido.' : ''}</Aviso>}
      {t.vencidos > 0 && <Aviso tono="error" titulo="Pedidos vencidos."><span data-testid="alerta-vencidos">{t.vencidos} {t.vencidos === 1 ? 'pedido vencido' : 'pedidos vencidos'} por {formatearMoneda(t.vencido_cent)}: pasó la fecha comprometida y siguen pendientes de pago.</span></Aviso>}
      <KpiLinea
        etiquetaAria="Cifras de los pedidos a costo"
        celdas={[
          { id: 'pedidos', etiqueta: 'Pedidos', valor: String(t.pedidos), categoria: 1, nota: `${t.pedidos_pendientes} con pago pendiente` },
          { id: 'piezas', etiqueta: 'Piezas', valor: cif('piezas', formatearPiezas(t.piezas)), categoria: 7 },
          { id: 'costo', etiqueta: 'Costo total', valor: cif('costo', formatearMoneda(t.costo_cent)), categoria: 2, nota: 'Lo que se cobra: solo el costo' },
          { id: 'pagado', etiqueta: 'Pagado', valor: cif('pagado', formatearMoneda(t.pagado_cent)), categoria: 3 },
          { id: 'reportado', etiqueta: 'Pago reportado por confirmar', valor: cif('reportado', formatearMoneda(t.reportado_cent)), categoria: 5, testid: 'menudeo-reportado', nota: `${t.pedidos_reportados} ${t.pedidos_reportados === 1 ? 'pedido' : 'pedidos'} · sigue pendiente hasta que el otro socio confirme` },
          { id: 'vencido', etiqueta: 'Vencido', valor: formatearMoneda(t.vencido_cent), categoria: 8, testid: 'menudeo-vencido', nota: `${t.vencidos} ${t.vencidos === 1 ? 'pedido' : 'pedidos'} con compromiso vencido` },
          { id: 'pendiente', etiqueta: 'Pendiente de pago', valor: cif('pendiente', formatearMoneda(t.pendiente_cent)), categoria: 4, testid: 'menudeo-pendiente', nota: 'Pedidos a costo confirmados o enviados. No restan a la aportación neta.' },
        ]}
      />

      <Tarjeta plana titulo="Pedidos a costo" descripcion="Con ficha de renglones: marca, modelo, sabor, cantidad y costo unitario">
        <DataTable
          etiqueta={`Pedidos a costo de ${socio}`}
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar folio o proveedor', porPagina: 50, exportar: 'pedidos-menudeo' }}
          clave={(f) => f.pedido_id}
          filas={m.filas}
          totales={m.filas.length ? { etiqueta: 'Total del filtro', celdas: { z: formatearPiezas(t.piezas), c: formatearMoneda(t.costo_cent), pg: formatearMoneda(t.pagado_cent), pe: formatearMoneda(t.pendiente_cent) } } : undefined}
          vacio={{ titulo: 'Sin pedidos a costo todavía', texto: hayFiltros ? 'Ningún pedido coincide con los filtros.' : 'Cuando el socio meta un pedido a costo aparecerá aquí con su pago.', accion: <Link className="rtm-boton" href="/dropshipping/nuevo">Nuevo pedido a costo</Link> }}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 'm', prioridadMovil: 'normal', celda: (f) => <Link className="rtm-mono" href={`/dropshipping/pedidos/${f.pedido_id}`}>{f.folio}</Link> },
            { id: 'd', titulo: 'Fecha', ancho: 'm', prioridadMovil: 'titulo', celda: (f) => etiquetaFecha(f.fecha_neg) },
            { id: 'r', titulo: 'Vapes (renglones)', ancho: 'xl', prioridadMovil: 'detalle', celda: (f) => (
              <details data-testid={`renglones-${f.pedido_id}`}>
                <summary>{f.renglones.length} {f.renglones.length === 1 ? 'renglón' : 'renglones'} · {formatearPiezas(f.piezas)}</summary>
                <ul className="rtm-lineas-form">{f.renglones.map((r, i) => <li key={`${r.sabor}-${i}`}>{r.marca} · {r.modelo} · {r.sabor} · {formatearPiezas(r.piezas)} a {formatearMoneda(r.costo_unit_cent)} = {formatearMoneda(r.costo_cent)}</li>)}</ul>
              </details>
            ) },
            { id: 'pv', titulo: 'Proveedor', ancho: 'm', prioridadMovil: 'normal', celda: (f) => f.proveedor ?? '' },
            { id: 'z', titulo: 'Piezas', numerica: true, ancho: 's', prioridadMovil: 'normal', celda: (f) => formatearPiezas(f.piezas) },
            { id: 'c', titulo: 'Costo total', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => formatearMoneda(f.costo_cent) },
            { id: 'pg', titulo: 'Pagado', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => formatearMoneda(f.pagado_cent) },
            { id: 'pe', titulo: 'Pendiente', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => formatearMoneda(f.pendiente_cent) },
            { id: 'cm', titulo: 'Fecha comprometida', ancho: 'l', prioridadMovil: 'normal', celda: (f) => (
              <span data-testid={`compromiso-${f.pedido_id}`}>
                {f.fecha_compromiso ? <>{etiquetaFecha(f.fecha_compromiso)}{f.hora_compromiso ? ` ${f.hora_compromiso.slice(0, 5)}` : ''}{f.comprometido_por ? ` · ${f.comprometido_por}` : ''}</> : f.estado === 'borrador' ? '' : <strong>Sin fecha comprometida</strong>}
                {f.vencido ? <> · <strong data-testid={`atraso-${f.pedido_id}`}>{f.dias_atraso} {f.dias_atraso === 1 ? 'día' : 'días'} de atraso</strong></> : null}
                {f.compromisos.length > 1 ? <details><summary>{f.compromisos.length - 1} {f.compromisos.length - 1 === 1 ? 'cambio' : 'cambios'}</summary><ul className="rtm-lineas-form">{f.compromisos.map((c) => <li key={c.id}>{c.tipo === 'inicial' ? 'Inicial' : 'Reprogramado'} · {c.fecha_compromiso ? etiquetaFecha(c.fecha_compromiso) : 'sin fecha'} · {c.comprometido_por}{c.motivo ? ` · ${c.motivo}` : ''}</li>)}</ul></details> : null}
                {esMenudeo && f.estado !== 'borrador' && f.pagado_cent < f.costo_cent ? <> <ReprogramarCompromiso pedidoId={f.pedido_id} folio={f.folio} tieneFecha={f.fecha_compromiso !== null} /></> : null}
              </span>
            ) },
            { id: 'rp', titulo: 'Pagos reportados', ancho: 'xl', prioridadMovil: 'detalle', celda: (f) => (f.reportes.length === 0 ? '' : (
              <details data-testid={`reportes-${f.pedido_id}`}>
                <summary>{f.reportes.length} {f.reportes.length === 1 ? 'pago' : 'pagos'}{f.por_confirmar > 0 ? ` · ${f.por_confirmar} por confirmar` : ''}</summary>
                <ul className="rtm-lineas-form">
                  {f.reportes.map((r) => (
                    <li key={r.id} data-testid={`reporte-${r.id}`}>
                      {etiquetaFecha(r.fecha_pago)} · {formatearMoneda(r.monto_cent)} · {METODO[r.metodo]}{r.referencia ? ` · ${r.referencia}` : ''} · por {r.reportado_por}{r.canal === 'telegram' ? ' (Telegram)' : ''} ·{' '}
                      <strong>{r.estado === 'por_confirmar' ? (r.aplicado ? 'Registrado, por confirmar' : 'Por confirmar') : r.estado === 'confirmado' ? `Confirmado por ${r.decidido_por}` : `Rechazado por ${r.decidido_por}: ${r.motivo ?? ''}`}</strong>
                      {r.evidencia && <> · <VerEvidencia reporteId={r.id} nombre={r.evidencia.nombre} /> <span className="rtm-nota" title={r.evidencia.sha256}>huella {r.evidencia.sha256.slice(0, 10)}</span></>}
                      {r.estado === 'por_confirmar' && r.reportado_por !== perfil.socio_nombre && <> <DecidirPago reporteId={r.id} /></>}
                    </li>
                  ))}
                </ul>
              </details>
            )) },
            { id: 'e', titulo: 'Estado', ancho: 'm', prioridadMovil: 'normal', celda: (f) => <span data-testid={`estado-pago-${f.pedido_id}`}><ChipEstado tono={TONO[f.estado_pago]}>{ESTADO_PAGO[f.estado_pago]}</ChipEstado></span> },
            { id: 'a', titulo: '', ancho: 'm', prioridadMovil: 'normal', celda: (f) => (esMenudeo && f.estado === 'enviado' && f.pendiente_cent > 0n ? <MarcarPagado pedidoId={f.pedido_id} folio={f.folio} proveedor={f.proveedor ?? 'el proveedor'} pendienteTexto={formatearMoneda(f.pendiente_cent)} pendienteCent={Number(f.pendiente_cent - f.reportado_cent)} /> : f.estado === 'enviado' ? '' : 'Aún no enviado') },
          ]}
        />
      </Tarjeta>

      <Tarjeta plana titulo="Fondos de la sociedad cobrados en su cuenta" descripcion="Pendiente de entregar a la sociedad. A diferencia de los pedidos a costo, estos fondos SÍ restan de su aportación neta."
        acciones={<span data-testid="fondos-pendiente">{cif('fondos', formatearMoneda(fondos.pendiente_cent))}</span>}>
        <DataTable
          etiqueta={`Fondos cobrados en la cuenta de ${socio}`}
          densidad="densa" plana
          clave={(x) => x.id}
          filas={fondos.movimientos}
          vacio={{ titulo: 'Sin fondos pendientes de entregar', texto: 'Aparecen cuando un cliente paga en la cuenta de este socio dinero que es de la sociedad.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', ancho: 'm', prioridadMovil: 'titulo', celda: (x) => etiquetaFecha(x.fecha_neg) },
            { id: 'c', titulo: 'Concepto', ancho: 'l', prioridadMovil: 'normal', celda: (x) => (x.concepto === 'fondos_en_poder' ? 'Cobro en su cuenta' : x.concepto === 'entrega_a_sociedad' ? 'Entrega a la sociedad' : x.concepto === 'entrega_a_proveedor' ? 'Pago a un proveedor con estos fondos' : x.concepto.replace(/_/g, ' ')) },
            { id: 'p', titulo: 'Cobro', ancho: 'm', prioridadMovil: 'normal', celda: (x) => x.pago ?? '' },
            { id: 'cl', titulo: 'Cliente', ancho: 'xl', prioridadMovil: 'normal', celda: (x) => x.cliente ?? '' },
            { id: 'pe', titulo: 'Pedidos a los que se aplicó', ancho: 'l', prioridadMovil: 'detalle', celda: (x) => (x.pedidos.length ? x.pedidos.join(', ') : 'A cuenta, sin pedido') },
            { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (x) => formatearMoneda(x.monto_cent) },
            { id: 's', titulo: 'Pendiente de entregar', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (x) => formatearMoneda(x.saldo_corrido_cent) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
