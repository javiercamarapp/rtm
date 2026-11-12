import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { GraficaBarras } from '@/ui/graficas/barras';
import { etiquetaHoy } from '../contexto';
import { CUBETA, ESTADO_CXC } from '../operacion/etiquetas';
import { FormularioPago, IdentificarPago, EntregaSocio } from './formularios';
import { FormularioAccion } from '../operacion/formulario-accion';
import { CopiarTexto } from '../operacion/copiar-texto';

export const metadata: Metadata = { title: 'Cuentas por cobrar' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ cliente?: string; vencido?: string; desde?: string; hasta?: string }> }) {
  const { cliente = '', vencido = '', desde = '', hasta = '' } = await searchParams;
  const lector = await operacionDeSocio();
  const [d, ctx] = await Promise.all([lector.cuentasPorCobrar(), lector.contextoPagos()]);
  const filas = d.filas.filter((f) => (!cliente || String(f.cliente_id) === cliente) && (!vencido || f.estado === 'vencido') && (!desde || f.fecha_envio >= desde) && (!hasta || f.fecha_envio <= hasta));
  const enlace = (c: Record<string, string>) => {
    const q = new URLSearchParams({ ...(cliente ? { cliente } : {}), ...(vencido ? { vencido } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...c });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return q.toString() ? `/cuentas-por-cobrar?${q.toString()}` : '/cuentas-por-cobrar';
  };
  const principal = d.por_cliente[0];
  const barras = (Object.keys(CUBETA) as (keyof typeof d.antiguedad_cent)[]).map((k) => ({ etiqueta: CUBETA[k]!, valor: Number(d.antiguedad_cent[k]), texto: formatearMoneda(d.antiguedad_cent[k]), destacado: false }));
  const hayAntiguedad = barras.some((b) => b.valor > 0);

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Cuentas por cobrar · ${etiquetaHoy()}`}
        antes={d.total_cent === 0n ? 'No hay' : 'Tienes'}
        enfasis={d.total_cent === 0n ? 'nada por cobrar' : formatearMoneda(d.total_cent)}
        despues={d.total_cent === 0n ? '' : 'por cobrar'}
        contexto={`${principal ? `Tienes ${formatearMoneda(principal.saldo_cent)} por cobrar de ${principal.cliente}${principal.proximo_vence ? `, vence el ${etiquetaFecha(principal.proximo_vence)}` : ''}. ` : ''}Un pago que cae en la cuenta de un socio sí liquida al cliente, pero el dinero es de la sociedad: queda como deuda de ese socio hasta que lo entregue. Lo que el cliente pagó de más es saldo a su favor.`}
        acciones={<FormularioPago cuentas={ctx.cuentas.map((c) => c.nombre)} clientes={ctx.clientes.map((c) => ({ id: c.id, nombre: c.nombre }))} />}
      />

      <div className="rtm-kpis">
        <div className="rtm-kpi"><span>Total por cobrar</span><strong><CifraComprobada texto={formatearMoneda(d.total_cent)} cifra="cxc:total" comprobacion="cuadra" /></strong></div>
        <div className="rtm-kpi"><span>Vencido</span><strong>{formatearMoneda(d.vencido_cent)}</strong></div>
        <div className="rtm-kpi"><span>Clientes con saldo</span><strong>{d.por_cliente.length}</strong></div>
        <div className="rtm-kpi"><span>Saldos a favor de clientes</span><strong>{d.saldos_a_favor.length}</strong></div>
      </div>

      <div className="rtm-barra-filtros" aria-label="Filtros">
        <Link className="rtm-chip-filtro" href="/cuentas-por-cobrar" aria-current={!cliente && !vencido && !desde && !hasta}>Todos</Link>
        <Link className="rtm-chip-filtro" href={enlace({ vencido: vencido ? '' : '1' })} aria-current={vencido === '1'}>Solo vencido</Link>
        <form action="/cuentas-por-cobrar" method="get" className="rtm-acciones-fila" aria-label="Filtrar por cliente y fechas">
          <select className="rtm-campo" name="cliente" defaultValue={cliente} aria-label="Cliente">
            <option value="">Todos los clientes</option>
            {d.por_cliente.map((c) => <option key={c.cliente_id} value={c.cliente_id}>{c.cliente}</option>)}
          </select>
          <input className="rtm-campo" type="date" name="desde" defaultValue={desde} aria-label="Enviado desde" />
          <input className="rtm-campo" type="date" name="hasta" defaultValue={hasta} aria-label="Enviado hasta" />
          {vencido && <input type="hidden" name="vencido" value="1" />}
          <button type="submit" className="rtm-boton">Filtrar</button>
        </form>
      </div>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Saldos por pedido">
        <h2>Por pedido</h2>
        <DataTable
          etiqueta="Cuentas por cobrar por pedido"
          clave={(f) => f.pedido_id}
          filas={filas}
          vacio={{ titulo: 'Nada por cobrar', texto: 'Cuando se envíe un pedido y no esté saldado, aparecerá aquí con su plazo, vencimiento y antigüedad.', accion: <Link className="rtm-boton" href="/pedidos">Ver pedidos</Link> }}
          columnas={[
            { id: 'c', titulo: 'Cliente', celda: (f) => <Link href={`/clientes/${f.cliente_id}`}>{f.cliente}</Link> },
            { id: 'f', titulo: 'Pedido', celda: (f) => <Link className="rtm-mono" href={`/pedidos/${f.pedido_id}`}>{f.folio}</Link> },
            { id: 'e', titulo: 'Enviado', secundaria: true, celda: (f) => etiquetaFecha(f.fecha_envio) },
            { id: 'p', titulo: 'Plazo', secundaria: true, celda: (f) => (f.plazo_dias === null ? <SinDato /> : `${f.plazo_dias} días`) },
            { id: 'v', titulo: 'Vence', secundaria: true, celda: (f) => (f.vence ? etiquetaFecha(f.vence) : <SinDato />) },
            { id: 'o', titulo: 'Original', numerica: true, secundaria: true, celda: (f) => formatearMoneda(f.original_cent) },
            { id: 'rc', titulo: 'Recargo', numerica: true, secundaria: true, celda: (f) => (f.recargo_cent > 0n ? formatearMoneda(f.recargo_cent) : <SinDato />) },
            { id: 'a', titulo: 'Abonos', numerica: true, secundaria: true, celda: (f) => formatearMoneda(f.abonos_cent) },
            { id: 's', titulo: 'Saldo', numerica: true, celda: (f) => <CifraComprobada texto={formatearMoneda(f.saldo_cent)} cifra={`pedido:saldo:${f.pedido_id}`} comprobacion="cuadra" /> },
            { id: 'd', titulo: 'Atraso', numerica: true, secundaria: true, celda: (f) => (f.dias_atraso === null ? <SinDato /> : `${f.dias_atraso} d`) },
            { id: 'x', titulo: 'Estado', celda: (f) => <EstadoTexto tono={ESTADO_CXC[f.estado].tono}>{ESTADO_CXC[f.estado].texto}</EstadoTexto> },
            { id: 'z', titulo: 'Acciones', celda: (f) => (
              <span className="rtm-acciones-fila">
                <FormularioAccion chico boton="Acordar plazo" titulo={`Plazo de ${f.folio}`} confirmar="Acordar plazo" accion="acordar_plazo" fijos={{ p_pedido: f.pedido_id }} testid={`plazo-${f.pedido_id}`}
                  campos={[{ nombre: 'p_dias', etiqueta: 'Días de plazo desde el envío', tipo: 'entero', requerido: true, defecto: f.plazo_dias === null ? '' : String(f.plazo_dias) }]} />
                {f.saldo_cent > 0n && (
                  <FormularioAccion chico boton="Registrar recargo" titulo={`Recargo por crédito de ${f.folio}`} confirmar="Registrar recargo" accion="registrar_recargo_credito" fijos={{ p_pedido: f.pedido_id }} testid={`recargo-${f.pedido_id}`}
                    campos={[{ nombre: 'p_monto_cent', etiqueta: `Monto del recargo (sugerido ${d.recargo_bp / 100} %: ${formatearMoneda(f.recargo_sugerido_cent)})`, tipo: 'monto', requerido: true, defecto: String(Number(f.recargo_sugerido_cent) / 100) },
                      { nombre: 'p_motivo', etiqueta: 'Motivo', tipo: 'texto', defecto: 'Recargo por crédito' }]}
                    nota="Sale como corrección enlazada de la nota: la nota original no cambia." />
                )}
              </span>) },
          ]}
        />
      </section>

      {d.apertura.length > 0 && (
        <section className="rtm-seccion" aria-label="Saldos de apertura por cobrar">
          <h2>Saldos de apertura por cobrar</h2>
          <DataTable
            etiqueta="Cuentas por cobrar cargadas en la apertura"
            clave={(a) => a.partida_id}
            filas={d.apertura.filter((a) => !cliente || String(a.cliente_id) === cliente)}
            columnas={[
              { id: 'c', titulo: 'Cliente', celda: (a) => <Link href={`/clientes/${a.cliente_id}`}>{a.cliente}</Link> },
              { id: 'f', titulo: 'Adeudo del', secundaria: true, celda: (a) => etiquetaFecha(a.fecha_ref) },
              { id: 'o', titulo: 'Original', numerica: true, secundaria: true, celda: (a) => formatearMoneda(a.original_cent) },
              { id: 'a', titulo: 'Abonos', numerica: true, secundaria: true, celda: (a) => formatearMoneda(a.abonos_cent) },
              { id: 's', titulo: 'Saldo', numerica: true, celda: (a) => formatearMoneda(a.saldo_cent) },
              { id: 'd', titulo: 'Antigüedad', numerica: true, secundaria: true, celda: (a) => `${a.dias} d` },
            ]}
          />
          <p className="rtm-nota">Vienen de la apertura firmada por los dos socios. Un pago del cliente se aplica primero a esta deuda, la más antigua.</p>
        </section>
      )}

      {hayAntiguedad && (
        <GraficaBarras titulo="Antigüedad de saldos" unidad="Pesos" descripcion="Saldo por cobrar según los días desde el envío; el tramo más viejo con saldo es el que pide atención." datos={barras.map((b, i, a) => ({ ...b, destacado: b.valor > 0 && a.slice(i + 1).every((x) => x.valor === 0) }))} />
      )}

      <section className="rtm-seccion" aria-label="Concentración por cliente">
        <h2>Concentración por cliente</h2>
        <DataTable
          etiqueta="Saldo por cliente"
          clave={(c) => c.cliente_id}
          filas={d.por_cliente}
          vacio={{ titulo: 'Sin saldos', texto: 'Ningún cliente debe nada por ahora.' }}
          columnas={[
            { id: 'c', titulo: 'Cliente', celda: (c) => <Link href={`/clientes/${c.cliente_id}`}>{c.cliente}</Link> },
            { id: 'p', titulo: 'Pedidos', numerica: true, secundaria: true, celda: (c) => c.pedidos },
            { id: 'v', titulo: 'Vencido', numerica: true, secundaria: true, celda: (c) => formatearMoneda(c.vencido_cent) },
            { id: 's', titulo: 'Saldo', numerica: true, celda: (c) => formatearMoneda(c.saldo_cent) },
            { id: 't', titulo: 'Recordatorio', celda: (c) => <CopiarTexto chico etiqueta="Texto de cobro" fuente={{ tipo: 'cobro', clienteId: c.cliente_id }} /> },
          ]}
        />
        <p className="rtm-nota">El texto de cobro se copia para pegarlo tú: el agente nunca escribe a clientes.</p>
      </section>

      {d.saldos_a_favor.length > 0 && (
        <section className="rtm-seccion" aria-label="Saldos a favor de clientes">
          <h2>Saldos a favor de clientes</h2>
          <DataTable etiqueta="Saldos a favor" clave={(s) => s.cliente_id} filas={d.saldos_a_favor}
            columnas={[{ id: 'c', titulo: 'Cliente', celda: (s) => s.cliente }, { id: 'm', titulo: 'A su favor', numerica: true, celda: (s) => formatearMoneda(s.monto_cent) }]} />
        </section>
      )}

      {d.pagos_sin_identificar.length > 0 && (
        <section className="rtm-seccion" aria-label="Pagos sin identificar">
          <h2>Pagos sin identificar</h2>
          <DataTable etiqueta="Pagos sin identificar" clave={(p) => p.id} filas={d.pagos_sin_identificar}
            columnas={[
              { id: 'f', titulo: 'Folio', celda: (p) => <span className="rtm-mono">{p.folio}</span> }, { id: 'd', titulo: 'Fecha', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_neg) },
              { id: 'c', titulo: 'Cuenta', celda: (p) => p.cuenta }, { id: 'm', titulo: 'Monto', numerica: true, celda: (p) => formatearMoneda(p.monto_cent) },
              { id: 'a', titulo: 'Asignar a', celda: (p) => <IdentificarPago pagoId={p.id} clientes={ctx.clientes.map((c) => ({ id: c.id, nombre: c.nombre }))} /> },
            ]} />
        </section>
      )}

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Dinero de la sociedad en poder de un socio">
        <h2>Dinero de la sociedad en poder de un socio</h2>
        <DataTable
          etiqueta="Deuda de los socios con la sociedad"
          clave={(s) => s.socio}
          filas={d.socios}
          columnas={[
            { id: 's', titulo: 'Socio', celda: (s) => s.socio },
            { id: 'f', titulo: 'Fondos en su poder', numerica: true, celda: (s) => <CifraComprobada texto={formatearMoneda(s.fondos_cent)} cifra={`socio:fondos:${s.socio}`} comprobacion="cuadra" /> },
            { id: 'd', titulo: 'Faltantes asignados', numerica: true, secundaria: true, celda: (s) => <CifraComprobada texto={formatearMoneda(s.diferencia_cent)} cifra={`socio:diferencia:${s.socio}`} comprobacion="cuadra" /> },
            { id: 't', titulo: 'Debe a la sociedad', numerica: true, celda: (s) => <CifraComprobada texto={formatearMoneda(s.deuda_cent)} cifra={`socio:deuda:${s.socio}`} comprobacion="cuadra" /> },
            { id: 'w', titulo: 'Sin entregar', secundaria: true, celda: (s) => (s.dias_fondos === null ? <SinDato /> : <EstadoTexto tono={s.alerta_fondos ? 'atencion' : 'neutro'}>{s.dias_fondos} días</EstadoTexto>) },
            { id: 'a', titulo: 'Acción', celda: (s) => <EntregaSocio socio={s.socio} /> },
          ]}
        />
        <p className="rtm-nota">Baja cuando el socio entrega el dinero a la sociedad, lo paga a un proveedor (desde Proveedores) o lo compensa. Cada baja es un movimiento aparte.</p>
      </section>
    </>
  );
}
