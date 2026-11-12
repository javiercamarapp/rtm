import type { Metadata } from 'next';
import { AreaPesos } from '../_a3/graficas-pesos';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearPiezas } from '@/dominio/formato';
import type { EstadoCompra } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Segmentado } from '@/ui/componentes/controles';
import { BarList, LineaTiempo, ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { CONCEPTO_CUENTA, ESTADO_COMPRA, ORIGEN } from '../operacion/etiquetas';
import { FormularioAccion } from '../operacion/formulario-accion';
import { Dos, Estado, Pie, m, pct, suma } from '../_a3/util';
import { PagoSocioProveedor } from './pago-socio';

export const metadata: Metadata = { title: 'Proveedores' };

type Vista = 'ordenes' | 'cuenta' | 'hoja' | 'liquidaciones';
const VISTAS: Vista[] = ['ordenes', 'cuenta', 'hoja', 'liquidaciones'];
const EN_CAMINO: EstadoCompra[] = ['enviada', 'en_trayecto', 'llego_merida'];

export default async function PaginaProveedores({ searchParams }: { searchParams: Promise<{ p?: string; vista?: string }> }) {
  const { p, vista: vq = '' } = await searchParams;
  const proveedor = p === 'Karen' ? 'Karen' : 'Isaac';
  const vista: Vista = (VISTAS as string[]).includes(vq) ? (vq as Vista) : 'ordenes';
  const lector = await operacionDeSocio();
  const [cuenta, compras, hoja, cierres] = await Promise.all([lector.cuentaProveedor(proveedor), lector.compras(proveedor), lector.hojaProveedor(proveedor, null, 'sociedad'), lector.liquidacionesProveedor(proveedor)]);
  const t = hoja.totales;
  const palabra = cuenta.saldo_cent > 0n ? 'A favor de la sociedad' : cuenta.saldo_cent < 0n ? 'Se le debe al proveedor' : 'Saldo cero';
  const enCamino = compras.filter((c) => EN_CAMINO.includes(c.estado));
  const difAbiertas = suma(compras.map((c) => BigInt(c.diferencias_abiertas)));
  const piezasPagadas = compras.reduce((a, c) => a + c.pagadas, 0);
  const piezasRecibidas = compras.reduce((a, c) => a + (c.recibidas ?? 0), 0);
  const enlace = (v: Vista) => `/proveedores?p=${proveedor}${v === 'ordenes' ? '' : `&vista=${v}`}`;

  const pestanas = {
    etiquetaAria: 'Vistas del proveedor',
    items: ([['ordenes', 'Órdenes de compra', compras.length], ['cuenta', 'Movimientos de la cuenta', cuenta.movimientos.length], ['hoja', 'Hoja de la semana', hoja.renglones.length], ['liquidaciones', 'Liquidaciones cerradas', cierres.length]] as [Vista, string, number][]).map(([id, etiqueta, contador]) => ({ id, etiqueta, href: enlace(id), activa: vista === id, contador })),
  };

  // Hoja semanal en cascada: saldo anterior + mercancia + seguros + guias - pagos - ajustes = falta por saldar.
  const pasos = [
    { id: 'ant', etiqueta: 'Saldo anterior', valor: Number(t.saldo_anterior_cent), tipo: 'inicio' as const, texto: m(t.saldo_anterior_cent) },
    { id: 'mer', etiqueta: 'Mercancía', valor: Number(t.mercancia_cent), tipo: 'delta' as const, texto: m(t.mercancia_cent, true) },
    { id: 'seg', etiqueta: 'Seguros', valor: Number(t.seguros_cent), tipo: 'delta' as const, texto: m(t.seguros_cent, true) },
    { id: 'gui', etiqueta: 'Guías', valor: Number(t.guias_cent), tipo: 'delta' as const, texto: m(t.guias_cent, true) },
    { id: 'pag', etiqueta: 'Pagos', valor: -Number(t.pagos_cent), tipo: 'delta' as const, texto: m(-t.pagos_cent, true) },
    { id: 'aju', etiqueta: 'Ajustes', valor: -Number(t.ajustes_cent), tipo: 'delta' as const, texto: m(-t.ajustes_cent, true) },
    { id: 'fal', etiqueta: 'Falta por saldar', valor: Number(t.falta_por_saldar_cent), tipo: 'total' as const, texto: m(t.falta_por_saldar_cent, true) },
  ];

  // Saldo corrido: magnitud en la grafica, signo y palabra en cada punto.
  const mov = [...cuenta.movimientos].sort((a, b) => (a.fecha_neg === b.fecha_neg ? a.id - b.id : a.fecha_neg < b.fecha_neg ? -1 : 1));
  const puntosSaldo = mov.map((x) => ({
    id: String(x.id), etiqueta: etiquetaFecha(x.fecha_neg), valor: Math.abs(Number(x.saldo_corrido_cent)),
    texto: `${m(x.saldo_corrido_cent, true)} · ${x.saldo_corrido_cent > 0n ? 'a favor' : x.saldo_corrido_cent < 0n ? 'se debe' : 'saldo cero'}`, detalle: CONCEPTO_CUENTA[x.concepto] ?? x.concepto,
  }));

  const conceptos = Object.entries(hoja.pagos_por_concepto_cent).filter(([, v]) => v !== 0n);
  const totalPagos = suma(conceptos.map(([, v]) => v));
  const porEstado = (Object.keys(ESTADO_COMPRA) as EstadoCompra[]).map((e) => ({ e, n: compras.filter((c) => c.estado === e).length, c: suma(compras.filter((c) => c.estado === e).map((c) => c.total_cent)) })).filter((x) => x.n > 0);
  const totalCompras = suma(compras.map((c) => c.total_cent));
  const cierre = hoja.cierre;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Proveedores"
        titulo={`Cuenta con ${proveedor}`}
        descripcion={`${palabra} · ${m(cuenta.saldo_cent, true)} · falta por saldar ${m(t.falta_por_saldar_cent)} de la semana del ${etiquetaFecha(hoja.semana_ini)} al ${etiquetaFecha(hoja.semana_fin)}`}
        acciones={
          <>
            <Segmentado etiquetaAria="Proveedor" opciones={[{ valor: 'Isaac', etiqueta: 'Isaac', href: '/proveedores?p=Isaac', activa: proveedor === 'Isaac' }, { valor: 'Karen', etiqueta: 'Karen', href: '/proveedores?p=Karen', activa: proveedor === 'Karen' }]} />
            <Link className="rtm-boton rtm-boton-primario" href={`/proveedores/compras/nueva?p=${proveedor}`} data-testid="nueva-oc">Nueva orden de compra</Link>
          </>
        }
      />

      <KpiLinea
        etiquetaAria="Indicadores del proveedor"
        celdas={[
          { id: 'falta', etiqueta: 'Falta por saldar (semana)', testid: 'falta-por-saldar', valor: <CifraComprobada texto={m(t.falta_por_saldar_cent)} cifra={`proveedor:falta:${proveedor}:${hoja.semana_ini}:${hoja.ambito}`} comprobacion={hoja.comprobaciones.cuadra ? 'cuadra' : 'no_cuadra'} />, categoria: 4, nota: hoja.comprobaciones.cuadra ? 'La hoja cuadra por dos vías' : 'La hoja no cuadra' },
          { id: 'costo', etiqueta: 'Costo de la semana con guías', valor: m(t.costo_total_cent), categoria: 1, partes: t.costo_total_cent > 0n ? [{ etiqueta: 'Mercancía', valor: Number(t.mercancia_cent) }, { etiqueta: 'Seguros', valor: Number(t.seguros_cent) }, { etiqueta: 'Guías', valor: Number(t.guias_cent), estado: hoja.guias_pendientes > 0 ? 'parcial' : 'real' }] : undefined, nota: hoja.guias_pendientes > 0 ? `${hoja.guias_pendientes} guías sin costo real` : `${hoja.renglones.length} renglones` },
          { id: 'trayecto', etiqueta: 'Compras en trayecto', valor: String(enCamino.length), categoria: 6, nota: enCamino.length > 0 ? `${m(suma(enCamino.map((c) => c.total_cent)))} por recibir` : 'Nada en camino' },
          { id: 'dif', etiqueta: 'Diferencias de recepción abiertas', valor: String(difAbiertas), categoria: 7, nota: difAbiertas > 0n ? 'Sin responsable asignado' : 'Todas con responsable' },
        ]}
      />
      <FilaRatios
        etiqueta="Razones de la hoja semanal"
        items={[
          { etiqueta: 'Saldo anterior', valor: m(t.saldo_anterior_cent, true) },
          { etiqueta: 'Pagos de la semana', valor: m(t.pagos_cent) },
          { etiqueta: 'Ajustes a favor', valor: m(t.ajustes_cent) },
          { etiqueta: 'Piezas recibidas / pagadas', valor: piezasPagadas > 0 ? `${formatearPiezas(piezasRecibidas)} / ${formatearPiezas(piezasPagadas)}` : null },
          { etiqueta: 'Lo que dice el proveedor', valor: hoja.conciliacion ? m(hoja.conciliacion.dicho_cent) : null },
          { etiqueta: 'Diferencia contra nuestra cuenta', valor: hoja.conciliacion ? m(hoja.conciliacion.diferencia_cent, true) : null },
        ]}
      />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Hoja de la semana" descripcion="Del saldo anterior a lo que falta por saldar" acciones={<Estado tono={hoja.comprobaciones.cuadra ? 'ok' : 'malo'}>{hoja.comprobaciones.cuadra ? 'Cuadra' : 'No cuadra'}</Estado>}>
          <Cascada titulo="Cascada de la hoja semanal" descripcion={`Saldo anterior ${m(t.saldo_anterior_cent)}, mercancía ${m(t.mercancia_cent)}, seguros ${m(t.seguros_cent)}, guías ${m(t.guias_cent)}, pagos ${m(t.pagos_cent)}, ajustes ${m(t.ajustes_cent)}; falta por saldar ${m(t.falta_por_saldar_cent)}.`} pasos={pasos} unidad="Pesos" />
          <Pie>Falta por saldar = saldo anterior + costo total con guías − pagos − ajustes. <Link href={`/proveedores/liquidacion?p=${proveedor}`} data-testid="abrir-liquidacion">Abrir hoja y liquidar</Link></Pie>
        </Tarjeta>
        <Tarjeta titulo={`Saldo de la cuenta con ${proveedor}`} descripcion="Positivo = a favor de la sociedad, negativo = se debe">
          <p className="a3-cifra"><CifraComprobada texto={m(cuenta.saldo_cent)} cifra={`proveedor:saldo:${cuenta.id}`} comprobacion="cuadra" /></p>
          <p className="a3-cifra-apoyo" data-testid="etiqueta-saldo"><Estado tono={cuenta.saldo_cent < 0n ? 'atencion' : 'ok'}>{palabra}</Estado><span>{cuenta.modalidad === 'prepago_total' ? 'Prepago total' : 'Liquidación los viernes'}</span></p>
          <ListaClaveValor items={[
            { k: 'Semana', v: `${etiquetaFecha(hoja.semana_ini)} al ${etiquetaFecha(hoja.semana_fin)}` },
            { k: 'Liquidación', v: cierre ? <Estado tono="ok">Cerrada {cierre.folio}</Estado> : <Estado tono={hoja.viernes_cerrado ? 'atencion' : 'neutro'}>{hoja.viernes_cerrado ? 'Lista para cerrar' : 'Abierta'}</Estado> },
            { k: 'Compras abiertas', v: String(compras.filter((c) => !['recibida', 'cerrada', 'anulada'].includes(c.estado)).length) },
            { k: 'Cuenta puente', v: cuenta.puente_cent === 0n ? 'Sin diferencias por asignar' : m(cuenta.puente_cent) },
          ]} />
          <Pie>Isaac y Karen nunca se mezclan.</Pie>
          <div className="a3-acciones">
            <PagoSocioProveedor proveedor={proveedor} />
            <FormularioAccion boton="Pago de la sociedad" titulo={`Pago de la sociedad a ${proveedor}`} confirmar="Registrar pago" accion="registrar_pago_proveedor_sociedad" testid="pago-sociedad"
              fijos={{ p_proveedor: proveedor }} campos={[{ nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true }, { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' }]}
              nota="Sube el saldo a favor de la sociedad con este proveedor. Se puede deshacer con un movimiento contrario." />
            <FormularioAccion boton="Registrar ajuste" titulo={`Ajuste con ${proveedor}`} confirmar="Registrar ajuste" accion="registrar_ajuste_proveedor" testid="ajuste-proveedor"
              fijos={{ p_proveedor: proveedor }}
              campos={[
                { nombre: 'p_tipo', etiqueta: 'Tipo', tipo: 'seleccion', opciones: [
                  { valor: 'descuento_proveedor', texto: 'Descuento del proveedor (a favor)' }, { valor: 'saldo_a_favor', texto: 'Saldo a favor' }, { valor: 'pago_de_mas', texto: 'Pago de más' },
                  { valor: 'error_bodega', texto: 'Error de bodega' }, { valor: 'seguro_reenvio', texto: 'Seguro de reenvío' }] },
                { nombre: 'p_monto_cent', etiqueta: 'Monto a favor de la sociedad', tipo: 'monto', requerido: true, ayuda: 'Un cargo a favor del proveedor se registra como orden de compra.' },
                { nombre: 'p_motivo', etiqueta: 'Motivo', tipo: 'texto', requerido: true },
              ]} />
          </div>
        </Tarjeta>
      </Rejilla>

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Saldo corrido de la cuenta" descripcion="Magnitud del saldo tras cada movimiento; el signo va en el dato">
          {puntosSaldo.length >= 2 ? (
            <AreaPesos titulo="Saldo corrido con el proveedor" descripcion={`Saldo de la cuenta con ${proveedor} tras cada uno de ${puntosSaldo.length} movimientos.`} procedencia="observado" pie={`Fuente: movimientos de la cuenta con ${proveedor}`} puntos={puntosSaldo} />
          ) : (
            <p className="a3-grafica-vacia"><strong>Pocos movimientos</strong>Con dos o más movimientos de la cuenta se dibuja el saldo corrido.</p>
          )}
        </Tarjeta>
        <Tarjeta titulo="De dónde salen los pagos y en qué estado van las compras" descripcion="Pagos de la semana por concepto y compras por estado">
          <p className="a3-sub">Pagos de la semana por concepto</p>
          {conceptos.length > 0 ? (
            <BarList etiquetaAria="Pagos de la semana por concepto" items={conceptos.map(([k, v]) => ({ id: k, etiqueta: CONCEPTO_CUENTA[k] ?? k.replaceAll('_', ' '), texto: m(v), pct: pct(v, totalPagos) }))} />
          ) : (
            <p className="a3-pie">Sin pagos en la semana.</p>
          )}
          <p className="a3-sub">Órdenes de compra por estado</p>
          {porEstado.length === 0 && <p className="a3-pie">Sin órdenes de compra.</p>}
          {porEstado.length > 0 && <BarList etiquetaAria="Compras por estado" items={porEstado.map((x) => ({ id: x.e, etiqueta: ESTADO_COMPRA[x.e].texto, texto: m(x.c), pct: pct(x.c, totalCompras), nota: `${x.n} ${x.n === 1 ? 'orden' : 'órdenes'}` }))} />}
          <p className="a3-sub">Últimos movimientos de la cuenta</p>
          <LineaTiempo eventos={[...cuenta.movimientos].sort((a, b) => (a.fecha_neg === b.fecha_neg ? b.id - a.id : a.fecha_neg < b.fecha_neg ? 1 : -1)).slice(0, 4).map((x) => ({ id: String(x.id), fecha: etiquetaFecha(x.fecha_neg), titulo: `${CONCEPTO_CUENTA[x.concepto] ?? x.concepto} · ${m(x.monto_cent, true)}`, detalle: `Saldo ${m(x.saldo_corrido_cent, true)}`, tono: x.monto_cent < 0n ? ('atencion' as const) : ('ok' as const) }))} />
          {cuenta.movimientos.length === 0 && <p className="a3-pie">Sin movimientos en la cuenta.</p>}
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo={pestanas.items.find((i) => i.activa)?.etiqueta}>
        {vista === 'ordenes' && (
          <DataTable
            etiqueta={`Órdenes de compra de ${proveedor}`}
            densidad="densa" plana pegajosa primeraFija pestanas={pestanas}
            interactiva={{ busqueda: 'Buscar orden', porPagina: 50, exportar: `ordenes-${proveedor}` }}
            clave={(c) => c.id}
            filas={compras}
            totales={{ etiqueta: `Total (${compras.length})`, celdas: { pg: formatearPiezas(piezasPagadas), fa: formatearPiezas(compras.reduce((a, c) => a + c.facturadas, 0)), re: formatearPiezas(piezasRecibidas), t: m(totalCompras) } }}
            vacio={{ titulo: 'Sin órdenes', texto: `Todavía no hay órdenes de compra a ${proveedor}.`, accion: <Link className="rtm-boton" href={`/proveedores/compras/nueva?p=${proveedor}`}>Nueva orden de compra</Link> }}
            columnas={[
              { id: 'f', titulo: 'Orden', ancho: 'm', celda: (c) => <Link className="rtm-mono" href={`/proveedores/compras/${c.id}`}>{c.folio}</Link> },
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (c) => etiquetaFecha(c.fecha_neg) },
              { id: 'pg', titulo: 'Pagadas', numerica: true, ancho: 's', secundaria: true, celda: (c) => formatearPiezas(c.pagadas) },
              { id: 'fa', titulo: 'Facturadas', numerica: true, ancho: 's', secundaria: true, celda: (c) => formatearPiezas(c.facturadas) },
              { id: 're', titulo: 'Recibidas', numerica: true, ancho: 's', celda: (c) => (c.recibidas === null ? <SinDato /> : formatearPiezas(c.recibidas)) },
              { id: 't', titulo: 'Total', numerica: true, ancho: 'm', celda: (c) => m(c.total_cent) },
              { id: 'e', titulo: 'Estado', ancho: 'm', celda: (c) => <Estado tono={ESTADO_COMPRA[c.estado].tono}>{ESTADO_COMPRA[c.estado].texto}</Estado> },
              { id: 'x', titulo: 'Diferencias', ancho: 'm', secundaria: true, celda: (c) => (c.diferencias_abiertas > 0 ? <Estado tono="atencion">{c.diferencias_abiertas} sin responsable</Estado> : '—') },
            ]}
          />
        )}

        {vista === 'cuenta' && (
          <DataTable
            etiqueta={`Movimientos de la cuenta con ${proveedor}`}
            densidad="densa" plana pegajosa primeraFija pestanas={pestanas}
            interactiva={{ busqueda: 'Buscar movimiento', porPagina: 50, exportar: `cuenta-${proveedor}` }}
            clave={(x) => x.id}
            filas={cuenta.movimientos}
            totales={{ etiqueta: `Neto (${cuenta.movimientos.length})`, celdas: { m: m(suma(cuenta.movimientos.map((x) => x.monto_cent)), true), s: m(cuenta.saldo_cent, true) } }}
            vacio={{ titulo: 'Sin movimientos', texto: 'La cuenta se mueve con pagos de clientes redirigidos al proveedor, pagos de un socio y órdenes de compra aplicadas.' }}
            columnas={[
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (x) => etiquetaFecha(x.fecha_neg) },
              { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (x) => <Dos a={<>{CONCEPTO_CUENTA[x.concepto] ?? x.concepto}{x.compra ? ` · ${x.compra}` : ''}{x.pago ? ` · ${x.pago}` : ''}</>} b={x.cliente ? `Cliente: ${x.cliente}` : x.nota} /> },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (x) => m(x.monto_cent, true) },
              { id: 's', titulo: 'Saldo', numerica: true, ancho: 'm', celda: (x) => m(x.saldo_corrido_cent, true) },
              { id: 'q', titulo: 'Quién', ancho: 'l', secundaria: true, celda: (x) => <Dos a={x.autor ?? x.canal} b={<span className="rtm-mono">{x.evento}</span>} /> },
            ]}
          />
        )}

        {vista === 'hoja' && (
          <DataTable
            etiqueta={`Renglones de la hoja de ${proveedor}`}
            densidad="densa" plana pegajosa primeraFija pestanas={pestanas}
            interactiva={{ busqueda: 'Buscar folio', porPagina: 50, exportar: `hoja-${proveedor}` }}
            clave={(r) => `${r.tipo}-${r.id}`}
            filas={hoja.renglones}
            totales={{ etiqueta: `Total (${hoja.renglones.length})`, celdas: { p: formatearPiezas(hoja.renglones.reduce((a, r) => a + r.piezas, 0)), me: m(t.mercancia_cent), se: m(t.seguros_cent), gu: m(t.guias_cent), c: m(t.costo_total_cent) } }}
            vacio={{ titulo: 'Sin renglones', texto: 'No hay pedidos directos ni órdenes de compra de este proveedor en la semana.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'l', celda: (r) => <Dos a={<Link className="rtm-mono" href={r.tipo === 'oc' ? `/proveedores/compras/${r.id}` : `/pedidos/${r.id}`}>{r.folio}</Link>} b={r.tipo === 'oc' ? 'Orden de compra' : (ORIGEN[r.origen as keyof typeof ORIGEN] ?? r.origen)} /> },
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (r) => etiquetaFecha(r.fecha) },
              { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (r) => formatearPiezas(r.piezas) },
              { id: 'me', titulo: 'Mercancía', numerica: true, ancho: 'm', celda: (r) => m(r.mercancia_cent) },
              { id: 'se', titulo: 'Seguro', numerica: true, ancho: 'm', secundaria: true, celda: (r) => m(r.seguro_cent) },
              { id: 'gu', titulo: 'Guía', numerica: true, ancho: 'm', secundaria: true, celda: (r) => (r.guia_pendiente ? <Estado tono="atencion">Sin costo real</Estado> : m(r.guia_cent)) },
              { id: 'c', titulo: 'Costo', numerica: true, ancho: 'm', celda: (r) => m(r.costo_cent) },
              { id: 'm', titulo: 'Detalle a costo', ancho: 'xl', secundaria: true, celda: (r) => r.detalle.map((x) => `${x.modelo}: ${x.piezas} × ${m(x.costo_unit_cent)}`).join(' · ') },
              { id: 'a', titulo: 'Alcance', ancho: 's', secundaria: true, celda: (r) => (r.es_de_sociedad ? 'Sociedad' : 'Propio') },
              { id: 'k', titulo: 'Cuadra', ancho: 's', celda: (r) => <Estado tono={r.cuadra ? 'ok' : 'malo'}>{r.cuadra ? 'Sí' : 'No'}</Estado> },
            ]}
          />
        )}

        {vista === 'liquidaciones' && (
          <DataTable
            etiqueta="Historial de liquidaciones"
            densidad="densa" plana pegajosa primeraFija pestanas={pestanas}
            interactiva={{ porPagina: 50, exportar: `liquidaciones-${proveedor}` }}
            clave={(l) => l.id}
            filas={cierres}
            vacio={{ titulo: 'Sin liquidaciones', texto: 'Todavía no se cierra ninguna semana con este proveedor.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'm', celda: (l) => <span className="rtm-mono">{l.folio}</span> },
              { id: 's', titulo: 'Semana', ancho: 'l', celda: (l) => `${etiquetaFecha(l.semana_ini)} al ${etiquetaFecha(l.semana_fin)}` },
              { id: 'c', titulo: 'Costo con guías', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.mercancia_cent + l.seguros_cent + l.guias_cent) },
              { id: 'p', titulo: 'Pagos', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.pagos_cent) },
              { id: 'v', titulo: 'Falta por saldar', numerica: true, ancho: 'm', celda: (l) => m(l.falta_por_saldar_cent) },
              { id: 'd', titulo: 'Dijo el proveedor', numerica: true, ancho: 'm', secundaria: true, celda: (l) => (l.dicho_cent === null ? <SinDato /> : m(l.dicho_cent)) },
              { id: 'df', titulo: 'Diferencia', numerica: true, ancho: 'm', secundaria: true, celda: (l) => (l.diferencia_cent === null ? <SinDato /> : m(l.diferencia_cent, true)) },
            ]}
          />
        )}
        {cierre && vista === 'hoja' && <div className="a3-pie-tarjeta"><Pie>Semana liquidada: {cierre.folio} el {etiquetaFecha(cierre.fecha_cierre)}.</Pie></div>}
      </Tarjeta>
    </Pagina>
  );
}
