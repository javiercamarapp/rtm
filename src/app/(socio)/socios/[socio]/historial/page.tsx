import type { Metadata } from 'next';
import Link from 'next/link';
import { BarraAcciones } from '@/ui/componentes/barra-acciones';
import { notFound } from 'next/navigation';
import { exigirSocio } from '@/composicion/acceso';
import { historialDeSocio } from '@/composicion/historial';
import { calcularRatios, estacionalidadSemanal, estadisticasMeses, proyeccionPersonal } from '@/dominio/historial/ratios';
import type { FilaSerie } from '@/dominio/historial/tipos';
import { etiquetaFecha, formatearDecimal, nombreVape } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, Segmentado } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ColumnasPesos } from '../../../_a3/graficas-pesos';
import { Dos, Estado, Pie, abs, pct, suma } from '../../../_a3/util';
import { fechaCorta, mesEtiqueta, semanaEtiqueta } from '../../../_a2/util';
import { valuacionDeSocios } from '@/composicion/valuacion-socios';
import { tarjetaValuacion } from '@/dominio/socios/valuacion';
import { anosDe, bpAPct, m, mesesTexto, razon } from '../../../_historial/util';

export const metadata: Metadata = { title: 'Historial personal' };

/** El dia es el ultimo del mes: el periodo es un mes calendario completo. */
const mesAlFinal = (f: string): boolean => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.getUTCDate() === 1; };

type Vista = 'mes' | 'semana' | 'dia';
const VISTAS: { v: Vista; t: string }[] = [{ v: 'mes', t: 'Por mes' }, { v: 'semana', t: 'Por semana' }, { v: 'dia', t: 'Por día' }];

export default async function PaginaHistorial({ params, searchParams }: { params: Promise<{ socio: string }>; searchParams: Promise<{ vista?: string; anio?: string }> }) {
  const { socio } = await params;
  const q = await searchParams;
  if (socio !== 'Angelo' && socio !== 'Javier') notFound();
  const vista: Vista = q.vista === 'semana' || q.vista === 'dia' ? q.vista : 'mes';
  const { perfil } = await exigirSocio();
  const h = await (await historialDeSocio()).historial(socio, null);
  const tv = await valuacionDeSocios().then((v) => tarjetaValuacion(v.cuenta, socio, m)).catch(() => null);
  const c = h.cabecera;
  const r = calcularRatios(h);
  const est = estadisticasMeses(h.meses);
  const proy = proyeccionPersonal(h.meses, r.payout_bp);
  const estac = estacionalidadSemanal(h.dias);
  const sinH = !h.con_historial;
  const base = `/socios/${socio}/historial`;
  const href = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const act: Record<string, string | undefined> = { vista: q.vista, anio: q.anio };
    for (const [k, v] of Object.entries({ ...act, ...cambios })) if (v) p.set(k, v);
    return p.size ? `${base}?${p}` : base;
  };

  const anios = anosDe(h.actas.map((a) => a.periodo_fin));
  const anio = q.anio && anios.includes(q.anio) ? q.anio : null;
  const actas = h.actas.filter((a) => !anio || a.periodo_fin.startsWith(anio));
  // Vigentes: cerradas de periodo y NO corregidas por una contra-acta firmada (su efecto ya se deshizo y no suma al total).
  const cerradas = actas.filter((a) => a.estado === 'cerrado' && a.tipo === 'periodo' && !a.corregida);
  const corregidas = actas.filter((a) => a.estado === 'cerrado' && a.tipo === 'periodo' && a.corregida).length;

  const filas: FilaSerie[] = vista === 'mes' ? [...h.meses].reverse() : vista === 'semana' ? [...h.semanas].reverse() : [...h.dias].reverse();
  const etiqueta = (f: FilaSerie) => (vista === 'mes' ? mesEtiqueta(f.ini) : vista === 'semana' ? `Sem. ${semanaEtiqueta(f.ini)}` : etiquetaFecha(f.ini));
  const sumaF = (k: 'utilidad_cent' | 'parte_cent' | 'retiros_cent' | 'reinversion_cent') => suma(filas.map((f) => f[k]));
  const movil = new Map(est.completos.map((x, i) => [x.ini, est.promedio_movil[i] ?? null]));
  const puntosMes = h.meses.map((f) => ({ id: f.ini, etiqueta: mesEtiqueta(f.ini), valor: Number(abs(f.parte_cent)), texto: `${m(f.parte_cent, true)}${f.parcial ? ' · parcial' : ''}`, parcial: f.parcial, detalle: 'Su parte de la utilidad del mes' }));
  const otro = socio === 'Angelo' ? 'Javier' : 'Angelo';
  const maxEst = estac.reduce((a, x) => (x.promedio_cent !== null && abs(x.promedio_cent) > a ? abs(x.promedio_cent) : a), 0n);
  const t = h.totales;
  const valorTxt = c.valor_cent === null ? null : m(c.valor_cent);
  const compr = (x: keyof typeof c.comprobaciones) => (c.comprobaciones[x] === true ? 'cuadra' as const : c.comprobaciones[x] === false ? 'no_cuadra' as const : 'sin_comprobar' as const);

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/socios', texto: 'Cuenta de socios' }}
        eyebrow="Historial personal"
        titulo={`Historial de ${socio}`}
        descripcion={sinH ? 'Todavía no hay movimientos: el historial se llena con el primer pedido, aportación o acta.' : `Desde ${etiquetaFecha(c.primera_fecha!)} · ${c.meses_activo} ${c.meses_activo === 1 ? 'mes' : 'meses'} · transparente para los dos socios`}
        acciones={
          <BarraAcciones
            etiquetaAria="Acciones del historial"
            vistas={[
              { href: `/socios/${socio}`, etiqueta: 'Cuenta', titulo: `Estado de cuenta de ${socio}` },
              { href: '/socios/cascada', etiqueta: 'Cascada', titulo: 'Cascada y actas' },
            ]}
            primarias={<a className="rtm-boton rtm-boton-primario" href={`${base}/pdf`} title="Exportar el historial en PDF" data-testid="historial-pdf">Exportar PDF</a>}
          />
        }
      />
      <Segmentado etiquetaAria="Ver el historial de" opciones={(['Angelo', 'Javier'] as const).map((n) => ({ valor: n, etiqueta: n === perfil.socio_nombre ? `Mi historial (${n})` : `Historial de ${n}`, href: `/socios/${n}/historial`, activa: n === socio, testid: `ver-historial-${n}` }))} />
      {sinH && <Aviso tono="info" titulo="Sin historial todavía.">Las cifras aparecen como «Sin dato» hasta que haya ventas, aportaciones o un acta firmada; nunca se muestra un cero inventado.</Aviso>}
      {t?.provisional && <Aviso tono="atencion" titulo="Utilidad provisional.">Hay guías sin costo real; la utilidad se ajusta cuando se costeen.</Aviso>}

      {tv && !sinH && <Aviso tono={tv.estado === 'igual' ? 'info' : 'atencion'} titulo={`Valuación de ${socio} ${tv.valorTexto}: ${tv.comparacion}`}>{tv.faltan}. {tv.indicaciones.length > 0 ? `${tv.indicaciones.join('. ')}.` : 'Las dos valuaciones son iguales.'} Misma cifra que la Cuenta de socios y el Balance.</Aviso>}

      <KpiLinea
        etiquetaAria="Cabecera del historial personal"
        celdas={[
          { id: 'inv', etiqueta: 'Invertido total', testid: 'h-invertido', valor: sinH ? null : <CifraComprobada texto={m(c.invertido_cent)} cifra={`historial:invertido:${socio}`} comprobacion={compr('invertido')} />, categoria: 1, nota: `Aportaciones ${m(c.aportaciones_cent)} · reinversiones ${m(c.reinversion_cent)}` },
          { id: 'ret', etiqueta: 'Retirado total', testid: 'h-retirado', valor: sinH ? null : <CifraComprobada texto={m(c.retirado_cent)} cifra={`historial:retirado:${socio}`} comprobacion={compr('retirado')} />, categoria: 2, nota: `Utilidad ${m(c.retirado_utilidad_cent)} · capital ${m(c.retirado_capital_cent)}` },
          { id: 'ut', etiqueta: 'Utilidad recibida en actas', testid: 'h-utilidad', valor: sinH ? null : <CifraComprobada texto={m(c.utilidad_asignada_cent)} cifra={`historial:utilidad:${socio}`} comprobacion={compr('utilidad')} />, categoria: 3, nota: `Por distribuir ${m(c.utilidad_por_distribuir_cent)}` },
          { id: 'val', etiqueta: 'Valuación personal', testid: 'h-valor', valor: valorTxt === null ? null : <CifraComprobada texto={valorTxt} cifra={`historial:valor:${socio}`} comprobacion={compr('valor')} />, categoria: 4, nota: valorTxt === null ? 'Sin asientos contables todavía' : <>Capital aportado + su parte de la utilidad − fondos en su poder {m(c.fondos_cent)}</> },
          { id: 'rec', etiqueta: 'Recuperado de lo invertido', testid: 'h-recuperado', valor: bpAPct(r.recuperado_bp), categoria: 5, progreso: r.recuperado_bp === null ? undefined : { pct: Math.min(100, Number(r.recuperado_bp) / 100) }, nota: r.recuperado_bp === null ? 'Aún no invierte' : `Retirado ${m(c.retirado_cent)} de ${m(c.invertido_cent)}` },
          { id: 'cta', etiqueta: 'Aportación neta', testid: 'h-neta', valor: <CifraComprobada texto={m(c.aportacion_neta_cent, true)} cifra={`historial:neta:${socio}`} comprobacion={compr('neta')} />, categoria: 6, nota: c.igualados ? 'Los dos tienen lo mismo aportado' : c.le_toca_aportar ? `Le toca aportar el siguiente pago · diferencia a igualar ${m(c.diferencia_a_igualar_cent)}` : `Ya aportó más · diferencia a igualar del otro socio ${m(c.diferencia_a_igualar_cent)}` },
        ]}
      />
      <FilaRatios
        etiqueta="Ratios de rendimiento"
        items={[
          { etiqueta: 'ROI', valor: bpAPct(r.roi_bp) },
          { etiqueta: 'ROI anualizado', valor: bpAPct(r.roi_anualizado_bp) },
          { etiqueta: 'Múltiplo sobre capital', valor: razon(r.multiplo_x100) },
          { etiqueta: 'TIR de sus flujos', valor: bpAPct(r.tir_bp) },
          { etiqueta: 'Payback', valor: mesesTexto(r.payback_meses) },
          { etiqueta: 'Tasa de reinversión', valor: bpAPct(r.tasa_reinversion_bp) },
          { etiqueta: 'Payout (retirado / utilidad)', valor: bpAPct(r.payout_bp) },
          { etiqueta: 'Retiro mensual promedio', valor: r.retiro_mensual_cent === null ? null : m(r.retiro_mensual_cent) },
        ]}
      />
      <FilaRatios
        etiqueta="Ratios de operación y caja"
        items={[
          { etiqueta: 'Margen neto', valor: bpAPct(r.margen_neto_bp) },
          { etiqueta: 'Utilidad por pieza', valor: r.utilidad_por_pieza_cent === null ? null : m(r.utilidad_por_pieza_cent) },
          { etiqueta: 'Cobertura de caja', valor: razon(r.cobertura_caja_x100) },
          { etiqueta: 'Participación en el capital', valor: bpAPct(r.participacion_capital_bp) },
          { etiqueta: 'Participación en la utilidad', valor: bpAPct(r.participacion_utilidad_bp) },
          { etiqueta: 'Utilidad atribuida a su parte', valor: t ? m(t.parte_cent, t.parte_cent < 0n) : null },
          { etiqueta: 'Pedidos · piezas', valor: t ? `${t.pedidos} · ${formatearDecimal(Number(t.piezas), 0)}` : null },
          { etiqueta: 'Aportación neta', valor: m(r.aportacion_neta_cent, r.aportacion_neta_cent < 0n) },
        ]}
      />

      <Tarjeta
          plana
          titulo="Línea de tiempo de actas"
          descripcion={`${cerradas.length} ${cerradas.length === 1 ? 'acta vigente' : 'actas vigentes'}${corregidas ? ` · ${corregidas} ${corregidas === 1 ? 'corregida' : 'corregidas'} por contra-acta (no suman al total)` : ''} · cada acta fija el retiro y la reinversión`}
        >
          {anios.length > 1 && <nav className="rtm-seg" aria-label="Año de las actas"><Link href={href({ anio: null })} aria-current={!anio ? 'true' : undefined}>Todos</Link>{anios.map((a) => <Link key={a} href={href({ anio: a })} aria-current={anio === a ? 'true' : undefined}>{a}</Link>)}</nav>}
          <div className="rtm-actas-tabla">
          <DataTable
            etiqueta={`Actas de ${socio}`}
            densidad="densa" plana primeraFija
            clave={(a) => a.id}
            filas={actas}
            totales={cerradas.length === 0 ? undefined : { etiqueta: `Total (${cerradas.length})`, celdas: { u: m(suma(cerradas.map((a) => a.utilidad_cent))), p2: m(suma(cerradas.map((a) => a.parte_cent))), r: m(suma(cerradas.map((a) => a.retira_cent))), i: m(suma(cerradas.map((a) => a.reinvierte_cent))) } }}
            vacio={{ titulo: 'Sin actas', texto: 'El primer corte mensual firmado por los dos aparece aquí con su PDF.' }}
            columnas={[
              { id: 'f', titulo: 'Acta', ancho: 'm', prioridadMovil: 'titulo' as const, celda: (a) => <Link href={`/socios/actas/${a.id}`} className="rtm-mono">{a.folio}</Link> },
              { id: 'p', titulo: 'Periodo', ancho: 'l', celda: (a) => (a.periodo_ini.slice(8) === '01' && a.periodo_ini.slice(0, 7) === a.periodo_fin.slice(0, 7) && mesAlFinal(a.periodo_fin) ? mesEtiqueta(a.periodo_ini) : `${fechaCorta(a.periodo_ini)} al ${fechaCorta(a.periodo_fin)}`) },
              { id: 'u', titulo: 'Utilidad del mes', etiquetaMovil: 'Utilidad', numerica: true, ancho: 'm', celda: (a) => (a.tipo === 'contra' ? '—' : m(a.utilidad_cent, a.utilidad_cent < 0n)) },
              { id: 'p2', titulo: 'Su parte', numerica: true, ancho: 'm', prioridadMovil: 'normal' as const, celda: (a) => (a.tipo === 'contra' ? '—' : m(a.parte_cent)) },
              { id: 'r', titulo: 'Retira (decisión)', etiquetaMovil: 'Retira', numerica: true, ancho: 'm', celda: (a) => m(a.retira_cent) },
              { id: 'i', titulo: 'Reinvierte (decisión)', etiquetaMovil: 'Reinvierte', numerica: true, ancho: 'm', celda: (a) => m(a.reinvierte_cent) },
              { id: 'v', titulo: 'Valor de su participación', etiquetaMovil: 'Valor', numerica: true, ancho: 'l', secundaria: true, prioridadMovil: 'normal' as const, celda: (a) => (a.valor_cent === null ? <span className="rtm-sin-dato">Sin dato</span> : m(a.valor_cent)) },
              { id: 'e', titulo: 'Firmas', ancho: 'l', prioridadMovil: 'detalle' as const, celda: (a) => <Dos a={<Estado tono={a.estado === 'cerrado' ? 'ok' : 'atencion'}>{a.estado === 'cerrado' ? 'Firmada por los dos' : a.estado === 'firmado_por_uno' ? 'Falta una firma' : 'Sin firmas'}</Estado>} b={a.tipo === 'contra' ? 'Contra-acta' : a.corregida ? 'Corregida por contra-acta' : a.contra_propuesta ? 'Contra-acta propuesta' : a.firmas.map((f) => f.socio).join(' y ') || 'Pendiente'} /> },
              { id: 'd', titulo: 'PDF', ancho: 's', prioridadMovil: 'detalle' as const, celda: (a) => <a href={`/socios/actas/${a.id}/pdf`} className="rtm-enlace">PDF</a> },
            ]}
          />
          </div>
          <Pie>«Retira» y «Reinvierte» son lo que decidió el acta; «Retirado total» de arriba es lo que ya se pagó. La diferencia es lo que queda por distribuir hasta que se registre el pago.</Pie>
        </Tarjeta>
      <Rejilla dividir="4-4-4">
        <Tarjeta titulo="Su parte por mes" descripcion="Su parte de la utilidad de la empresa, atribuida a su cuenta; el último mes puede ser parcial">
          {puntosMes.length >= 2 ? <ColumnasPesos titulo={`Parte mensual de ${socio}`} descripcion={`Su parte de la utilidad en ${puntosMes.length} meses.`} procedencia="observado" pie="Fuente: libro de pedidos, tomas y gastos" alto={150} datos={puntosMes} /> : <p className="a3-grafica-vacia"><strong>Pocos meses</strong>Con dos o más meses se dibuja la serie; la tabla de abajo trae todos los números.</p>}
        </Tarjeta>
        <Tarjeta titulo="Mejores y peores meses, rachas y estacionalidad" descripcion="Sobre meses completos y la serie diaria">
          <dl className="rtm-ratios" aria-label="Estadísticas mensuales">
            <div><dt>Mejor mes</dt><dd>{est.mejor ? `${mesEtiqueta(est.mejor.ini)} · ${m(est.mejor.parte_cent, true)}` : <span className="rtm-sin-dato">Sin dato</span>}</dd></div>
            <div><dt>Peor mes</dt><dd>{est.peor ? `${mesEtiqueta(est.peor.ini)} · ${m(est.peor.parte_cent, true)}` : <span className="rtm-sin-dato">Sin dato</span>}</dd></div>
            <div><dt>Racha actual de meses con utilidad</dt><dd>{est.completos.length ? `${est.racha_actual}` : <span className="rtm-sin-dato">Sin dato</span>}</dd></div>
            <div><dt>Mejor racha</dt><dd>{est.completos.length ? `${est.mejor_racha}` : <span className="rtm-sin-dato">Sin dato</span>}</dd></div>
          </dl>
          <p className="a3-sub">Promedio por día de la semana (su parte, últimos 60 días)</p>
          {maxEst > 0n ? <BarList etiquetaAria="Estacionalidad por día de la semana" items={estac.map((x) => ({ id: x.dia, etiqueta: x.dia, texto: x.promedio_cent === null ? 'Sin dato' : m(x.promedio_cent, true), pct: x.promedio_cent === null ? null : pct(abs(x.promedio_cent), maxEst), nota: `${x.dias} días`, tono: x.promedio_cent !== null && x.promedio_cent < 0n ? 'malo' : undefined }))} /> : <p className="a3-grafica-vacia"><strong>Sin dato</strong>Aún no hay días con utilidad para comparar.</p>}
        </Tarjeta>
        <Tarjeta titulo="Proyección personal" descripcion="Próximos 3 meses · Estimado">
          {proy.suficiente ? (
            <>
              <DataTable
                etiqueta="Proyección de los próximos 3 meses"
                densidad="densa" plana clave={(x) => x.n}
                filas={proy.meses.map((x, i) => ({ n: i + 1, ...x }))}
                columnas={[
                  { id: 'n', titulo: 'Acumulado a', ancho: 'm', prioridadMovil: 'titulo' as const, celda: (x) => `${x.n} ${x.n === 1 ? 'mes' : 'meses'}` },
                  { id: 'e', prioridadMovil: 'normal' as const, titulo: proy.base === 'retiro' ? 'Retiro esperado' : 'Su parte esperada', numerica: true, ancho: 'm', celda: (x) => m(x.esperado_cent, x.esperado_cent < 0n) },
                  { id: 'b', titulo: 'Desde', numerica: true, ancho: 'm', celda: (x) => m(x.bajo_cent, x.bajo_cent < 0n) },
                  { id: 'a', titulo: 'Hasta', numerica: true, ancho: 'm', prioridadMovil: 'normal' as const, celda: (x) => m(x.alto_cent, x.alto_cent < 0n) },
                ]}
              />
              <Pie>Estimado con {proy.n} meses completos; cada fila es el acumulado de los próximos meses. La banda es ± una desviación predictiva (un mes: {m(proy.banda_cent)}), crece con el horizonte y se estrecha con más meses; un resultado negativo se muestra con su signo. {proy.base === 'retiro' ? `Retiro = su parte esperada por el payout observado (${bpAPct(r.payout_bp)}).` : 'Sin retiros en efectivo contra actas todavía: no se proyecta un retiro (sería un cero inventado), se proyecta su parte de la utilidad.'}</Pie>
            </>
          ) : (
            <p className="a3-grafica-vacia" data-testid="proyeccion-insuficiente"><strong>Estimado, historial insuficiente</strong>Se necesitan al menos 3 meses completos; hoy hay {proy.n}. No se emite proyección con menos.</p>
          )}
        </Tarjeta>
      </Rejilla>

      <Tarjeta
        plana
        titulo="Utilidad, retiros y reinversión por periodo"
        descripcion="Su parte de la utilidad de la empresa; retiros y reinversión son de su cuenta"
      >
        <nav className="rtm-seg" aria-label="Periodo de la tabla">{VISTAS.map((x) => <Link key={x.v} href={href({ vista: x.v === 'mes' ? null : x.v })} aria-current={vista === x.v ? 'true' : undefined} data-testid={`vista-${x.v}`}>{x.t}</Link>)}</nav>
        <DataTable
          etiqueta={`Historial ${vista === 'mes' ? 'mensual' : vista === 'semana' ? 'semanal' : 'diario'} de ${socio}`}
          densidad="libro" plana pegajosa primeraFija
          interactiva={{ porPagina: 40, exportar: `historial-${socio}-${vista}` }}
          clave={(f) => f.ini}
          filas={filas}
          totales={filas.length === 0 ? undefined : { etiqueta: `Total (${filas.length})`, celdas: { u: m(sumaF('utilidad_cent'), sumaF('utilidad_cent') < 0n), p: m(sumaF('parte_cent'), sumaF('parte_cent') < 0n), re: m(sumaF('retiros_cent')), ri: m(sumaF('reinversion_cent')) } }}
          vacio={{ titulo: 'Sin periodos', texto: 'Aparecen con el primer pedido enviado.' }}
          columnas={[
            { id: 'e', titulo: 'Periodo', ancho: 'l', prioridadMovil: 'titulo' as const, celda: (f) => <>{etiqueta(f)}{f.parcial ? <span className="rtm-celda-sub">En curso</span> : null}</> },
            { id: 'u', titulo: 'Utilidad de la empresa', numerica: true, ancho: 'l', celda: (f) => m(f.utilidad_cent, f.utilidad_cent < 0n) },
            { id: 'p', titulo: 'Su parte', numerica: true, ancho: 'l', prioridadMovil: 'normal' as const, celda: (f) => m(f.parte_cent, f.parte_cent < 0n) },
            { id: 'v', titulo: 'Ventas', numerica: true, ancho: 'm', secundaria: true, celda: (f) => m(f.ventas_cent) },
            { id: 'pe', titulo: 'Pedidos', numerica: true, ancho: 's', secundaria: true, celda: (f) => f.pedidos },
            { id: 'pz', titulo: 'Piezas', numerica: true, ancho: 's', secundaria: true, celda: (f) => formatearDecimal(Number(f.piezas), 0) },
            { id: 're', titulo: 'Retiros', numerica: true, ancho: 'm', celda: (f) => m(f.retiros_cent) },
            { id: 'ri', titulo: 'Reinversión', numerica: true, ancho: 'm', celda: (f) => m(f.reinversion_cent) },
            ...(vista === 'mes' ? [{ id: 'pm', titulo: 'Promedio móvil 3 meses', numerica: true, ancho: 'l' as const, secundaria: true, celda: (f: FilaSerie) => (movil.get(f.ini) == null ? <span className="rtm-sin-dato">Sin dato</span> : m(movil.get(f.ini)!)) }] : []),
          ]}
        />
      </Tarjeta>

      <Rejilla dividir="6-6">
        <Tarjeta plana titulo="Utilidad por cliente" descripcion="Pedidos enviados; su parte de cada cliente">
          <DataTable
            etiqueta="Utilidad por cliente" densidad="densa" plana clave={(x) => x.cliente_id} filas={h.por_cliente}
            vacio={{ titulo: 'Sin clientes', texto: 'Aparecen con el primer pedido enviado.' }}
            columnas={[
              { id: 'c', titulo: 'Cliente', ancho: 'l', truncar: 'm', celda: (x) => x.cliente },
              { id: 'pe', titulo: 'Pedidos', numerica: true, ancho: 's', celda: (x) => x.pedidos },
              { id: 'pz', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => formatearDecimal(Number(x.piezas), 0) },
              { id: 'u', titulo: 'Utilidad', numerica: true, ancho: 'm', celda: (x) => m(x.utilidad_cent, x.utilidad_cent < 0n) },
              { id: 'p', titulo: 'Su parte', numerica: true, ancho: 'm', celda: (x) => m(x.parte_cent, x.parte_cent < 0n) },
            ]}
          />
        </Tarjeta>
        <Tarjeta plana titulo="Margen por modelo" descripcion="Venta menos costo de la mercancía; no incluye gastos generales">
          <DataTable
            etiqueta="Margen por modelo" densidad="densa" plana clave={(x) => x.modelo} filas={h.por_modelo}
            vacio={{ titulo: 'Sin modelos', texto: 'Aparecen con el primer pedido enviado.' }}
            columnas={[
              { id: 'm', titulo: 'Modelo', ancho: 'l', truncar: 'm', celda: (x) => nombreVape(x.modelo) },
              { id: 'pz', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => formatearDecimal(Number(x.piezas), 0) },
              { id: 'v', titulo: 'Venta', numerica: true, ancho: 'm', celda: (x) => m(x.venta_cent) },
              { id: 'c', titulo: 'Costo', numerica: true, ancho: 'm', secundaria: true, celda: (x) => m(x.costo_cent) },
              { id: 'u', titulo: 'Margen', numerica: true, ancho: 'm', celda: (x) => m(x.utilidad_cent, x.utilidad_cent < 0n) },
              { id: 'p', titulo: 'Su parte', numerica: true, ancho: 'm', secundaria: true, celda: (x) => m(x.parte_cent, x.parte_cent < 0n) },
            ]}
          />
        </Tarjeta>
      </Rejilla>
      <p className="rtm-nota" data-testid="nota-historial">
        La utilidad se atribuye con una sola regla de redondeo (Javier hacia cero, Angelo el resto) y aportar más no cambia la participación. {c.valor_cent !== null ? `La valuación personal es la de Capital por mes: su capital aportado (aportaciones, reinversiones y utilidad recibida en actas, menos lo retirado) más su parte de la utilidad que aún no pasa por un acta, menos los fondos de la sociedad que tiene en su poder; las dos valuaciones más los fondos son el capital contable (${m(c.capital_contable_cent!)}). La diferencia a igualar no es una deuda: se resuelve con las siguientes aportaciones de quien tiene menos. ` : ''}
        ROI, múltiplo y TIR usan lo invertido como aportaciones más reinversiones, según el acta de corte. Ninguna de estas cifras la calcula la IA: salen de la base y de funciones deterministas. Ver también el historial de {otro}: <Link href={`/socios/${otro}/historial`}>{otro}</Link>.
      </p>
    </Pagina>
  );
}
