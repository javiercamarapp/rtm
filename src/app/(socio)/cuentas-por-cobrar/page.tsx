import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import type { FilaCxc } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, BarraFiltros, CeldaPersona, Chip } from '@/ui/componentes/controles';
import { BarList, ListaHallazgos } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AntiguedadSaldos } from '@/ui/graficas';
import { CUBETA, ESTADO_CXC } from '../operacion/etiquetas';
import { CopiarTexto } from '../operacion/copiar-texto';
import { FormularioAccion } from '../operacion/formulario-accion';
import { Dos, Estado, Pie, fechaCorta, m, pct, pctTexto, suma } from '../_a3/util';
import { EntregaSocio, FormularioPago, IdentificarPago } from './formularios';

export const metadata: Metadata = { title: 'Cuentas por cobrar' };

type Vista = 'pedido' | 'cliente' | 'favor' | 'sin-id' | 'socios';
const VISTAS: Vista[] = ['pedido', 'cliente', 'favor', 'sin-id', 'socios'];
const CUBETAS = ['0_7', '8_14', '15_30', 'mas_30'] as const;
const CUBETA_CORTA: Record<string, string> = { '0_7': '0 a 7 d', '8_14': '8 a 14 d', '15_30': '15 a 30 d', mas_30: 'Más de 30 d' };

export default async function PaginaCxc({ searchParams }: { searchParams: Promise<{ cliente?: string; vencido?: string; desde?: string; hasta?: string; vista?: string }> }) {
  const { cliente = '', vencido = '', desde = '', hasta = '', vista: vistaQ = '' } = await searchParams;
  const vista: Vista = (VISTAS as string[]).includes(vistaQ) ? (vistaQ as Vista) : 'pedido';
  const lector = await operacionDeSocio();
  const [d, ctx] = await Promise.all([lector.cuentasPorCobrar(), lector.contextoPagos()]);
  const clientesOpc = ctx.clientes.map((c) => ({ id: c.id, nombre: c.nombre }));

  const filas = d.filas.filter((f) => (!cliente || String(f.cliente_id) === cliente) && (!vencido || f.estado === 'vencido') && (!desde || f.fecha_envio >= desde) && (!hasta || f.fecha_envio <= hasta));
  const enlace = (c: Record<string, string>) => {
    const q = new URLSearchParams({ ...(cliente ? { cliente } : {}), ...(vencido ? { vencido } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(vista !== 'pedido' ? { vista } : {}), ...c });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return q.toString() ? `/cuentas-por-cobrar?${q.toString()}` : '/cuentas-por-cobrar';
  };

  // ---- Cifras de la pagina (todas salen de la base; aqui solo se agrupan) ----
  const todas = d.filas;
  const porEstado = (e: FilaCxc['estado']) => suma(todas.filter((f) => f.estado === e).map((f) => f.saldo_cent));
  const cuenta = (e: FilaCxc['estado']) => todas.filter((f) => f.estado === e).length;
  const porVencer = porEstado('por_vencer');
  const alCorriente = porEstado('al_corriente');
  const sinPlazo = porEstado('sin_plazo');
  const pctVencido = pct(d.vencido_cent, d.total_cent);
  const recargoAplicado = suma(todas.map((f) => f.recargo_cent));
  const recargoSugerido = suma(todas.filter((f) => f.saldo_cent > 0n).map((f) => f.recargo_sugerido_cent));
  const ponderado = d.total_cent > 0n ? Number(suma(todas.map((f) => f.saldo_cent * BigInt(f.dias)))) / Number(d.total_cent) : null;
  const top3 = pct(suma(d.por_cliente.slice(0, 3).map((c) => c.saldo_cent)), d.total_cent);
  const fondosSocios = suma(d.socios.map((s) => s.fondos_cent));
  const deudaSocios = suma(d.socios.map((s) => s.deuda_cent));
  const favorTotal = suma(d.saldos_a_favor.map((s) => s.monto_cent));
  const sinIdTotal = suma(d.pagos_sin_identificar.map((p) => p.monto_cent));
  const principal = d.por_cliente[0];
  const proximos = todas.filter((f) => f.saldo_cent > 0n && f.vence && f.vence >= d.hoy).sort((x, y) => (x.vence! < y.vence! ? -1 : 1)).slice(0, 5);
  const vencidos = todas.filter((f) => f.estado === 'vencido');

  const partesAnt = CUBETAS.map((k) => ({ etiqueta: CUBETA[k]!, valor: Number(d.antiguedad_cent[k]), estado: 'real' as const }));
  const maxAnt = CUBETAS.reduce((a, k) => (d.antiguedad_cent[k] > 0n ? k : a), '0_7' as (typeof CUBETAS)[number]);

  // Antigüedad apilada por cliente: los 8 con mayor saldo, cada tramo con su cifra.
  const porCliente = new Map<number, { cliente: string; v: Record<(typeof CUBETAS)[number], bigint>; total: bigint }>();
  for (const f of todas.filter((x) => x.saldo_cent > 0n)) {
    const e = porCliente.get(f.cliente_id) ?? { cliente: f.cliente, v: { '0_7': 0n, '8_14': 0n, '15_30': 0n, mas_30: 0n }, total: 0n };
    e.v[f.cubeta] += f.saldo_cent;
    e.total += f.saldo_cent;
    porCliente.set(f.cliente_id, e);
  }
  // Los saldos de la apertura tambien envejecen (desde la fecha del adeudo): entran al mismo cuadro.
  for (const a of d.apertura.filter((x) => x.saldo_cent > 0n)) {
    const cubeta = a.dias <= 7 ? '0_7' : a.dias <= 14 ? '8_14' : a.dias <= 30 ? '15_30' : 'mas_30';
    const e = porCliente.get(a.cliente_id) ?? { cliente: a.cliente, v: { '0_7': 0n, '8_14': 0n, '15_30': 0n, mas_30: 0n }, total: 0n };
    e.v[cubeta] += a.saldo_cent;
    e.total += a.saldo_cent;
    porCliente.set(a.cliente_id, e);
  }
  const filasAnt = [...porCliente.entries()].sort((a, b) => (a[1].total > b[1].total ? -1 : 1)).slice(0, 8).map(([id, e]) => ({
    id: String(id), etiqueta: e.cliente, valores: CUBETAS.map((k) => Number(e.v[k])), textos: CUBETAS.map((k) => m(e.v[k])), total: m(e.total),
  }));

  let acum = 0n;
  const ranking = d.por_cliente.slice(0, 8).map((c) => {
    acum += c.saldo_cent;
    const venc = c.vencido_cent > 0n;
    return {
      id: String(c.cliente_id), etiqueta: c.cliente, href: `/clientes/${c.cliente_id}`, texto: m(c.saldo_cent), pct: pct(c.saldo_cent, d.total_cent),
      nota: `${venc ? `vencido ${m(c.vencido_cent)} · ` : ''}${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'} · acum. ${pctTexto(pct(acum, d.total_cent))}`,
      tono: venc ? ('malo' as const) : undefined,
    };
  });

  const estados = [
    { id: 'al', etiqueta: 'Al corriente', c: alCorriente, n: cuenta('al_corriente') },
    { id: 'pv', etiqueta: 'Por vencer', c: porVencer, n: cuenta('por_vencer') },
    { id: 've', etiqueta: 'Vencido', c: d.vencido_cent, n: cuenta('vencido'), tono: 'malo' as const },
    { id: 'sp', etiqueta: 'Sin plazo acordado', c: sinPlazo, n: cuenta('sin_plazo') },
  ].map((e) => ({ id: e.id, etiqueta: e.etiqueta, texto: m(e.c), pct: pct(e.c, d.total_cent), nota: `${e.n} ${e.n === 1 ? 'pedido' : 'pedidos'}`, tono: e.tono }));

  const maxFondos = suma(d.socios.map((s) => (s.deuda_cent > s.fondos_cent ? s.deuda_cent : s.fondos_cent)));
  const barrasSocios = d.socios.map((s) => ({
    id: s.socio, etiqueta: s.socio, href: `/socios/${s.socio}`, texto: m(s.deuda_cent), pct: pct(s.deuda_cent, maxFondos),
    nota: s.dias_fondos === null ? 'sin fondos pendientes' : `${s.dias_fondos} días sin entregar`, tono: s.alerta_fondos ? ('malo' as const) : undefined,
  }));

  const contadores: Record<Vista, number> = { pedido: filas.length, cliente: d.por_cliente.length, favor: d.saldos_a_favor.length, 'sin-id': d.pagos_sin_identificar.length, socios: d.socios.length };
  const pestanas = {
    etiquetaAria: 'Vistas de cuentas por cobrar',
    items: ([['pedido', 'Por pedido'], ['cliente', 'Por cliente'], ['favor', 'Saldos a favor'], ['sin-id', 'Pagos sin identificar'], ['socios', 'En poder de un socio']] as [Vista, string][]).map(([id, etiqueta]) => ({
      id, etiqueta, href: enlace({ vista: id === 'pedido' ? '' : id }), activa: vista === id, contador: contadores[id],
    })),
  };

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Cuentas por cobrar"
        titulo="Por cobrar"
        descripcion={d.total_cent === 0n ? 'Nada por cobrar: ningún pedido enviado tiene saldo.' : `${m(d.total_cent)} en ${d.por_cliente.length} ${d.por_cliente.length === 1 ? 'cliente' : 'clientes'} · ${m(d.vencido_cent)} vencido${pctVencido === null ? '' : ` (${pctTexto(pctVencido)})`}${principal?.proximo_vence ? ` · próximo vencimiento ${etiquetaFecha(principal.proximo_vence)}` : ''}`}
        acciones={<FormularioPago cuentas={ctx.cuentas.map((c) => c.nombre)} clientes={clientesOpc} />}
      />

      {d.pagos_sin_identificar.length > 0 && (
        <Aviso tono="atencion" titulo={`${d.pagos_sin_identificar.length} ${d.pagos_sin_identificar.length === 1 ? 'pago' : 'pagos'} sin identificar (${m(sinIdTotal)}).`}>
          No se aplican a ningún pedido hasta asignarlos a un cliente. <Link href={enlace({ vista: 'sin-id' })}>Asignarlos</Link>
        </Aviso>
      )}

      <KpiLinea
        etiquetaAria="Indicadores de cuentas por cobrar"
        celdas={[
          { id: 'total', etiqueta: 'Total por cobrar', valor: <CifraComprobada texto={m(d.total_cent)} cifra="cxc:total" comprobacion="cuadra" />, categoria: 2, partes: d.total_cent > 0n ? partesAnt : undefined, nota: d.total_cent > 0n ? `${todas.length} pedidos · tramo más viejo con saldo: ${CUBETA[maxAnt]}` : 'Sin saldos' },
          { id: 'vencido', etiqueta: 'Vencido', valor: m(d.vencido_cent), categoria: 4, progreso: pctVencido === null ? undefined : { pct: pctVencido }, nota: `${pctTexto(pctVencido)} del total · ${cuenta('vencido')} pedidos` },
          { id: 'por-vencer', etiqueta: 'Por vencer', valor: m(porVencer), categoria: 6, nota: `${cuenta('por_vencer')} pedidos · al corriente ${m(alCorriente)}` },
          { id: 'clientes', etiqueta: 'Clientes con saldo', valor: String(d.por_cliente.length), categoria: 1, nota: top3 === null ? 'Sin concentración' : `Los 3 mayores concentran ${pctTexto(top3)}` },
          { id: 'favor', etiqueta: 'Saldos a favor', valor: String(d.saldos_a_favor.length), categoria: 7, nota: d.saldos_a_favor.length > 0 ? `${m(favorTotal)} que no es cobranza` : 'Ningún cliente pagó de más' },
        ]}
      />
      <FilaRatios
        etiqueta="Razones de cobranza"
        items={[
          { etiqueta: 'Antigüedad media (ponderada por saldo)', valor: ponderado === null ? null : `${ponderado.toFixed(1)} días` },
          { etiqueta: 'Recargo aplicado', valor: m(recargoAplicado) },
          { etiqueta: `Recargo sugerido (${d.recargo_bp / 100} %)`, valor: m(recargoSugerido) },
          { etiqueta: 'Sin plazo acordado', valor: `${m(sinPlazo)} · ${cuenta('sin_plazo')}` },
          { etiqueta: 'Pagos sin identificar', valor: `${m(sinIdTotal)} · ${d.pagos_sin_identificar.length}` },
          { etiqueta: 'Fondos de la sociedad en poder de socios', valor: m(fondosSocios) },
        ]}
      />

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Antigüedad de saldos por cliente" descripcion="Cuánto debe cada cliente y desde hace cuántos días (desde el envío o la fecha del adeudo inicial)">
          {filasAnt.length > 0 ? (
            <AntiguedadSaldos titulo="Saldo por cliente y tramo de antigüedad" descripcion={`Saldo por cobrar de los ${filasAnt.length} clientes con mayor saldo, por tramo de antigüedad.`} procedencia="observado" pie={`Corte: ${etiquetaFecha(d.hoy)} · Fuente: pedidos enviados, saldos de apertura y pagos aplicados`} filas={filasAnt} />
          ) : (
            <p className="a3-grafica-vacia"><strong>Sin saldos que mostrar</strong>Cuando un pedido enviado o un saldo de apertura quede sin saldar, aparecerá aquí por cliente y por tramo.</p>
          )}
        </Tarjeta>
        <Tarjeta titulo="Concentración por cliente" descripcion="Parte del saldo total y acumulado de los 8 mayores">
          {ranking.length > 0 ? <BarList etiquetaAria="Saldo por cliente" items={ranking} /> : <p className="a3-grafica-vacia"><strong>Sin saldos</strong>Ningún cliente debe nada por ahora.</p>}
          <p className="a3-sub">Próximos vencimientos</p>
          <ListaHallazgos
            etiquetaAria="Próximos vencimientos"
            vacio="Ningún pedido con saldo tiene vencimiento próximo."
            items={proximos.map((f) => ({ id: String(f.pedido_id), tono: f.vence! <= sumarDias(d.hoy, 3) ? ('atencion' as const) : ('info' as const), palabra: f.vence! <= sumarDias(d.hoy, 3) ? 'Pronto' : 'Programado', titulo: `${f.cliente} · ${f.folio}`, detalle: `vence ${etiquetaFecha(f.vence!)}`, importe: m(f.saldo_cent), href: `/pedidos/${f.pedido_id}` }))}
          />
          <Pie>{vencidos.length > 0 ? `${vencidos.length} ${vencidos.length === 1 ? 'pedido ya vencido' : 'pedidos ya vencidos'} por ${m(d.vencido_cent)}.` : 'Nada vencido.'}</Pie>
        </Tarjeta>
      </Rejilla>

      <Rejilla dividir="4-4-4">
        <Tarjeta titulo="Por estado del plazo" descripcion="Saldo según el plazo acordado con el cliente">
          {d.total_cent > 0n ? <BarList etiquetaAria="Saldo por estado" items={estados} /> : <p className="a3-grafica-vacia"><strong>Sin saldos</strong>No hay pedidos con saldo.</p>}
        </Tarjeta>
        <Tarjeta titulo="Recargo por crédito" descripcion={`Sugerido al ${d.recargo_bp / 100} % contra aplicado`}>
          <BarList
            etiquetaAria="Recargo sugerido contra aplicado"
            items={[
              { id: 'sug', etiqueta: 'Sugerido', texto: m(recargoSugerido), pct: recargoSugerido > 0n ? 100 : null, nota: 'sobre saldos abiertos' },
              { id: 'apl', etiqueta: 'Aplicado', texto: m(recargoAplicado), pct: pct(recargoAplicado, recargoSugerido > recargoAplicado ? recargoSugerido : recargoAplicado), nota: 'ya cobrado en notas' },
            ]}
            mostrarPct={recargoSugerido > 0n || recargoAplicado > 0n}
          />
          <Pie>El recargo sale como corrección enlazada de la nota; la nota original no cambia.</Pie>
        </Tarjeta>
        <Tarjeta titulo="Dinero de la sociedad en poder de un socio" descripcion="Lo que cada socio debe entregar">
          {barrasSocios.length > 0 ? <BarList etiquetaAria="Deuda de cada socio con la sociedad" items={barrasSocios} /> : <p className="a3-grafica-vacia"><strong>Sin cuentas de socios</strong></p>}
          <Pie>Total en su poder {m(fondosSocios)} · debe a la sociedad {m(deudaSocios)}.</Pie>
        </Tarjeta>
      </Rejilla>

      {d.apertura.length > 0 && (
        <Tarjeta plana titulo="Saldos de apertura por cobrar" descripcion="Vienen de la apertura firmada por los dos socios. Un pago del cliente se aplica primero a esta deuda, la más antigua.">
          <DataTable
            etiqueta="Cuentas por cobrar cargadas en la apertura"
            densidad="densa" plana
            clave={(a) => a.partida_id}
            filas={d.apertura.filter((a) => !cliente || String(a.cliente_id) === cliente)}
            totales={{ etiqueta: 'Total', celdas: { s: formatearMoneda(d.apertura.filter((a) => !cliente || String(a.cliente_id) === cliente).reduce((x, a) => x + a.saldo_cent, 0n)) } }}
            columnas={[
              { id: 'c', titulo: 'Cliente', ancho: 'l', celda: (a) => <Link href={`/clientes/${a.cliente_id}`}>{a.cliente}</Link> },
              { id: 'f', titulo: 'Adeudo del', ancho: 'm', celda: (a) => etiquetaFecha(a.fecha_ref) },
              { id: 'o', titulo: 'Original', numerica: true, ancho: 'm', celda: (a) => formatearMoneda(a.original_cent) },
              { id: 'a', titulo: 'Abonos', numerica: true, ancho: 'm', celda: (a) => formatearMoneda(a.abonos_cent) },
              { id: 's', titulo: 'Saldo', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (a) => formatearMoneda(a.saldo_cent) },
              { id: 'd', titulo: 'Antigüedad', numerica: true, ancho: 's', celda: (a) => `${a.dias} d` },
            ]}
          />
        </Tarjeta>
      )}

      <Tarjeta plana titulo="Detalle">
        <div className="a3-barra"><BarraFiltros
          etiquetaAria="Filtros"
          extras={
            <form action="/cuentas-por-cobrar" method="get" className="a3-filtros-form" aria-label="Filtrar por cliente y fechas">
              <select className="rtm-campo" name="cliente" defaultValue={cliente} aria-label="Cliente">
                <option value="">Todos los clientes</option>
                {d.por_cliente.map((c) => <option key={c.cliente_id} value={c.cliente_id}>{c.cliente}</option>)}
              </select>
              <input className="rtm-campo" type="date" name="desde" defaultValue={desde} aria-label="Enviado desde" />
              <input className="rtm-campo" type="date" name="hasta" defaultValue={hasta} aria-label="Enviado hasta" />
              {vencido && <input type="hidden" name="vencido" value="1" />}
              {vista !== 'pedido' && <input type="hidden" name="vista" value={vista} />}
              <button type="submit" className="rtm-boton">Filtrar</button>
            </form>
          }
        >
          <Chip href={enlace({ cliente: '', vencido: '', desde: '', hasta: '' })} activo={!cliente && !vencido && !desde && !hasta}>Todos</Chip>
          <Chip href={enlace({ vencido: vencido ? '' : '1' })} activo={vencido === '1'} tono="malo">Solo vencido</Chip>
        </BarraFiltros></div>

        {vista === 'pedido' && (
          <DataTable
            etiqueta="Cuentas por cobrar por pedido"
            densidad="densa"
            plana
            pegajosa
            primeraFija
            pestanas={pestanas}
            interactiva={{ busqueda: 'Buscar cliente o pedido', porPagina: 50, exportar: 'cuentas-por-cobrar-por-pedido' }}
            clave={(f) => f.pedido_id}
            filas={filas}
            totales={{ etiqueta: `Total (${filas.length})`, celdas: { o: m(suma(filas.map((f) => f.original_cent))), rc: m(suma(filas.map((f) => f.recargo_cent))), a: m(suma(filas.map((f) => f.abonos_cent))), s: m(suma(filas.map((f) => f.saldo_cent))) } }}
            vacio={{ titulo: 'Nada por cobrar', texto: 'Cuando se envíe un pedido y no esté saldado, aparecerá aquí con su plazo, vencimiento y antigüedad.', accion: <Link className="rtm-boton" href="/pedidos">Ver pedidos</Link> }}
            columnas={[
              { id: 'c', titulo: 'Cliente · pedido', prioridadMovil: 'titulo', ancho: 'xl', celda: (f) => <Dos a={<Link href={`/clientes/${f.cliente_id}`}>{f.cliente}</Link>} b={<Link className="rtm-mono" href={`/pedidos/${f.pedido_id}`}>{f.folio}</Link>} /> },
              { id: 'e', titulo: 'Enviado · vence', prioridadMovil: 'normal', ancho: 'm', celda: (f) => <Dos a={fechaCorta(f.fecha_envio)} b={f.vence ? `vence ${fechaCorta(f.vence)}` : 'sin vencimiento'} /> },
              { id: 'p', titulo: 'Plazo', prioridadMovil: 'oculta', ancho: 'xs', secundaria: true, celda: (f) => (f.plazo_dias === null ? <SinDato /> : `${f.plazo_dias} d`) },
              { id: 'o', titulo: 'Original', prioridadMovil: 'normal', numerica: true, ancho: 'm', secundaria: true, celda: (f) => m(f.original_cent) },
              { id: 'rc', titulo: 'Recargo', prioridadMovil: 'oculta', numerica: true, ancho: 'm', secundaria: true, celda: (f) => (f.recargo_cent > 0n ? <Dos a={m(f.recargo_cent)} b={`sug. ${m(f.recargo_sugerido_cent)}`} /> : f.saldo_cent > 0n && f.recargo_sugerido_cent > 0n ? <Dos a={<SinDato />} b={`sug. ${m(f.recargo_sugerido_cent)}`} /> : <SinDato />) },
              { id: 'a', titulo: 'Abonos', prioridadMovil: 'oculta', numerica: true, ancho: 'm', secundaria: true, celda: (f) => m(f.abonos_cent) },
              { id: 's', titulo: 'Saldo', prioridadMovil: 'principal', numerica: true, ancho: 'm', celda: (f) => <CifraComprobada texto={m(f.saldo_cent)} cifra={`pedido:saldo:${f.pedido_id}`} comprobacion="cuadra" /> },
              { id: 'b', titulo: 'Antigüedad', prioridadMovil: 'normal', ancho: 's', secundaria: true, celda: (f) => <Dos a={CUBETA_CORTA[f.cubeta]} b={`${f.dias} d`} /> },
              { id: 'x', titulo: 'Estado', prioridadMovil: 'normal', ancho: 'm', celda: (f) => <Dos a={<Estado tono={ESTADO_CXC[f.estado].tono}>{ESTADO_CXC[f.estado].texto}</Estado>} b={f.dias_atraso === null ? undefined : `${f.dias_atraso} d de atraso`} /> },
              { id: 'z', titulo: 'Acciones', prioridadMovil: 'normal', ancho: 'l', celda: (f) => (
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
        )}

        {vista === 'cliente' && (
          <DataTable
            etiqueta="Saldo por cliente"
            densidad="densa"
            plana
            pegajosa
            primeraFija
            pestanas={pestanas}
            interactiva={{ busqueda: 'Buscar cliente', porPagina: 50, exportar: 'cuentas-por-cobrar-por-cliente' }}
            clave={(c) => c.cliente_id}
            filas={d.por_cliente}
            totales={{ etiqueta: `Total (${d.por_cliente.length})`, celdas: { p: String(suma(d.por_cliente.map((c) => BigInt(c.pedidos)))), v: m(d.vencido_cent), s: m(d.total_cent) } }}
            vacio={{ titulo: 'Sin saldos', texto: 'Ningún cliente debe nada por ahora.' }}
            columnas={[
              { id: 'c', titulo: 'Cliente', prioridadMovil: 'titulo', ancho: 'xl', celda: (c) => <CeldaPersona nombre={c.cliente} href={`/clientes/${c.cliente_id}`} subtitulo={c.proximo_vence ? `vence ${etiquetaFecha(c.proximo_vence)}` : 'sin vencimiento próximo'} /> },
              { id: 'p', titulo: 'Pedidos', prioridadMovil: 'normal', numerica: true, ancho: 'xs', celda: (c) => c.pedidos },
              { id: 'dm', titulo: 'Más antiguo', prioridadMovil: 'normal', numerica: true, ancho: 's', secundaria: true, celda: (c) => `${c.dias_max} d` },
              { id: 'v', titulo: 'Vencido', prioridadMovil: 'normal', numerica: true, ancho: 'm', celda: (c) => (c.vencido_cent > 0n ? m(c.vencido_cent) : '—') },
              { id: 'pc', titulo: '% del total', prioridadMovil: 'oculta', numerica: true, ancho: 's', secundaria: true, celda: (c) => pctTexto(pct(c.saldo_cent, d.total_cent)) },
              { id: 's', titulo: 'Saldo', prioridadMovil: 'principal', numerica: true, ancho: 'm', celda: (c) => m(c.saldo_cent) },
              { id: 't', titulo: 'Recordatorio', prioridadMovil: 'normal', ancho: 'l', celda: (c) => <CopiarTexto chico etiqueta="Texto de cobro" fuente={{ tipo: 'cobro', clienteId: c.cliente_id }} /> },
            ]}
          />
        )}

        {vista === 'favor' && (
          <DataTable
            etiqueta="Saldos a favor"
            densidad="densa"
            plana
            pestanas={pestanas}
            clave={(s) => s.cliente_id}
            filas={d.saldos_a_favor}
            totales={{ etiqueta: 'Total', celdas: { m: m(favorTotal) } }}
            vacio={{ titulo: 'Sin saldos a favor', texto: 'Ningún cliente ha pagado más de lo que debe.' }}
            columnas={[{ id: 'c', titulo: 'Cliente', ancho: 'xl', celda: (s) => <CeldaPersona nombre={s.cliente} href={`/clientes/${s.cliente_id}`} /> }, { id: 'm', titulo: 'A su favor', numerica: true, ancho: 'm', celda: (s) => m(s.monto_cent) }]}
          />
        )}

        {vista === 'sin-id' && (
          <DataTable
            etiqueta="Pagos sin identificar"
            densidad="densa"
            plana
            pestanas={pestanas}
            clave={(p) => p.id}
            filas={d.pagos_sin_identificar}
            totales={{ etiqueta: 'Total', celdas: { m: m(sinIdTotal) } }}
            vacio={{ titulo: 'Todo identificado', texto: 'Todos los pagos están asignados a un cliente.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 's', celda: (p) => <span className="rtm-mono">{p.folio}</span> },
              { id: 'd', titulo: 'Fecha', ancho: 's', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_neg) },
              { id: 'c', titulo: 'Cuenta', ancho: 'm', celda: (p) => p.cuenta },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (p) => m(p.monto_cent) },
              { id: 'a', titulo: 'Asignar a', ancho: 'xl', celda: (p) => <IdentificarPago pagoId={p.id} clientes={clientesOpc} /> },
            ]}
          />
        )}

        {vista === 'socios' && (
          <>
            <DataTable
              etiqueta="Deuda de los socios con la sociedad"
              densidad="densa"
              plana
              pestanas={pestanas}
              clave={(s) => s.socio}
              filas={d.socios}
              totales={{ etiqueta: 'Total', celdas: { f: m(fondosSocios), d: m(suma(d.socios.map((s) => s.diferencia_cent))), t: m(deudaSocios) } }}
              columnas={[
                { id: 's', titulo: 'Socio', ancho: 'l', celda: (s) => <CeldaPersona nombre={s.socio} href={`/socios/${s.socio}`} /> },
                { id: 'f', titulo: 'Fondos en su poder', numerica: true, ancho: 'm', celda: (s) => <CifraComprobada texto={m(s.fondos_cent)} cifra={`socio:fondos:${s.socio}`} comprobacion="cuadra" /> },
                { id: 'd', titulo: 'Faltantes asignados', numerica: true, ancho: 'm', secundaria: true, celda: (s) => <CifraComprobada texto={m(s.diferencia_cent)} cifra={`socio:diferencia:${s.socio}`} comprobacion="cuadra" /> },
                { id: 't', titulo: 'Debe a la sociedad', numerica: true, ancho: 'm', celda: (s) => <CifraComprobada texto={m(s.deuda_cent)} cifra={`socio:deuda:${s.socio}`} comprobacion="cuadra" /> },
                { id: 'w', titulo: 'Sin entregar', ancho: 's', secundaria: true, celda: (s) => (s.dias_fondos === null ? <SinDato /> : <Estado tono={s.alerta_fondos ? 'atencion' : 'neutro'}>{s.dias_fondos} días</Estado>) },
                { id: 'a', titulo: 'Acción', ancho: 'l', celda: (s) => <EntregaSocio socio={s.socio} /> },
              ]}
            />
            <div className="a3-pie-tarjeta"><Pie>Baja cuando el socio entrega el dinero a la sociedad, lo paga a un proveedor (desde Proveedores) o lo compensa. Cada baja es un movimiento aparte. Un pago que cae en la cuenta de un socio sí liquida al cliente, pero el dinero es de la sociedad.</Pie></div>
          </>
        )}
        {vista === 'cliente' && <div className="a3-pie-tarjeta"><Pie>El texto de cobro se copia para pegarlo tú: el agente nunca escribe a clientes.</Pie></div>}
      </Tarjeta>
    </Pagina>
  );
}
