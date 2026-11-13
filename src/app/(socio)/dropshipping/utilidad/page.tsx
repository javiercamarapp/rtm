import type { Metadata } from 'next';
import Link from 'next/link';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, BarraFiltros, Chip } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { fechaOpcional, PestanasDs, TIPO_VENTA } from '../comun';

export const metadata: Metadata = { title: 'Utilidad de dropshipping' };

export default async function PaginaUtilidadDs({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const sp = await searchParams;
  const desde = fechaOpcional(sp.desde);
  const hasta = fechaOpcional(sp.hasta);
  const ds = await dropshippingDeSocio();
  const [u, rep, resumen] = await Promise.all([ds.utilidad(desde, hasta), ds.reporteMensual(6), ds.resumen()]);
  const t = u.totales;
  const [d, h] = [desde ?? '-', hasta ?? '-'];
  const cif = (m: string, texto: string) => <CifraComprobada texto={texto} cifra={`dsu:${m}:${d}:${h}`} comprobacion="cuadra" />;
  const meses = [...rep.meses].reverse();
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Dropshipping · Utilidad · ${etiquetaHoy()}`}
        titulo={t.pedidos ? `Utilidad de ${t.pedidos} ${t.pedidos === 1 ? 'pedido' : 'pedidos'}: ${formatearMoneda(t.utilidad_cent)}` : 'Sin utilidad de dropshipping todavía'}
        descripcion="Utilidad = venta (con el envío cobrado) menos todo el costo del pedido: producto, envío del proveedor y costos directos. Mitad para cada socio."
      />
      <PestanasDs activa="utilidad" sinFolio={resumen.sin_folio_externo} />
      <BarraFiltros etiquetaAria="Periodo" extras={desde || hasta ? <Chip href="/dropshipping/utilidad">Quitar filtros</Chip> : undefined}>
        <form className="rtm-form-fila" method="get" aria-label="Periodo">
          <label className="rtm-etiqueta-campo">Desde<input className="rtm-campo" type="date" name="desde" defaultValue={desde ?? ''} /></label>
          <label className="rtm-etiqueta-campo">Hasta<input className="rtm-campo" type="date" name="hasta" defaultValue={hasta ?? ''} /></label>
          <button type="submit" className="rtm-boton">Aplicar</button>
        </form>
      </BarraFiltros>
      {t.pedidos > 0 && t.reinvertida_cent < t.utilidad_cent && <Aviso tono="info" titulo="Parte de la utilidad no está en el proveedor.">{formatearMoneda(t.fuera_proveedor_cent)} de la utilidad está por cobrar o en poder de un socio; solo lo depositado por encima del costo en la cuenta del proveedor cuenta como reinvertido.</Aviso>}
      <KpiLinea
        etiquetaAria="Utilidad del periodo"
        celdas={[
          { id: 'venta', etiqueta: 'Venta', valor: cif('venta', formatearMoneda(t.venta_cent)), categoria: 2 },
          { id: 'costo', etiqueta: 'Costo total', valor: cif('costo', formatearMoneda(t.costo_cent)), categoria: 4, nota: 'Producto, envío del proveedor y otros directos' },
          { id: 'util', etiqueta: 'Utilidad', valor: cif('utilidad', formatearMoneda(t.utilidad_cent)), categoria: 3, testid: 'kpi-utilidad' },
          ...t.socios.map((s, i) => ({ id: `s${i}`, etiqueta: `Parte de ${s.socio}`, valor: formatearMoneda(s.utilidad_cent), categoria: ((i % 2) + 5) as 5 | 6, nota: `Reinvertido ${formatearMoneda(s.reinvertida_cent)}` })),
          { id: 'reinv', etiqueta: 'Reinvertida en el proveedor', valor: cif('reinvertida', formatearMoneda(t.reinvertida_cent)), categoria: 7 },
        ]}
      />
      <Tarjeta plana titulo="Desglose por pedido" descripcion="Costo, venta, utilidad, mitad de cada socio, lo reinvertido y lo que quedó fuera del proveedor">
        <DataTable
          etiqueta="Utilidad por pedido"
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar folio o cliente', porPagina: 50, exportar: 'dropshipping-utilidad' }}
          clave={(f) => f.pedido_id}
          filas={u.filas}
          totales={u.filas.length ? { etiqueta: 'Total del periodo', celdas: { cs: formatearMoneda(t.costo_cent), v: formatearMoneda(t.venta_cent), u: formatearMoneda(t.utilidad_cent), r: formatearMoneda(t.reinvertida_cent), fp: formatearMoneda(t.fuera_proveedor_cent) } } : undefined}
          vacio={{ titulo: 'Sin utilidad de dropshipping todavía', texto: 'Aparece cuando un pedido de dropshipping se envía.' }}
          columnas={[
            { id: 'f', titulo: 'Pedido', ancho: 'm', prioridadMovil: 'normal', celda: (f) => <Link className="rtm-mono" href={`/dropshipping/pedidos/${f.pedido_id}`}>{f.folio}</Link> },
            { id: 'c', titulo: 'Cliente', ancho: 'xl', prioridadMovil: 'titulo', celda: (f) => `${f.cliente}${f.tipo_venta === 'socio_a_costo' ? ` (${TIPO_VENTA['socio_a_costo']})` : ''}` },
            { id: 'cs', titulo: 'Costo', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => <span title={`Producto ${formatearMoneda(f.costo_producto_cent)} · envío del proveedor ${formatearMoneda(f.envio_proveedor_cent)} · otros ${formatearMoneda(f.otros_directos_cent)}`}>{formatearMoneda(f.costo_cent)}</span> },
            { id: 'v', titulo: 'Venta', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => formatearMoneda(f.venta_cent) },
            { id: 'u', titulo: 'Utilidad', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => `${formatearMoneda(f.utilidad_cent)}${f.provisional ? ' (provisional)' : ''}` },
            ...(u.filas[0]?.socios ?? []).map((s, i) => ({ id: `s${i}`, titulo: `Mitad de ${s.socio}`, numerica: true as const, ancho: 'm' as const, secundaria: true, prioridadMovil: 'oculta' as const, celda: (f: (typeof u.filas)[number]) => formatearMoneda(f.socios[i]?.utilidad_cent ?? 0n) })),
            { id: 'r', titulo: 'Reinvertida', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (f) => formatearMoneda(f.reinvertida_cent) },
            { id: 'fp', titulo: 'Fuera del proveedor', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (f) => formatearMoneda(f.fuera_proveedor_cent) },
            { id: 'fd', titulo: 'Enviado', ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (f) => etiquetaFecha(f.fecha_envio) },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Reporte mensual por socio" descripcion="Utilidad del mes y acumulada, reinvertida (mes y acumulada), inversión al cierre y participación en la valuación">
        <DataTable
          etiqueta="Reporte mensual por socio"
          densidad="densa" plana
          clave={(r) => `${r.mes}-${r.socio}`}
          filas={meses.flatMap((m) => m.socios.map((s) => ({ ...s, mes: m.mes, conciliacion: m.conciliacion })))}
          vacio={{ titulo: 'Sin datos todavía', texto: 'El reporte se llena con los pedidos enviados.' }}
          columnas={[
            { id: 'm', titulo: 'Mes', ancho: 'm', prioridadMovil: 'titulo', celda: (r) => r.mes },
            { id: 's', titulo: 'Socio', ancho: 'm', prioridadMovil: 'normal', celda: (r) => r.socio },
            { id: 'um', titulo: 'Utilidad del mes', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (r) => formatearMoneda(r.utilidad_mes_cent) },
            { id: 'ua', titulo: 'Utilidad acumulada', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'normal', celda: (r) => formatearMoneda(r.utilidad_acum_cent) },
            { id: 'rm', titulo: 'Reinvertida en el mes', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (r) => formatearMoneda(r.reinvertida_mes_cent) },
            { id: 'ra', titulo: 'Reinvertida acumulada', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'normal', celda: (r) => formatearMoneda(r.reinvertida_acum_cent) },
            { id: 'ac', titulo: 'Reinvertida por acta (acum.)', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (r) => formatearMoneda(r.reinvertida_por_acta_acum_cent) },
            { id: 'rt', titulo: 'Retirado por acta (mes)', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (r) => formatearMoneda(r.retirado_por_acta_mes_cent) },
            { id: 'ca', titulo: 'Capital declarado', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (r) => formatearMoneda(r.capital_declarado_cent) },
            { id: 'sg', titulo: 'Sugerido para el acta', numerica: true, ancho: 'm', prioridadMovil: 'oculta', celda: (r) => formatearMoneda(r.sugerido_acta_cent) },
            { id: 'va', titulo: 'Valuación del socio', numerica: true, ancho: 'm', secundaria: true, prioridadMovil: 'oculta', celda: (r) => (r.valuacion_cent === null ? 'Sin dato' : formatearMoneda(r.valuacion_cent)) },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Conciliación con el Estado de resultados" descripcion="Suma de utilidades por pedido más lo que no es de un pedido (mermas, servicios, ajustes) igual a la utilidad del periodo">
        <DataTable
          etiqueta="Conciliación mensual"
          densidad="densa" plana
          clave={(m) => m.mes}
          filas={meses}
          vacio={{ titulo: 'Sin datos todavía', texto: 'Se llena con los pedidos enviados.' }}
          columnas={[
            { id: 'm', titulo: 'Mes', ancho: 'm', prioridadMovil: 'titulo', celda: (m) => m.mes },
            { id: 'ds', titulo: 'Dropshipping', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (m) => formatearMoneda(m.conciliacion.utilidad_dropshipping_cent) },
            { id: 'inv', titulo: 'Inventario en Mérida', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (m) => formatearMoneda(m.conciliacion.utilidad_inventario_cent) },
            { id: 'ot', titulo: 'Mermas, servicios y ajustes', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (m) => formatearMoneda(m.conciliacion.otros_no_pedido_cent) },
            { id: 'up', titulo: 'Utilidad del periodo', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (m) => <CifraComprobada texto={formatearMoneda(m.conciliacion.utilidad_periodo_cent)} cifra={`dsu:resultado:${m.conciliacion.ini}:${m.conciliacion.fin}`} comprobacion={m.conciliacion.cuadra ? 'cuadra' : 'no_cuadra'} /> },
            { id: 'ok', titulo: 'Cuadra con el Estado de resultados', ancho: 'm', prioridadMovil: 'normal', celda: (m) => (m.conciliacion.cuadra ? 'Sí' : `No: diferencia ${formatearMoneda(m.conciliacion.diferencia_cent)}`) },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
