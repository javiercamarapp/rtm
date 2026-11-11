import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { etiquetaHoy } from '../contexto';
import { CerrarSemana, ExportarCsv, FormularioToma, PagoOmar, ResolverToma } from './acciones-omar';

export const metadata: Metadata = { title: 'Cuenta con Omar' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ semana?: string }> }) {
  const { semana } = await searchParams;
  const o = await (await operacionDeSocio()).omarCuenta(semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : null);
  const neto = o.neto_cent;
  const pasos = [
    { id: 'r', etiqueta: 'Renta devengada', valor: Number(o.renta_cent), tipo: 'inicio' as const, texto: formatearMoneda(o.renta_cent) },
    { id: 't', etiqueta: 'Tomas a su precio', valor: -Number(o.tomas_cent), tipo: 'delta' as const, texto: formatearMoneda(-o.tomas_cent, { conSigno: true }) },
    { id: 'n', etiqueta: 'Neto de la semana', valor: Number(neto), tipo: 'total' as const, texto: formatearMoneda(neto, { conSigno: true }) },
  ];
  const nav = (dias: number) => `/omar?semana=${sumarDias(o.semana_ini, dias)}`;

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Cuenta con Omar · ${etiquetaHoy()}`}
        antes={neto === 0n ? 'La cuenta con' : neto > 0n ? 'Le debemos a' : 'Omar nos debe a'}
        enfasis={neto === 0n ? 'Omar: saldo cero' : 'Omar'}
        despues={neto === 0n ? '' : formatearMoneda(neto < 0n ? -neto : neto)}
        contexto="Renta de bodega por pieza surtida desde su bodega, tomas a su precio y el neto de la semana. Omar presta el lugar, no despacha y su acceso sigue desactivado."
        acciones={<><FormularioToma skus={o.skus.map((s) => ({ sku_id: s.sku_id, etiqueta: `${s.modelo} · ${s.sabor} (${s.existencia} pz${s.precio_cent === null ? ', sin precio' : ` a ${formatearMoneda(s.precio_cent)}`})` }))} /><PagoOmar /><CerrarSemana semana={o.semana_ini} desactivado={!o.puede_cerrar} /></>}
      />
      <p className="rtm-chip rtm-entra rtm-i-1">Omar (bodega) ≠ Omar Aguilar (cliente)</p>
      <div className="rtm-acciones-fila">
        <div className="rtm-segmentado" role="group" aria-label="Semana">
          <Link href={nav(-7)}>Semana anterior</Link>
          <Link href="/omar">Esta semana</Link>
          <Link href={nav(7)}>Semana siguiente</Link>
        </div>
        <span className="rtm-nota">Del {etiquetaFecha(o.semana_ini)} al {etiquetaFecha(o.semana_fin)} · {o.estado === 'cerrada' ? `liquidada (${o.liquidacion})` : 'abierta'}</span>
      </div>
      {o.semana_anterior_sin_cerrar && (
        <p className="rtm-aviso" role="status" data-testid="semana-sin-cerrar">La semana del {etiquetaFecha(o.semana_anterior_sin_cerrar)} sigue sin cerrar. <Link href={`/omar?semana=${o.semana_anterior_sin_cerrar}`}>Revisarla</Link></p>
      )}

      <section className="rtm-bloque rtm-entra rtm-i-2" aria-label="Neto de la semana">
        <p className="rtm-nota">Neto de la semana (+ le debemos, − Omar debe)</p>
        <p className="rtm-hero-cifra" data-testid="neto-omar"><CifraComprobada texto={formatearMoneda(neto, { conSigno: true })} cifra={`omar:neto:${o.semana_ini}`} comprobacion="cuadra" /></p>
        <p data-testid="palabra-omar"><EstadoTexto tono={neto === 0n ? 'ok' : 'atencion'}>{o.palabra}</EstadoTexto></p>
        <p className="rtm-nota">Pagos y compensaciones de la semana: {formatearMoneda(o.pagos_semana_cent)}. Saldo acumulado de la cuenta: {formatearMoneda(o.saldo_cuenta_cent, { conSigno: true })}.</p>
        <Cascada titulo="Renta menos tomas igual al neto" descripcion={`Renta ${formatearMoneda(o.renta_cent)}, tomas ${formatearMoneda(o.tomas_cent)}, neto ${formatearMoneda(neto, { conSigno: true })}.`} pasos={pasos} unidad="Pesos" />
      </section>

      {o.pendientes.length > 0 && (
        <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Pendientes de autorización">
          <h2>Pendientes de autorización</h2>
          <p className="rtm-nota">No cambian el saldo ni el inventario hasta que un socio las autorice; caducan solas.</p>
          <DataTable etiqueta="Tomas pendientes" clave={(t) => t.id} filas={o.pendientes}
            columnas={[
              { id: 'f', titulo: 'Toma', celda: (t) => <span className="rtm-mono">{t.folio}</span> },
              { id: 'm', titulo: 'Pieza', celda: (t) => `${t.modelo} · ${t.sabor}` },
              { id: 'p', titulo: 'Piezas', numerica: true, celda: (t) => formatearPiezas(t.piezas) },
              { id: 'r', titulo: 'Precio', numerica: true, secundaria: true, celda: (t) => (t.precio_cent === null ? <EstadoTexto tono="atencion">Falta precio</EstadoTexto> : formatearMoneda(t.precio_cent)) },
              { id: 'c', titulo: 'Caduca', secundaria: true, celda: (t) => etiquetaFechaHora(t.caduca_at) },
              { id: 'a', titulo: '', celda: (t) => <ResolverToma id={t.id} /> },
            ]} />
        </section>
      )}

      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Renta devengada">
        <h2>Renta por pieza surtida</h2>
        <DataTable etiqueta="Renta devengada" clave={(r) => r.id} filas={o.renta}
          vacio={{ titulo: 'Sin renta', texto: 'La renta se devenga solo cuando una pieza sale de la Bodega Omar al marcar enviado el pedido. Aún no hay movimientos esta semana.' }}
          columnas={[
            { id: 'f', titulo: 'Pedido', celda: (r) => <span className="rtm-mono">{r.folio}</span> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (r) => etiquetaFecha(r.fecha) },
            { id: 'm', titulo: 'Modelo y sabor', celda: (r) => `${r.modelo}${r.sabores ? ` · ${r.sabores}` : ''}` },
            { id: 'p', titulo: 'Piezas', numerica: true, celda: (r) => formatearPiezas(r.piezas) },
            { id: 't', titulo: 'Tarifa', numerica: true, secundaria: true, celda: (r) => (r.tarifa_cent === null ? <SinDato /> : formatearMoneda(r.tarifa_cent)) },
            { id: 's', titulo: 'Subtotal', numerica: true, celda: (r) => formatearMoneda(r.monto_cent, { conSigno: r.monto_cent < 0n }) },
          ]} />
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Tomas a su precio">
        <h2>Tomas a su precio</h2>
        <DataTable etiqueta="Tomas de Omar" clave={(t) => t.id} filas={o.tomas}
          vacio={{ titulo: 'Sin tomas', texto: 'Las piezas que Omar toma a crédito aparecen aquí con su precio.' }}
          columnas={[
            { id: 'f', titulo: 'Toma', celda: (t) => <span className="rtm-mono">{t.folio}</span> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (t) => etiquetaFecha(t.fecha) },
            { id: 'm', titulo: 'Pieza', celda: (t) => `${t.modelo} · ${t.sabor}` },
            { id: 'p', titulo: 'Piezas', numerica: true, celda: (t) => formatearPiezas(t.piezas) },
            { id: 'r', titulo: 'Precio', numerica: true, secundaria: true, celda: (t) => (t.precio_cent === null ? <EstadoTexto tono="atencion">Falta precio</EstadoTexto> : formatearMoneda(t.precio_cent)) },
            { id: 's', titulo: 'Subtotal', numerica: true, celda: (t) => (t.subtotal_cent === null ? <SinDato /> : formatearMoneda(t.subtotal_cent)) },
            { id: 'e', titulo: 'Estado', secundaria: true, celda: (t) => t.estado },
          ]} />
      </section>

      <section className="rtm-seccion" aria-label="Pagos con Omar">
        <h2>Pagos</h2>
        <DataTable etiqueta="Pagos con Omar" clave={(p) => p.id} filas={o.pagos}
          vacio={{ titulo: 'Sin pagos', texto: 'No se ha registrado ningún pago con Omar esta semana.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (p) => <span className="rtm-mono">{p.folio}</span> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (p) => etiquetaFecha(p.fecha) },
            { id: 's', titulo: 'Sentido', celda: (p) => (p.sentido === 'a_omar' ? 'A Omar' : 'De Omar') },
            { id: 'm', titulo: 'Monto', numerica: true, celda: (p) => formatearMoneda(p.monto_cent) },
          ]} />
      </section>

      <section className="rtm-seccion" aria-label="Liquidaciones cerradas">
        <h2>Liquidaciones cerradas</h2>
        <DataTable etiqueta="Liquidaciones de Omar" clave={(l) => l.folio} filas={o.liquidaciones}
          vacio={{ titulo: 'Sin liquidaciones', texto: 'La semana se cierra el lunes siguiente, con corte el lunes.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (l) => <span className="rtm-mono">{l.folio}</span> },
            { id: 's', titulo: 'Semana', celda: (l) => `${etiquetaFecha(l.semana_ini)} al ${etiquetaFecha(l.semana_fin)}` },
            { id: 'n', titulo: 'Neto', numerica: true, celda: (l) => formatearMoneda(l.neto_cent, { conSigno: true }) },
            { id: 'p', titulo: 'Resultado', secundaria: true, celda: (l) => l.palabra },
          ]} />
        <div className="rtm-acciones-fila">
          <ExportarCsv nombre={`omar-${o.semana_ini}.csv`} filas={[
            ['Tipo', 'Fecha', 'Referencia', 'Pieza', 'Piezas', 'Importe'],
            ...o.renta.map((r) => ['Renta', r.fecha, r.folio, r.modelo, String(r.piezas), formatearMoneda(r.monto_cent)]),
            ...o.tomas.filter((t) => t.subtotal_cent !== null).map((t) => ['Toma', t.fecha, t.folio, `${t.modelo} ${t.sabor}`, String(t.piezas), formatearMoneda(-(t.subtotal_cent ?? 0n))]),
            ['Neto', o.semana_ini, '', '', '', formatearMoneda(neto)],
          ]} />
        </div>
      </section>
    </>
  );
}
