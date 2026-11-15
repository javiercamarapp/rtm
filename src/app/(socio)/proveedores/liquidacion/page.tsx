import type { Metadata } from 'next';
import Link from 'next/link';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { operacionDeSocio } from '@/composicion/operacion';
import { sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, formatearPiezas, nombreVape } from '@/dominio/formato';
import { armarHojaProveedor } from '@/dominio/operacion/posicion_proveedor';
import type { AmbitoHoja } from '@/dominio/operacion/tipos';
import { BarraAcciones } from '@/ui/componentes/barra-acciones';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, Segmentado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { BotonAccion } from '../../operacion/formulario-accion';
import { CopiarTexto } from '../../operacion/copiar-texto';
import { CONCEPTO_CUENTA, ORIGEN } from '../../operacion/etiquetas';
import { Dos, Estado, Pie, m, pct, suma } from '../../_a3/util';
import { FormularioDicho } from './formulario-dicho';

export const metadata: Metadata = { title: 'Liquidación con el proveedor' };

export default async function PaginaLiquidacion({ searchParams }: { searchParams: Promise<{ p?: string; semana?: string; ambito?: string }> }) {
  const q = await searchParams;
  const proveedor = q.p === 'Karen' ? 'Karen' : 'Isaac';
  const ambito: AmbitoHoja = q.ambito === 'todo' ? 'todo' : 'sociedad';
  const semana = q.semana && /^\d{4}-\d{2}-\d{2}$/.test(q.semana) ? q.semana : null;
  const lector = await operacionDeSocio();
  const [h, cierres] = await Promise.all([lector.hojaProveedor(proveedor, semana, ambito), lector.liquidacionesProveedor(proveedor)]);
  const t = h.totales;
  const c = h.comprobaciones;
  const hv = armarHojaProveedor(h, await (await dropshippingDeSocio()).socioMenudeo());
  const hojaCuadra = c.cuadra && hv.cuadraConLibro;
  const enlace = (extra: Record<string, string>) => `/proveedores/liquidacion?${new URLSearchParams({ p: proveedor, semana: h.semana_ini, ambito, ...extra }).toString()}`;
  const guias = h.renglones.filter((r) => r.guia_cent > 0n || r.guia_pendiente);
  const cerrada = h.cierre !== null;
  const depositos = h.pagos_por_concepto_cent['pago_cliente_redirigido'] ?? 0n;
  const pagosSocios = (h.pagos_por_concepto_cent['pago_socio'] ?? 0n) + (h.pagos_por_concepto_cent['pago_sociedad'] ?? 0n);
  const pasos = [
    { id: 'ant', etiqueta: 'Saldo anterior (posición al inicio)', valor: Number(t.saldo_anterior_cent), tipo: 'inicio' as const, texto: m(t.saldo_anterior_cent) },
    { id: 'mer', etiqueta: 'Mercancía', valor: Number(t.mercancia_cent), tipo: 'delta' as const, texto: m(t.mercancia_cent, true) },
    { id: 'seg', etiqueta: 'Seguros', valor: Number(t.seguros_cent), tipo: 'delta' as const, texto: m(t.seguros_cent, true) },
    { id: 'gui', etiqueta: 'Guías', valor: Number(t.guias_cent), tipo: 'delta' as const, texto: m(t.guias_cent, true) },
    { id: 'pag', etiqueta: 'Pagos', valor: -Number(t.pagos_cent), tipo: 'delta' as const, texto: m(-t.pagos_cent, true) },
    { id: 'aju', etiqueta: 'Ajustes', valor: -Number(t.ajustes_cent), tipo: 'delta' as const, texto: m(-t.ajustes_cent, true) },
    { id: 'fal', etiqueta: 'Falta por saldar', valor: Number(t.falta_por_saldar_cent), tipo: 'total' as const, texto: m(t.falta_por_saldar_cent, true) },
  ];
  const pruebas: [string, boolean][] = [
    ['Cada renglón = piezas × costo vigente', c.renglon_igual_detalle],
    [`Suma de renglones = total de mercancía (${m(c.mercancia_independiente_cent)})`, c.renglones_igual_mercancia],
    [`Suma de seguros = seguros declarados (${m(c.seguros_independiente_cent)})`, c.renglones_igual_seguros],
    [`Suma de guías = envíos (${m(c.guias_independiente_cent)})`, c.guias_igual_envios],
    [`Cada abono = un depósito (${m(c.depositos_independiente_cent)})`, c.abonos_igual_depositos],
    ...(c.libro_aplica ? ([[`Saldo de la hoja = saldo del libro al corte (${m(t.libro_al_corte_cent, true)})${c.libro_igual_hoja ? '' : `: diferencia ${m(t.diferencia_libro_cent, true)}`}`, c.libro_igual_hoja]] as [string, boolean][]) : []),
  ];
  const totalCosto = t.costo_total_cent;
  const abonosYAjustes = [...h.abonos, ...h.ajustes.map((x) => ({ ...x, cliente: null, pedido: null, cuenta_origen: null }))];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: `/proveedores?p=${proveedor}`, texto: 'Proveedores' }}
        eyebrow={`Liquidación con ${proveedor}`}
        titulo={`Lo que falta por saldar con ${proveedor}`}
        descripcion={`Semana del ${etiquetaFecha(h.semana_ini)} al ${etiquetaFecha(h.semana_fin)} · ${cerrada ? `liquidada (${h.cierre!.folio})` : h.viernes_cerrado ? 'lista para liquidar' : `se liquida a partir del viernes ${etiquetaFecha(h.semana_fin)}`}`}
        acciones={
          <BarraAcciones
            etiquetaAria="Opciones de la liquidación"
            primarias={
              <>
                <Segmentado etiquetaAria="Proveedor" opciones={[{ valor: 'Isaac', etiqueta: 'Isaac', href: enlace({ p: 'Isaac' }), activa: proveedor === 'Isaac' }, { valor: 'Karen', etiqueta: 'Karen', href: enlace({ p: 'Karen' }), activa: proveedor === 'Karen' }]} />
                <Segmentado etiquetaAria="Ámbito de la hoja" opciones={[{ valor: 's', etiqueta: 'Sociedad', href: enlace({ ambito: 'sociedad' }), activa: ambito === 'sociedad', testid: 'ambito-sociedad' }, { valor: 't', etiqueta: 'Todo', href: enlace({ ambito: 'todo' }), activa: ambito === 'todo', testid: 'ambito-todo' }]} />
              </>
            }
            secundarias={
              <>
                <Link className="rtm-boton rtm-boton-terciario" href={enlace({ semana: sumarDias(h.semana_ini, -7) })}>Semana anterior</Link>
                <Link className="rtm-boton rtm-boton-terciario" href={enlace({ semana: sumarDias(h.semana_ini, 7) })}>Semana siguiente</Link>
              </>
            }
          />
        }
      />
      {h.guias_pendientes > 0 && <Aviso tono="atencion" titulo="Cifra provisional.">{h.guias_pendientes} guías sin costo real: la hoja es provisional hasta costearlas.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores de la liquidación"
        celdas={[
          { id: 'falta', etiqueta: 'Falta por saldar', testid: 'falta-por-saldar', valor: <CifraComprobada texto={m(t.falta_por_saldar_cent)} cifra={`proveedor:falta:${proveedor}:${h.semana_ini}:${ambito}`} comprobacion={hojaCuadra ? 'cuadra' : 'no_cuadra'} />, categoria: 4, nota: <span data-testid="comprobacion"><Estado tono={hojaCuadra ? 'ok' : 'malo'}>{hojaCuadra ? 'Cuadra' : 'No cuadra'}</Estado></span> },
          { id: 'costo', etiqueta: 'Costo de pedidos y órdenes', valor: m(t.mercancia_cent), categoria: 1, nota: `${h.renglones.length} renglones · con seguros ${m(t.mercancia_cent + t.seguros_cent)}` },
          { id: 'guias', etiqueta: 'Guías y seguros', valor: m(t.guias_cent + t.seguros_cent), categoria: 6, nota: `${guias.length} guías` },
          { id: 'dep', etiqueta: 'Depósitos de clientes', valor: m(depositos), categoria: 2, nota: 'Clientes que pagaron al proveedor' },
          { id: 'pagos', etiqueta: 'Pagos de socios y de la sociedad', valor: m(pagosSocios), categoria: 7, nota: `Total pagos ${m(t.pagos_cent)}` },
        ]}
      />
      <FilaRatios
        etiqueta="Conciliación"
        items={[
          { etiqueta: `Lo que dice ${proveedor}`, valor: h.conciliacion ? <span data-testid="dicho">{m(h.conciliacion.dicho_cent)}</span> : null },
          { etiqueta: 'Nuestra cuenta', valor: h.conciliacion ? m(h.conciliacion.nuestro_cent) : null },
          { etiqueta: 'Diferencia', valor: h.conciliacion ? <span data-testid="diferencia">{m(h.conciliacion.diferencia_cent, true)}</span> : null },
          { etiqueta: 'Saldo anterior (inicio de la semana)', valor: hv.saldoAnterior },
          { etiqueta: 'Ajustes a favor', valor: m(t.ajustes_cent) },
        ]}
      />

      <Rejilla dividir="6-6">
        <Tarjeta titulo="De dónde sale lo que falta" descripcion={hv.separacion ? `${hv.nota} ${hv.separacion}.` : hv.nota}>
          <Cascada titulo="Cascada de la liquidación" descripcion={`Falta por saldar ${m(t.falta_por_saldar_cent)} desde un saldo anterior de ${m(t.saldo_anterior_cent)}.`} pasos={pasos} unidad="Pesos" />
        </Tarjeta>
        <Tarjeta titulo="Comprobaciones por dos vías" descripcion="Cada cifra se calcula de dos maneras independientes">
          <ul className="a3-pruebas" aria-label="Comprobaciones">
            {pruebas.map(([n, ok]) => <li key={n}><span>{n}</span><Estado tono={ok ? 'ok' : 'malo'}>{ok ? 'Cuadra' : 'No cuadra'}</Estado></li>)}
          </ul>
          <BarList etiquetaAria="Composición del costo" items={[
            { id: 'mer', etiqueta: 'Mercancía', texto: m(t.mercancia_cent), pct: pct(t.mercancia_cent, totalCosto) },
            { id: 'seg', etiqueta: 'Seguros', texto: m(t.seguros_cent), pct: pct(t.seguros_cent, totalCosto) },
            { id: 'gui', etiqueta: 'Guías', texto: h.guias_pendientes > 0 ? `${m(t.guias_cent)} (provisional)` : m(t.guias_cent), pct: pct(t.guias_cent, totalCosto) },
          ]} />
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="1. Nota por pedido a costo" descripcion="Cada pedido directo y orden de compra de la semana, con su detalle a costo">
        <DataTable
          etiqueta="Renglones de la hoja"
          densidad="densa" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar folio', porPagina: 50, exportar: `hoja-${proveedor}-${h.semana_ini}` }}
          clave={(r) => `${r.tipo}-${r.id}`}
          filas={h.renglones}
          totales={{ etiqueta: `Total (${h.renglones.length})`, celdas: { p: formatearPiezas(h.renglones.reduce((a, r) => a + r.piezas, 0)), c: m(suma(h.renglones.map((r) => r.mercancia_cent + r.seguro_cent))), g: m(suma(h.renglones.map((r) => r.guia_cent))) } }}
          vacio={{ titulo: 'Sin renglones', texto: 'No hay pedidos directos ni órdenes de compra de este proveedor en la semana.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 'l', celda: (r) => <Dos a={<Link className="rtm-mono" href={r.tipo === 'oc' ? `/proveedores/compras/${r.id}` : `/pedidos/${r.id}`}>{r.folio}</Link>} b={r.tipo === 'oc' ? 'Orden de compra' : (ORIGEN[r.origen as keyof typeof ORIGEN] ?? r.origen)} /> },
            { id: 'd', titulo: 'Fecha', ancho: 's', celda: (r) => etiquetaFecha(r.fecha) },
            { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (r) => formatearPiezas(r.piezas) },
            { id: 'm', titulo: 'Detalle a costo', ancho: 'xl', secundaria: true, celda: (r) => r.detalle.map((x) => `${nombreVape(x.modelo)}: ${x.piezas} × ${m(x.costo_unit_cent)}`).join(' · ') },
            { id: 'c', titulo: 'Costo', numerica: true, ancho: 'm', celda: (r) => m(r.mercancia_cent + r.seguro_cent) },
            { id: 'g', titulo: 'Guía', numerica: true, ancho: 'm', celda: (r) => (r.guia_pendiente ? <Estado tono="atencion">Sin costo real</Estado> : m(r.guia_cent)) },
            { id: 'a', titulo: 'Alcance', ancho: 's', secundaria: true, celda: (r) => (r.es_de_sociedad ? 'Sociedad' : 'Propio') },
            { id: 'k', titulo: 'Cuadra', ancho: 's', secundaria: true, celda: (r) => <Estado tono={r.cuadra ? 'ok' : 'malo'}>{r.cuadra ? 'Sí' : 'No'}</Estado> },
          ]}
        />
      </Tarjeta>

      <Rejilla dividir="8-4">
        <Tarjeta plana titulo="2. Cuenta: abonos y ajustes" descripcion="Depósitos de clientes, pagos de socios y ajustes de la semana">
          <DataTable
            etiqueta="Abonos de la semana"
            densidad="densa" plana pegajosa primeraFija
            clave={(a) => a.id}
            filas={abonosYAjustes}
            totales={{ etiqueta: 'Neto', celdas: { m: m(suma(abonosYAjustes.map((a) => a.monto_cent)), true) } }}
            vacio={{ titulo: 'Sin abonos', texto: 'Los depósitos de clientes al proveedor, los pagos de socios y los ajustes de la semana aparecen aquí.' }}
            columnas={[
              { id: 'd', titulo: 'Fecha', ancho: 's', celda: (a) => etiquetaFecha(a.fecha_neg) },
              { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (a) => <Dos a={<>{CONCEPTO_CUENTA[a.concepto] ?? a.concepto}{a.deshecho ? ' (deshecho)' : ''}</>} b={a.cliente ? `Cliente: ${a.cliente}${a.pedido ? ` · ${a.pedido}` : ''}` : a.nota} /> },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (a) => m(a.monto_cent, true) },
              { id: 'q', titulo: 'Quién', ancho: 'l', secundaria: true, celda: (a) => <Dos a={a.autor ?? a.canal} b={<span className="rtm-mono">{a.evento}</span>} /> },
              { id: 'x', titulo: '', ancho: 's', celda: (a) => ((a.concepto === 'ajuste' || a.concepto === 'pago_sociedad') && !a.deshecho ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_proveedor" args={{ p_movimiento: a.id }} motivo="Motivo" titulo="Deshacer movimiento" /> : null) },
            ]}
          />
        </Tarjeta>
        <Tarjeta plana titulo="3. Costo de guías por pedido">
          <DataTable
            etiqueta="Guías por pedido"
            densidad="densa" plana
            clave={(r) => `${r.tipo}-${r.id}`}
            filas={guias}
            totales={{ etiqueta: 'Total', celdas: { g: m(suma(guias.map((r) => r.guia_cent))) } }}
            vacio={{ titulo: 'Sin guías', texto: 'Ningún renglón de la semana tiene guía a cargo de este proveedor.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'l', celda: (r) => <span className="rtm-mono">{r.folio}</span> },
              { id: 'g', titulo: 'Guía', numerica: true, ancho: 'm', celda: (r) => (r.guia_pendiente ? <Estado tono="atencion">Sin costo real</Estado> : m(r.guia_cent)) },
            ]}
          />
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo={`Conciliación contra lo que dice ${proveedor}`} descripcion="No se toma por verdad ni la cifra del proveedor ni la nuestra: se explica renglón por renglón">
        {h.conciliacion && h.conciliacion.renglones.length > 0 ? (
          <DataTable
            etiqueta="Conciliación por renglón"
            densidad="densa" plana
            clave={(r) => r.folio}
            filas={h.conciliacion.renglones}
            totales={{ etiqueta: 'Total', celdas: { a: m(h.conciliacion.dicho_cent), n: m(h.conciliacion.nuestro_cent), d: m(h.conciliacion.diferencia_cent, true) } }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'l', celda: (r) => <span className="rtm-mono">{r.folio}</span> },
              { id: 'a', titulo: 'Dice el proveedor', numerica: true, ancho: 'm', celda: (r) => (r.dice_cent === null ? <SinDato /> : m(r.dice_cent)) },
              { id: 'n', titulo: 'Nuestra cuenta', numerica: true, ancho: 'm', celda: (r) => (r.nuestro_cent === null ? <SinDato /> : m(r.nuestro_cent)) },
              { id: 'd', titulo: 'Diferencia', numerica: true, ancho: 'm', celda: (r) => m(r.diferencia_cent, true) },
              { id: 'e', titulo: 'En nuestra hoja', ancho: 's', secundaria: true, celda: (r) => (r.en_nuestra_hoja ? 'Sí' : 'No') },
            ]}
          />
        ) : (
          <div className="a3-pie-tarjeta"><Pie>Todavía no se registra lo que dice {proveedor}. Al capturarlo se compara renglón por renglón.</Pie></div>
        )}
        {!cerrada && <div className="a3-pie-tarjeta"><div className="rtm-acciones-fila"><FormularioDicho proveedor={proveedor} semana={h.semana_ini} ambito={ambito} /></div></div>}
      </Tarjeta>

      <Rejilla dividir="4-8">
        <Tarjeta titulo="Cerrar la semana">
          {cerrada ? (
            <p data-testid="cerrada"><Estado tono="ok">Liquidada</Estado> {h.cierre!.folio} el {etiquetaFecha(h.cierre!.fecha_cierre)}: falta por saldar {m(h.cierre!.falta_por_saldar_cent)}.</p>
          ) : (
            <Pie>{h.viernes_cerrado ? 'Ya se puede liquidar. Quedan congeladas la hoja, lo que dijo el proveedor y la diferencia.' : `Se podrá liquidar a partir del viernes ${etiquetaFecha(h.semana_fin)}.`}</Pie>
          )}
          <div className="a3-acciones">
            {!cerrada && <BotonAccion primario texto="Cerrar liquidación" titulo={`Cerrar liquidación de ${proveedor}`} confirmarTexto="Cerrar liquidación" accion="cerrar_liquidacion_proveedor"
              args={{ p_proveedor: proveedor, p_semana_ini: h.semana_ini, p_ambito: ambito }} desactivado={!h.viernes_cerrado || !c.cuadra} testid="cerrar-liquidacion" />}
            <CopiarTexto etiqueta="Copiar nota para el proveedor" fuente={{ tipo: 'proveedor', proveedor, semana: h.semana_ini, ambito }} />
          </div>
        </Tarjeta>
        <Tarjeta plana titulo="Liquidaciones cerradas">
          <DataTable
            etiqueta="Historial de liquidaciones"
            densidad="densa" plana
            clave={(l) => l.id}
            filas={cierres}
            vacio={{ titulo: 'Sin liquidaciones', texto: 'Todavía no se cierra ninguna semana con este proveedor.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'm', celda: (l) => <span className="rtm-mono">{l.folio}</span> },
              { id: 's', titulo: 'Semana', ancho: 'l', celda: (l) => `${etiquetaFecha(l.semana_ini)} al ${etiquetaFecha(l.semana_fin)}` },
              { id: 'a', titulo: 'Alcance', ancho: 's', secundaria: true, celda: (l) => (l.ambito === 'todo' ? 'Todo' : 'Sociedad') },
              { id: 'c', titulo: 'Costo con guías', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.mercancia_cent + l.seguros_cent + l.guias_cent) },
              { id: 'p', titulo: 'Pagos', numerica: true, ancho: 'm', secundaria: true, celda: (l) => m(l.pagos_cent) },
              { id: 'v', titulo: 'Falta por saldar', numerica: true, ancho: 'm', celda: (l) => m(l.falta_por_saldar_cent) },
              { id: 'd', titulo: 'Dijo el proveedor', numerica: true, ancho: 'm', secundaria: true, celda: (l) => (l.dicho_cent === null ? <SinDato /> : m(l.dicho_cent)) },
            ]}
          />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
