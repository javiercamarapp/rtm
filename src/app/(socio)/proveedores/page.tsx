import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';
import { CONCEPTO_CUENTA, ESTADO_COMPRA } from '../operacion/etiquetas';
import { PagoSocioProveedor } from './pago-socio';
import { FormularioAccion } from '../operacion/formulario-accion';

export const metadata: Metadata = { title: 'Proveedores' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const proveedor = p === 'Karen' ? 'Karen' : 'Isaac';
  const lector = await operacionDeSocio();
  const [cuenta, compras, hoja] = await Promise.all([lector.cuentaProveedor(proveedor), lector.compras(proveedor), lector.hojaProveedor(proveedor, null, 'sociedad')]);
  const palabra = cuenta.saldo_cent > 0n ? 'A favor de la sociedad' : cuenta.saldo_cent < 0n ? 'Se le debe al proveedor' : 'Saldo cero';

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Proveedores · ${etiquetaHoy()}`}
        antes="Cuenta con"
        enfasis={proveedor}
        contexto={cuenta.modalidad === 'prepago_total' ? 'Karen exige pago completo antes de confirmar una orden: el saldo a favor debe cubrirla. Isaac y Karen nunca se mezclan.' : 'Isaac admite crédito con liquidación los viernes: la cuenta puede quedar negativa. Isaac y Karen nunca se mezclan.'}
        acciones={<Link className="rtm-boton rtm-boton-primario" href={`/proveedores/compras/nueva?p=${proveedor}`} data-testid="nueva-oc">Nueva orden de compra</Link>}
      />
      <div className="rtm-segmentado" role="group" aria-label="Proveedor">
        <Link href="/proveedores?p=Isaac" aria-current={proveedor === 'Isaac'}>Isaac</Link>
        <Link href="/proveedores?p=Karen" aria-current={proveedor === 'Karen'}>Karen</Link>
      </div>

      <section className="rtm-bloque rtm-entra rtm-i-2" aria-label="Saldo de la cuenta">
        <p className="rtm-nota">Saldo de la cuenta con {proveedor} (positivo = a favor, negativo = se debe)</p>
        <p className="rtm-hero-cifra"><CifraComprobada texto={formatearMoneda(cuenta.saldo_cent)} cifra={`proveedor:saldo:${cuenta.id}`} comprobacion="cuadra" /></p>
        <p data-testid="etiqueta-saldo"><EstadoTexto tono={cuenta.saldo_cent < 0n ? 'atencion' : 'ok'}>{palabra}</EstadoTexto></p>
        <p className="rtm-nota">Diferencias de recepción por asignar (cuenta puente): {cuenta.puente_cent === 0n ? 'ninguna' : formatearMoneda(cuenta.puente_cent)}</p>
        <div className="rtm-acciones-fila">
          <PagoSocioProveedor proveedor={proveedor} />
          <FormularioAccion boton="Registrar pago de la sociedad" titulo={`Pago de la sociedad a ${proveedor}`} confirmar="Registrar pago" accion="registrar_pago_proveedor_sociedad" testid="pago-sociedad"
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
      </section>

      <section className="rtm-bloque rtm-entra rtm-i-3" aria-label="Liquidación de la semana">
        <p className="rtm-nota">Liquidación de la semana del {etiquetaFecha(hoja.semana_ini)} al {etiquetaFecha(hoja.semana_fin)}: costo total con guías menos pagos</p>
        <p className="rtm-hero-cifra" data-testid="falta-por-saldar"><CifraComprobada texto={formatearMoneda(hoja.totales.falta_por_saldar_cent)} cifra={`proveedor:falta:${proveedor}:${hoja.semana_ini}:${hoja.ambito}`} comprobacion={hoja.comprobaciones.cuadra ? 'cuadra' : 'no_cuadra'} /></p>
        <p><EstadoTexto tono={hoja.comprobaciones.cuadra ? 'ok' : 'malo'}>{hoja.comprobaciones.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto> · falta por saldar</p>
        <div className="rtm-acciones-fila"><Link className="rtm-boton rtm-boton-primario" href={`/proveedores/liquidacion?p=${proveedor}`} data-testid="abrir-liquidacion">Abrir hoja y liquidar</Link></div>
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Órdenes de compra">
        <h2>Órdenes de compra</h2>
        <DataTable
          etiqueta={`Órdenes de compra de ${proveedor}`}
          clave={(c) => c.id}
          filas={compras}
          vacio={{ titulo: 'Sin órdenes', texto: `Todavía no hay órdenes de compra a ${proveedor}.`, accion: <Link className="rtm-boton" href={`/proveedores/compras/nueva?p=${proveedor}`}>Nueva orden de compra</Link> }}
          columnas={[
            { id: 'f', titulo: 'Orden', celda: (c) => <Link className="rtm-mono" href={`/proveedores/compras/${c.id}`}>{c.folio}</Link> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (c) => etiquetaFecha(c.fecha_neg) },
            { id: 'pg', titulo: 'Pagadas', numerica: true, secundaria: true, celda: (c) => formatearPiezas(c.pagadas) },
            { id: 'fa', titulo: 'Facturadas', numerica: true, secundaria: true, celda: (c) => formatearPiezas(c.facturadas) },
            { id: 're', titulo: 'Recibidas', numerica: true, celda: (c) => (c.recibidas === null ? <SinDato /> : formatearPiezas(c.recibidas)) },
            { id: 't', titulo: 'Total', numerica: true, celda: (c) => formatearMoneda(c.total_cent) },
            { id: 'e', titulo: 'Estado', celda: (c) => <EstadoTexto tono={ESTADO_COMPRA[c.estado].tono}>{ESTADO_COMPRA[c.estado].texto}</EstadoTexto> },
            { id: 'x', titulo: 'Diferencias', secundaria: true, celda: (c) => (c.diferencias_abiertas > 0 ? <EstadoTexto tono="atencion">{c.diferencias_abiertas} sin responsable</EstadoTexto> : '') },
          ]}
        />
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Movimientos de la cuenta">
        <h2>Movimientos de la cuenta</h2>
        <DataTable
          etiqueta={`Movimientos de la cuenta con ${proveedor}`}
          clave={(m) => m.id}
          filas={cuenta.movimientos}
          vacio={{ titulo: 'Sin movimientos', texto: 'La cuenta se mueve con pagos de clientes redirigidos al proveedor, pagos de un socio y órdenes de compra aplicadas.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', celda: (m) => etiquetaFecha(m.fecha_neg) },
            { id: 'c', titulo: 'Concepto', celda: (m) => <>{CONCEPTO_CUENTA[m.concepto] ?? m.concepto}{m.compra ? ` · ${m.compra}` : ''}{m.pago ? ` · ${m.pago}` : ''}{m.cliente ? <><br /><span className="rtm-nota">Cliente: {m.cliente}</span></> : null}</> },
            { id: 'm', titulo: 'Monto', numerica: true, celda: (m) => formatearMoneda(m.monto_cent, { conSigno: true }) },
            { id: 's', titulo: 'Saldo', numerica: true, celda: (m) => formatearMoneda(m.saldo_corrido_cent) },
            { id: 'q', titulo: 'Quién', secundaria: true, celda: (m) => <>{m.autor ?? m.canal}<br /><span className="rtm-nota rtm-mono">{m.evento}</span></> },
          ]}
        />
      </section>
    </>
  );
}
