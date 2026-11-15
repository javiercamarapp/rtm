import { presentarPorPagar } from '@/dominio/operacion/por_pagar';
import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSocio } from '@/composicion/acceso';
import { inventarioDeSocio, notificacionesDeSocio } from '@/composicion/inventario';
import { operacionDeSocio } from '@/composicion/operacion';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas, marcaMayus, nombreVape } from '@/dominio/formato';
import { URGENCIA_COBERTURA, textoDias } from '@/dominio/inventario/cobertura';
import { destinoAviso } from '@/dominio/notificaciones/tipos';
import { aNumero, contarPor, porcentaje, sumarPorSemana, ultimasSemanas } from '@/dominio/tablero/agregados';
import { Aviso, ChipEstado, Segmentado } from '@/ui/componentes/controles';
import { BarList, ListaHallazgos } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { CoberturaDias, ColumnasPeriodo } from '@/ui/graficas';
import { chipsPulso } from '@/ui/shell/pulso';
import '@/ui/estilos/paginas-a1.css';
import { CUBETA, ESTADO_PEDIDO, SEVERIDAD } from './operacion/etiquetas';
import { centTexto, columnasSemana, deltaSemanal, NUMERO_SEMANAS, semanasDe, sparkSemanal } from './_a1/comun';
import { etiquetaHoy } from './contexto';
import { valuacionDeSocios } from '@/composicion/valuacion-socios';
import { tarjetaValuacion } from '@/dominio/socios/valuacion';
import { Contador } from '@/ui/graficas';
import '@/ui/estilos/socios-valuacion.css';
import { BannerIgualar } from '@/ui/componentes/banner-igualar';

export const metadata: Metadata = { title: 'Inicio' };

const TONO_HALLAZGO = { C: 'malo', I: 'atencion', F: 'info' } as const;

export default async function Inicio({ searchParams }: { searchParams: Promise<{ semanas?: string }> }) {
  const sp = await searchParams;
  const { perfil } = await exigirSocio();
  const n = semanasDe(sp.semanas);
  const op = await operacionDeSocio();
  const lector = await notificacionesDeSocio();
  const [pulso, turno, inv, cxc, pedidos, pendientesMenudeo, valuacion] = await Promise.all([
    lector.pulso().catch(() => null),
    lector.tuTurno().catch(() => ({ items: [] })),
    (await inventarioDeSocio()).completo().catch(() => null),
    op.cuentasPorCobrar().catch(() => null),
    op.pedidos().catch(() => null),
    dropshippingDeSocio().then(async (d) => ({ pend: await d.menudeoPendientes(), socio: await d.socioMenudeo() })).catch(() => null),
    valuacionDeSocios().catch(() => null),
  ]);
  const hoy = fechaNeg(new Date());
  const semanas = ultimasSemanas(hoy, n);
  const enviados = (pedidos ?? []).filter((p) => p.estado === 'enviado');
  const ventas = sumarPorSemana(enviados, semanas, (p) => p.fecha_neg, (p) => aNumero(p.cobrado_cent));
  const utilidad = sumarPorSemana(enviados, semanas, (p) => p.fecha_neg, (p) => (p.utilidad_cent === null ? 0 : aNumero(p.utilidad_cent)));
  const piezas = sumarPorSemana(enviados, semanas, (p) => p.fecha_neg, (p) => p.piezas_surtidas);
  const hayPedidos = pedidos !== null && pedidos.length > 0;
  const iSemana = semanas.length - 1;
  const porEnviar = (pedidos ?? []).filter((p) => p.estado === 'confirmado');
  const borradores = (pedidos ?? []).filter((p) => p.estado === 'borrador');
  const conAvisos = (pedidos ?? []).filter((p) => p.avisos > 0 && p.estado !== 'anulado' && p.estado !== 'cancelado');
  const utilidadProvisional = enviados.some((p) => p.utilidad_provisional);

  const indicadores = chipsPulso(pulso);
  const categoriaPulso = { isaac: 5, cobrar: 2, socios: 7, bodega: 8 } as const;
  const notaPulso = {
    isaac: 'Deuda de la empresa con el proveedor; los pedidos del socio de menudeo van aparte',
    cobrar: cxc ? `${cxc.por_cliente.length} clientes con saldo` : undefined,
    socios: 'Posición neta de cada socio',
    bodega: pulso?.en_bodega ? `${formatearPiezas(pulso.en_bodega.piezas)} · ${inv ? `${inv.totales.modelos_con_existencia} modelos` : 'a costo promedio'}` : undefined,
  } as const;
  const tv = valuacion && valuacion.yo ? tarjetaValuacion(valuacion.cuenta, valuacion.yo, formatearMoneda) : null;
  const pulsoBase = indicadores.map((c) => ({
    id: c.id, etiqueta: c.etiqueta, valor: c.id === 'bodega' ? (pulso?.en_bodega ? formatearMoneda(pulso.en_bodega.valor_cent) : null) : c.texto, href: c.href, ayuda: c.ayuda, testid: `inicio-${c.id}`, categoria: categoriaPulso[c.id as keyof typeof categoriaPulso], nota: notaPulso[c.id as keyof typeof notaPulso],
    partes: c.id === 'cobrar' && cxc && cxc.total_cent > 0n ? (['0_7', '8_14', '15_30', 'mas_30'] as const).map((k) => ({ etiqueta: CUBETA[k]!, valor: aNumero(cxc.antiguedad_cent[k]) })) : undefined,
  }));
  // TU VALUACION reemplaza 'Entre socios': la misma funcion de la base que /socios y el Balance (api.cuenta_socios_valuacion); sin sesion de socio con nombre se conserva el indicador anterior.
  const pulsoCeldas = pulsoBase.map((c) => c.id !== 'socios' || !tv ? c : {
    ...c, etiqueta: tv.titulo, href: '/socios', testid: 'inicio-valuacion', ayuda: 'Capital aportado más utilidades acumuladas, menos lo retirado y los fondos de la sociedad en tu poder. Compara contra el otro socio.', partes: undefined,
    valor: <span data-testid="inicio-valuacion-cifra"><Contador valor={Number(tv.valorCent)} tipo="moneda" /></span>,
    nota: <span className="sv-inicio" data-testid="inicio-valuacion-nota"><span className="sv-linea" data-testid="inicio-valuacion-comparacion">{tv.comparacion}</span><span className="sv-accion" data-testid="inicio-valuacion-faltan">{tv.faltan}</span>{tv.indicaciones.length > 0 ? tv.indicaciones.map((t, i) => <span key={i} className="sv-accion" data-testid="inicio-valuacion-accion">{t}</span>) : tv.accion && <span className="sv-accion" data-testid="inicio-valuacion-accion">{tv.accion}</span>}</span>,
  });

  // POR PAGAR: Isaac + Karen + renta de Omar, cada renglon aparte y el total con todos (la renta ya esta en el libro; aqui solo se presenta).
  const pp = presentarPorPagar(pulso?.por_pagar);
  const celdaPorPagar = { id: 'porpagar', etiqueta: 'Por pagar', valor: pp.texto, href: '/proveedores', ayuda: 'Lo que la empresa debe: Isaac, Karen y la renta de bodega de Omar, cada uno por separado. El total los suma.', testid: 'inicio-porpagar', categoria: 5 as const, nota: pp.detalle ?? undefined, partes: pp.partes.length > 0 ? pp.partes : undefined };
  const pulsoConPorPagar = pulsoCeldas.flatMap((c) => (c.id === 'isaac' ? [c, celdaPorPagar] : [c]));

  const reponer = (inv?.modelos ?? []).filter((m) => m.estado !== null && ['urge', 'brevedad', 'siguiente'].includes(m.estado)).sort((a, b) => URGENCIA_COBERTURA[a.estado!] - URGENCIA_COBERTURA[b.estado!] || (a.cobertura_dias ?? 0) - (b.cobertura_dias ?? 0)).slice(0, 6);
  const conCobertura = (inv?.modelos ?? []).filter((m) => m.cobertura_dias !== null);
  const coberturaMedia = conCobertura.length ? conCobertura.reduce((a, m) => a + (m.cobertura_dias ?? 0), 0) / conCobertura.length : null;
  const porMarca = new Map<string, bigint>();
  for (const m of inv?.modelos ?? []) if (m.valor_cent !== null) porMarca.set(m.marca, (porMarca.get(m.marca) ?? 0n) + m.valor_cent);
  const marcas = [...porMarca.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] < b[1] ? 1 : -1)).slice(0, 5);
  const totalMarcas = marcas.reduce((a, [, v]) => a + v, 0n);

  const sumaCob = new Map<string, { n: number; d: number }>();
  for (const x of conCobertura) { const a = sumaCob.get(x.marca) ?? { n: 0, d: 0 }; sumaCob.set(x.marca, { n: a.n + 1, d: a.d + (x.cobertura_dias ?? 0) }); }
  const coberturaMarca = [...sumaCob.entries()].map(([marca, v]) => [marca, v.d / v.n] as const).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const vencidoPct = cxc ? porcentaje(aNumero(cxc.vencido_cent), aNumero(cxc.total_cent)) : null;
  const asuntos = turno.items.length;
  const subtitulo = hayPedidos
    ? `Ventas de la semana ${centTexto(ventas[iSemana] ?? 0)} · por cobrar ${cxc ? formatearMoneda(cxc.total_cent) : 'sin dato'} · ${porEnviar.length} ${porEnviar.length === 1 ? 'pedido' : 'pedidos'} por enviar.`
    : 'Todavía no hay pedidos: los indicadores dicen “Sin dato” en vez de inventar ceros.';

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={`Inicio · ${etiquetaHoy()}`}
        titulo={asuntos === 0 ? 'Nada que atender' : `Te tocan ${asuntos} ${asuntos === 1 ? 'asunto' : 'asuntos'}`}
        descripcion={subtitulo}
        acciones={
          <>
            <Segmentado etiquetaAria="Periodo de las gráficas" tamano="chico" opciones={NUMERO_SEMANAS.map((s) => ({ valor: String(s), etiqueta: `${s} sem`, href: s === 8 ? '/' : `/?semanas=${s}`, activa: s === n }))} />
            <Link className="rtm-boton rtm-boton-primario" href="/pedidos/nuevo">Nuevo pedido</Link>
          </>
        }
      />
      {valuacion && <BannerIgualar banner={valuacion.cuenta.banner} yo={valuacion.yo} />}
      <KpiLinea etiquetaAria="Indicadores del pulso" celdas={pulsoConPorPagar} />
      <KpiLinea
        etiquetaAria="Indicadores de la operación"
        celdas={[
          {
            id: 'ventas', etiqueta: 'Ventas de la semana (facturado)', valor: hayPedidos ? centTexto(ventas[iSemana] ?? 0) : null, categoria: 1, href: '/pedidos',
            delta: deltaSemanal(semanas, ventas, true), spark: sparkSemanal(semanas, ventas, centTexto), nota: `${formatearPiezas(piezas[iSemana] ?? 0)} surtidas · mercancía, envío y recargos de pedidos enviados`,
          },
          {
            id: 'utilidad', etiqueta: utilidadProvisional ? 'Utilidad por pedido de la semana (provisional)' : 'Utilidad por pedido de la semana', valor: hayPedidos ? centTexto(utilidad[iSemana] ?? 0) : null, categoria: 3, href: '/contabilidad/estado-de-resultados',
            delta: deltaSemanal(semanas, utilidad, true), nota: ventas[iSemana] ? `Margen ${(((utilidad[iSemana] ?? 0) / (ventas[iSemana] ?? 1)) * 100).toFixed(1)} % sobre lo facturado · sin merma; la utilidad neta del periodo está en Estado de resultados` : 'Sin ventas enviadas todavía',
          },
          { id: 'porenviar', etiqueta: 'Pedidos por enviar', valor: pedidos === null ? null : String(porEnviar.length), categoria: 6, href: '/pedidos?estado=confirmado', nota: `${borradores.length} ${borradores.length === 1 ? 'borrador' : 'borradores'} · ${conAvisos.length} con avisos` },
          {
            id: 'vencido', etiqueta: 'Vencido por cobrar', valor: cxc ? formatearMoneda(cxc.vencido_cent) : null, categoria: 4, href: '/cuentas-por-cobrar',
            progreso: vencidoPct === null ? undefined : { pct: vencidoPct }, nota: vencidoPct === null ? undefined : `${vencidoPct.toFixed(1)} % del saldo por cobrar`,
          },
        ]}
      />
      <FilaRatios
        etiqueta="Razones del negocio"
        items={[
          { etiqueta: 'Cobertura media', valor: coberturaMedia === null ? null : textoDias(coberturaMedia) },
          { etiqueta: 'Modelos por reponer', valor: inv ? String((inv.modelos ?? []).filter((m) => m.estado === 'urge' || m.estado === 'brevedad').length) : null },
          { etiqueta: 'Piezas apartadas', valor: inv ? formatearPiezas(inv.totales.reservado) : null },
          { etiqueta: 'Clientes con saldo', valor: cxc ? String(cxc.por_cliente.length) : null },
          { etiqueta: 'Saldos a favor', valor: cxc ? String(cxc.saldos_a_favor.length) : null },
          { etiqueta: 'Pagos sin identificar', valor: cxc ? String(cxc.pagos_sin_identificar.length) : null },
        ]}
      />
      {cxc && cxc.pagos_sin_identificar.length > 0 && (
        <Aviso tono="atencion" titulo="Hay pagos sin identificar." acciones={<Link className="rtm-boton rtm-boton-chico" href="/cuentas-por-cobrar">Asignarlos</Link>}>{cxc.pagos_sin_identificar.length} {cxc.pagos_sin_identificar.length === 1 ? 'pago espera' : 'pagos esperan'} un cliente antes de aplicarse.</Aviso>
      )}

      {pendientesMenudeo && (() => {
        const x = pendientesMenudeo.pend.find((q) => q.socio === pendientesMenudeo.socio);
        if (!x) return null;
        const propio = perfil.socio_nombre === pendientesMenudeo.socio;
        const enlace = <Link href="/menudeo">{propio ? 'Ver mis pedidos menudeo' : `Ver pedidos menudeo de ${x.socio}`}</Link>;
        return (
          <Tarjeta titulo={propio ? 'Pedidos pendientes de pago' : `Pedidos menudeo de ${x.socio} pendientes`}
            descripcion={propio ? 'Tus pedidos a costo (menudeo en Playa del Carmen). No restan a tu aportación neta; los fondos cobrados en tu cuenta sí.' : `Solo lectura: supervisas el pago de los pedidos de ${x.socio}. No restan a su aportación neta.`}>
            <div className="rtm-a1-cuerpo" data-testid={propio ? 'inicio-menudeo-propio' : 'inicio-menudeo-otro'}>
              <ul className="rtm-lineas-form">
                <li data-testid={`inicio-pedidos-${x.socio}`}>{x.pedidos > 0 ? <>Pendiente de pago: <strong>{formatearMoneda(x.pendiente_cent)}</strong> en {x.pedidos} {x.pedidos === 1 ? 'pedido' : 'pedidos'} · {enlace}</> : <>Sin pedidos pendientes · {enlace}</>}</li>
                <li data-testid={`inicio-vencidos-${x.socio}`}>{x.vencidos > 0 ? <><strong>{x.vencidos} {x.vencidos === 1 ? 'vencido' : 'vencidos'}</strong> por {formatearMoneda(x.vencido_cent)}: pasó la fecha comprometida</> : 'Ninguno vencido'}{x.sin_fecha > 0 ? ` · ${x.sin_fecha} sin fecha comprometida` : ''}</li>
                {x.pedidos_reportados > 0 && <li data-testid={`inicio-reportado-${x.socio}`}>Pago reportado por confirmar: {formatearMoneda(x.reportado_cent)} en {x.pedidos_reportados} {x.pedidos_reportados === 1 ? 'pedido' : 'pedidos'}</li>}
                <li data-testid={`inicio-fondos-${x.socio}`}>{x.fondos_pendiente_cent > 0n ? <>Fondos de la sociedad cobrados en su cuenta, pendientes de entregar: <strong>{formatearMoneda(x.fondos_pendiente_cent)}</strong> en {x.fondos_cobros} {x.fondos_cobros === 1 ? 'cobro' : 'cobros'}</> : 'Sin fondos pendientes de entregar'}</li>
              </ul>
            </div>
          </Tarjeta>
        );
      })()}

      <Rejilla dividir="8-4" alinear="inicio">
        <Tarjeta titulo="Ventas por semana" descripcion={`Lo facturado en los pedidos enviados (cobrado + por cobrar), últimas ${n} semanas; la semana en curso va con trama`}>
          {hayPedidos ? (
            <ColumnasPeriodo
              titulo="Ventas facturadas por semana" descripcion={`Ventas de los pedidos enviados en las últimas ${n} semanas; la última es parcial.`} unidad="Ventas (pesos)" procedencia="observado"
              pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: pedidos enviados`} datos={columnasSemana(semanas, ventas, centTexto, 'ventas', 100)}
            />
          ) : <p className="rtm-a1-estado-vacio">Sin pedidos todavía: aquí aparecerán las ventas por semana.</p>}
          {hayPedidos && (
            <dl className="rtm-a1-sub">
              <div><dt>Semana más alta</dt><dd>{centTexto(Math.max(0, ...ventas))}</dd></div>
              <div><dt>Promedio por semana</dt><dd>{centTexto(ventas.reduce((a, v) => a + v, 0) / Math.max(1, ventas.length))}</dd></div>
              <div><dt>Semanas con venta</dt><dd>{ventas.filter((v) => v > 0).length} de {ventas.length}</dd></div>
            </dl>
          )}
        </Tarjeta>
        <Tarjeta titulo="Antigüedad de lo por cobrar" descripcion={cxc ? `Total ${formatearMoneda(cxc.total_cent)} · vencido ${formatearMoneda(cxc.vencido_cent)}` : undefined} acciones={<Link href="/cuentas-por-cobrar">Ver cuentas</Link>}>
          {cxc && cxc.total_cent > 0n ? (
            <BarList
              etiquetaAria="Saldo por antigüedad"
              items={(['0_7', '8_14', '15_30', 'mas_30'] as const).map((k) => ({ id: k, etiqueta: CUBETA[k]!, texto: formatearMoneda(cxc.antiguedad_cent[k]), pct: porcentaje(aNumero(cxc.antiguedad_cent[k]), aNumero(cxc.total_cent)), tono: k === 'mas_30' ? ('malo' as const) : k === '15_30' ? ('atencion' as const) : undefined }))}
            />
          ) : <p className="rtm-a1-estado-vacio">{cxc ? 'Nada por cobrar: no hay saldos abiertos.' : 'Sin dato de cobranza.'}</p>}
        </Tarjeta>
      </Rejilla>

      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo="Por reponer primero" descripcion="Cobertura en días contra el tiempo de entrega" acciones={<Link href="/inventario">Inventario</Link>}>
          {reponer.length >= 1 && inv ? (
            <CoberturaDias
              titulo="¿Qué modelos se acaban primero?" descripcion={`Cobertura en días de ${reponer.length} modelos contra el objetivo.`} procedencia="estimado" pie={`Corte: ${etiquetaFechaHora(inv.corte)}`}
              filas={reponer.map((m) => ({ id: String(m.modelo_id), etiqueta: nombreVape(m.modelo), dias: m.cobertura_dias, textoDias: textoDias(m.cobertura_dias), estado: m.estado ?? 'sin_historia' }))}
              umbrales={[{ id: 'obj', etiqueta: 'Objetivo', dias: inv.parametros.objetivo_dias }]}
            />
          ) : <p className="rtm-a1-estado-vacio">{inv ? 'Ningún modelo pide reposición ahora.' : 'Sin dato de inventario.'}</p>}
          {coberturaMarca.length > 0 && (
            <div className="rtm-a1-cuerpo">
              <p className="rtm-a1-subtitulo">Cobertura media por marca (días)</p>
              <BarList etiquetaAria="Cobertura media por marca" items={coberturaMarca.map(([marca, dias]) => ({ id: marca, etiqueta: marca, texto: textoDias(dias), pct: porcentaje(dias, coberturaMarca[0]![1]) }))} />
            </div>
          )}
        </Tarjeta>
        <div className="rtm-a1-pila rtm-pila-llena">
        <Tarjeta titulo="Mayores saldos" descripcion="Cliente, saldo y lo vencido" acciones={<Link href="/clientes">Clientes</Link>}>
          {cxc && cxc.por_cliente.length > 0 ? (
            <BarList
              etiquetaAria="Clientes con mayor saldo"
              items={[...cxc.por_cliente].sort((a, b) => (a.saldo_cent === b.saldo_cent ? 0 : a.saldo_cent < b.saldo_cent ? 1 : -1)).slice(0, 6).map((c) => ({
                id: String(c.cliente_id), etiqueta: c.cliente, href: `/clientes/${c.cliente_id}`, texto: formatearMoneda(c.saldo_cent), pct: porcentaje(aNumero(c.saldo_cent), aNumero(cxc.total_cent)),
                nota: c.vencido_cent > 0n ? `vencido ${formatearMoneda(c.vencido_cent)} · ${c.dias_max} d` : `${c.dias_max} d`, tono: c.vencido_cent > 0n ? ('malo' as const) : undefined,
              }))}
            />
          ) : <p className="rtm-a1-estado-vacio">{cxc ? 'Ningún cliente con saldo.' : 'Sin dato de cobranza.'}</p>}
        </Tarjeta>
        <Tarjeta titulo="Inventario por marca" descripcion={inv ? `${formatearPiezas(inv.totales.piezas)} · ${formatearMoneda(inv.totales.valor_cent)} a costo promedio` : undefined}>
          {marcas.length > 0 ? (
            <BarList etiquetaAria="Valor del inventario por marca" items={marcas.map(([m, v]) => ({ id: m, etiqueta: marcaMayus(m), texto: formatearMoneda(v), pct: porcentaje(aNumero(v), aNumero(totalMarcas)) }))} />
          ) : <p className="rtm-a1-estado-vacio">Sin existencia registrada.</p>}
        </Tarjeta>
        </div>
      </Rejilla>

      <Tarjeta titulo="Tu turno" descripcion="Lo abierto que pide una acción tuya" acciones={<Link href="/avisos">Ver todo</Link>}>
          <ListaHallazgos
            etiquetaAria="Tu turno" vacio="Nada que atender"
            items={turno.items.slice(0, 8).map((i) => {
              const d = destinoAviso(i.entidad_tipo, i.entidad_id);
              return {
                id: `${i.clase}-${i.id}`, tono: TONO_HALLAZGO[i.severidad], palabra: SEVERIDAD[i.severidad]!.texto, titulo: d ? <Link href={d}>{i.titulo}</Link> : i.titulo,
                detalle: `${i.botones.length ? i.botones.join(' / ') : 'Abrir'} · desde ${etiquetaFechaHora(i.creado_at)}`,
              };
            })}
          />
      </Tarjeta>

      <Tarjeta plana titulo="Pedidos recientes" descripcion={pedidos ? `${pedidos.length} en el libro · ${contarPor(pedidos, (p) => p.estado).map((c) => `${c.n} ${ESTADO_PEDIDO[c.clave as keyof typeof ESTADO_PEDIDO].texto.toLowerCase()}`).join(' · ')}` : undefined} acciones={<Link href="/pedidos">Ver todos</Link>}>
        <DataTable
          etiqueta="Pedidos recientes" densidad="densa" plana primeraFija clave={(p) => p.id}
          filas={[...(pedidos ?? [])].sort((a, b) => b.fecha_neg.localeCompare(a.fecha_neg) || b.id - a.id).slice(0, 8)}
          vacio={{ titulo: 'Sin pedidos', texto: 'Crea el primer pedido para ver aquí su avance.', accion: <Link className="rtm-boton" href="/pedidos/nuevo">Nuevo pedido</Link> }}
          totales={pedidos && pedidos.length > 0 ? { etiqueta: 'Total mostrado', celdas: { z: formatearPiezas([...pedidos].sort((a, b) => b.fecha_neg.localeCompare(a.fecha_neg) || b.id - a.id).slice(0, 8).reduce((a, p) => a + p.piezas_pedidas, 0)) } } : undefined}
          columnas={[
            { id: 'f', titulo: 'Folio', ancho: 'm', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'c', titulo: 'Cliente', ancho: 'l', celda: (p) => p.cliente },
            { id: 'd', titulo: 'Fecha', ancho: 'm', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_neg) },
            { id: 'z', titulo: 'Piezas', numerica: true, ancho: 's', celda: (p) => formatearPiezas(p.piezas_pedidas) },
            { id: 'b', titulo: 'Facturado', numerica: true, ancho: 'm', celda: (p) => (p.estado === 'enviado' ? formatearMoneda(p.cobrado_cent) : <span className="rtm-sin-dato">Sin dato</span>) },
            { id: 'e', titulo: 'Estado', ancho: 'm', celda: (p) => <ChipEstado tono={p.estado === 'enviado' ? 'ok' : p.estado === 'anulado' ? 'malo' : p.estado === 'confirmado' ? 'atencion' : 'apagado'}>{ESTADO_PEDIDO[p.estado].texto}</ChipEstado> },
          ]}
        />
      </Tarjeta>
    </Pagina>
  );
}
