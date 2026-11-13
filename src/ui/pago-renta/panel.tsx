// Panel del Pago de renta, compartido por la pagina del socio y la de Omar. Server component: recibe el panel que entrega la base y solo lo presenta.
// El dinero viene de la base; aqui se agrupa por periodo, se redactan frases con plantilla fija y se dibuja. Todo lo proyectado va como "Estimado".
import type { ReactNode } from 'react';
import '@/ui/estilos/paginas-a3.css';
import '@/ui/estilos/pago-renta.css';
import { acumuladoDelMes, agruparPorPeriodo, desdePrimerMovimiento, estadisticas, insights, reglaDeCalculo, type Paso, PASOS } from '@/dominio/pago-renta/calculos';
import type { PanelRenta, PagoRenta } from '@/dominio/pago-renta/tipos';
import { etiquetaFecha, formatearEntero, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { Aviso, ChipEstado, Segmentado } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, EstadoVacio, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Contador, TarjetaInsight } from '@/ui/graficas';
import { ColumnasPiezas, LineaRentaMes } from './graficas';

const m = (c: bigint, signo = false) => formatearMoneda(c, signo ? { conSigno: true } : {});
const ETIQUETA_PASO: Record<Paso, string> = { dia: 'Por día', semana: 'Por semana', mes: 'Por mes' };
const TITULO_PASO: Record<Paso, string> = { dia: 'Piezas enviadas por día (últimos 30 días)', semana: 'Piezas enviadas por semana (últimas 12)', mes: 'Piezas enviadas por mes (últimos 12)' };

interface Props {
  panel: PanelRenta;
  modo: 'socio' | 'omar';
  paso: Paso;
  /** Ruta base de la pagina para los enlaces del selector de periodo. */
  ruta: string;
  /** Boton para registrar un pago (solo socio). */
  acciones?: ReactNode;
}

export function PanelPagoRenta({ panel, modo, paso, ruta, acciones }: Props) {
  const { estado: e, proyeccion: proy, serie, pagos } = panel;
  const socio = modo === 'socio';
  const est = estadisticas(serie, pagos, e);
  const ideas = insights(e, proy, est);
  const sinNada = e.piezas === 0 && pagos.length === 0;
  const cubetas = agruparPorPeriodo(serie, e.hoy, paso);
  const visibles = desdePrimerMovimiento(cubetas);
  const conDato = visibles.filter((c) => c.piezas !== 0).length;
  const acumulado = acumuladoDelMes(serie, e.hoy, proy);
  const observados = acumulado.filter((p) => p.tipo === 'observado').length;
  const quien = socio ? 'a Omar' : 'a ti';
  const deQuien = socio ? 'de Omar' : 'tuya';

  const encabezado = (
    <EncabezadoPagina
      eyebrow={socio ? 'Cuenta con Omar · renta de la bodega' : 'Tu cuenta · renta de la bodega'}
      titulo={e.por_pagar_cent > 0n ? `${socio ? 'Hay que pagar' : 'Te deben'} ${m(e.por_pagar_cent)} de renta` : e.a_favor_cent > 0n ? `Renta pagada con ${m(e.a_favor_cent)} de anticipo` : 'La renta está al corriente'}
      descripcion={`Dos pesos por cada pieza enviada desde la bodega, a la fecha del ${etiquetaFecha(e.hoy)}. ${reglaDeCalculo(e)}.`}
      acciones={acciones}
    />
  );

  if (sinNada) {
    return (
      <Pagina ancho="tablero">
        {encabezado}
        <div data-testid="renta-vacio">
          <EstadoVacio titulo="Todavía no hay envíos desde la bodega" texto={`La renta se devenga cuando se marca como enviado un pedido que sale de la bodega: ${e.tarifa_cent === null ? 'cuando haya tarifa' : `${m(e.tarifa_cent)} por pieza`}. Cuando haya envíos verás aquí cuánto se debe ${quien}, el desglose por día, semana y mes, y la proyección al corte.`} />
        </div>
      </Pagina>
    );
  }

  const columnasPagos = [
    { id: 'fecha', titulo: 'Fecha', celda: (p: PagoRenta) => etiquetaFecha(p.fecha), prioridadMovil: 'titulo' as const },
    { id: 'monto', titulo: 'Monto', numerica: true, celda: (p: PagoRenta) => m(p.monto_cent), prioridadMovil: 'principal' as const },
    { id: 'via', titulo: 'Vía', celda: (p: PagoRenta) => (p.via === 'efectivo' ? 'Efectivo' : 'Transferencia'), prioridadMovil: 'normal' as const },
    { id: 'folio', titulo: 'Folio', celda: (p: PagoRenta) => p.folio, prioridadMovil: 'normal' as const },
    ...(socio ? [
      { id: 'socio', titulo: 'Pagó', celda: (p: PagoRenta) => p.socio ?? 'Sin dato', prioridadMovil: 'normal' as const },
      { id: 'nota', titulo: 'Nota o comprobante', celda: (p: PagoRenta) => [p.nota, p.comprobante].filter(Boolean).join(' · ') || 'Sin nota', prioridadMovil: 'detalle' as const },
    ] : []),
  ];

  return (
    <Pagina ancho="tablero">
      {encabezado}

      <section className="pr-heroe rtm-entra rtm-i-1" data-testid="renta-heroe" aria-label="Lo que se debe ahora">
        <div className="pr-heroe-cifra">
          <span className="pr-heroe-etiqueta">{e.por_pagar_cent > 0n || e.a_favor_cent === 0n ? 'Por pagar ahora' : 'A favor de Omar'}</span>
          <strong className="pr-heroe-monto" data-testid="renta-por-pagar">
            <Contador valor={Number(e.por_pagar_cent > 0n || e.a_favor_cent === 0n ? e.por_pagar_cent : e.a_favor_cent)} tipo="moneda" />
          </strong>
          <span className="pr-heroe-regla" data-testid="renta-regla">{reglaDeCalculo(e)}{e.pagado_cent > 0n ? ` − ${m(e.pagado_cent)} ya pagados` : ''}</span>
        </div>
        <dl className="pr-heroe-desglose">
          <div><dt>Piezas enviadas</dt><dd>{formatearEntero(e.piezas)}</dd></div>
          <div><dt>Tarifa por pieza</dt><dd>{e.tarifa_cent === null ? 'Sin dato' : m(e.tarifa_cent)}</dd></div>
          <div><dt>Devengado</dt><dd>{m(e.devengado_cent)}</dd></div>
          {e.compensado_tomas_cent > 0n && <div><dt>Compensado con tomas</dt><dd>{m(-e.compensado_tomas_cent, true)}</dd></div>}
          <div><dt>Pagado</dt><dd>{m(-e.pagado_cent, e.pagado_cent > 0n)}</dd></div>
          <div className="pr-heroe-total"><dt>{e.saldo_cent >= 0n ? 'Por pagar' : 'A favor'}</dt><dd>{m(e.saldo_cent < 0n ? -e.saldo_cent : e.saldo_cent)}</dd></div>
        </dl>
      </section>

      {e.a_favor_cent > 0n && <Aviso tono="info" titulo="Anticipo.">Se pagaron {m(e.a_favor_cent)} más de lo devengado. Se absorben con la renta de los próximos envíos.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores de la renta"
        celdas={[
          { id: 'mes', testid: 'renta-mes', etiqueta: 'Renta del mes', valor: m(est.mes.renta_cent), categoria: 1, nota: `${formatearPiezas(est.mes.piezas)} enviadas · quedan ${est.diasRestantes} ${est.diasRestantes === 1 ? 'día' : 'días'} del mes` },
          { id: 'ritmo', etiqueta: 'Ritmo diario', valor: est.ritmo7 === null ? null : `${est.ritmo7.toFixed(1)} pz`, categoria: 2, nota: est.ritmo7 === null ? 'Faltan días de historia' : `Últimos 7 días cerrados · ${(est.ritmoSemanal ?? 0).toFixed(0)} pz por semana` },
          { id: 'mejor', etiqueta: 'Mejor día', valor: est.mejorDia ? formatearPiezas(est.mejorDia.piezas) : null, categoria: 4, nota: est.mejorDia ? etiquetaFecha(est.mejorDia.fecha) : 'Sin envíos' },
          { id: 'mes-ant', etiqueta: 'Contra el mes anterior', valor: est.mesAnterior && est.mesAnterior.variacionPct !== null ? `${est.mesAnterior.variacionPct >= 0 ? '+' : '−'}${Math.abs(est.mesAnterior.variacionPct)} %` : null, categoria: 6, nota: est.mesAnterior ? `Al mismo día: ${formatearPiezas(est.mesAnterior.piezas)} el mes anterior` : 'Sin mes anterior comparable' },
          { id: 'corte', testid: 'renta-corte', etiqueta: 'Pago al corte · Estimado', valor: proy.emitida ? m(proy.pago_al_corte_cent.central) : null, categoria: 7, nota: proy.emitida ? `Rango ${m(proy.pago_al_corte_cent.bajo)} a ${m(proy.pago_al_corte_cent.alto)}` : 'Sin muestra suficiente para estimar' },
        ]}
      />

      <div className="pr-ideas" data-testid="renta-insights">
        {ideas.slice(0, 4).map((i, n) => (
          <TarjetaInsight key={i.id} indice={n} etiqueta={i.etiqueta} cifra={{ valor: i.cifra.valor, tipo: i.cifra.tipo === 'porcentaje' ? 'entero' : i.cifra.tipo, unidad: i.cifra.tipo === 'porcentaje' ? '%' : undefined }} frase={i.frase} procedencia={i.procedencia} severidad={i.severidad} />
        ))}
      </div>

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Renta acumulada del mes" descripcion="Lo devengado día por día y, si hay muestra, la proyección al corte">
          {observados >= 2 ? (
            <LineaRentaMes
              titulo="Renta acumulada del mes"
              descripcion={`Renta devengada acumulada del mes: ${m(est.mes.renta_cent)}.${proy.emitida ? ` Estimado al corte: ${m(proy.mes_renta_cent.central)}, rango ${m(proy.mes_renta_cent.bajo)} a ${m(proy.mes_renta_cent.alto)}.` : ' Sin proyección: la muestra es chica.'}`}
              pie={`Corte: ${etiquetaFecha(e.hoy)} · Fuente: devengos de renta${proy.emitida ? ' · Estimado: ritmo diario con rango de 10 % a 90 %' : ''}`}
              puntos={acumulado}
            />
          ) : (
            <p className="a3-grafica-vacia"><strong>Pocos datos para dibujar el mes</strong>Con dos o más días del mes se dibuja la línea acumulada.</p>
          )}
          {!proy.emitida && (
            <p className="pr-muestra" data-testid="renta-sin-proyeccion">
              <ChipEstado tono="apagado">Sin proyección</ChipEstado>{' '}
              {proy.motivo === 'sin_tarifa'
                ? 'No hay tarifa configurada.'
                : `Muestra chica: ${proy.muestra.dias_con_envio} de ${proy.muestra.dias_requeridos} días con envío y ${formatearPiezas(proy.muestra.piezas)} de ${formatearPiezas(proy.muestra.piezas_requeridas)}. No se proyecta con falsa precisión.`}
            </p>
          )}
          {proy.emitida && (
            <p className="pr-muestra" data-testid="renta-proyeccion">
              <ChipEstado tono="info">Estimado</ChipEstado>{' '}
              {`Al ${etiquetaFecha(proy.fecha_corte)}: ${formatearPiezas(proy.mes_pz.central)} en el mes (rango ${formatearPiezas(proy.mes_pz.bajo)} a ${formatearPiezas(proy.mes_pz.alto)}), con base en ${proy.muestra.dias_con_envio} días con envío y ${formatearPiezas(proy.muestra.piezas)}.`}
            </p>
          )}
        </Tarjeta>

        <Tarjeta
          titulo="Piezas enviadas y renta por periodo"
          acciones={
            <Segmentado
              etiquetaAria="Periodo del desglose"
              tamano="chico"
              opciones={PASOS.map((p) => ({ valor: p, etiqueta: ETIQUETA_PASO[p], href: `${ruta}?paso=${p}`, activa: p === paso, testid: `paso-${p}` }))}
            />
          }
        >
          {conDato >= 2 ? (
            <ColumnasPiezas
              titulo={TITULO_PASO[paso]}
              descripcion={`${TITULO_PASO[paso]}. Total de la ventana: ${formatearPiezas(cubetas.reduce((s, c) => s + c.piezas, 0))}.`}
              pie={`Corte: ${etiquetaFecha(e.hoy)} · Fuente: devengos de renta · Periodo en curso con trama`}
              datos={visibles.map((c) => ({ id: c.id, etiqueta: c.etiqueta, valor: c.piezas, texto: formatearPiezas(c.piezas), parcial: c.parcial, detalle: `Renta ${m(c.renta_cent)}` }))}
            />
          ) : (
            <p className="a3-grafica-vacia"><strong>Pocos datos para hablar de esto</strong>Hay {conDato} {conDato === 1 ? 'periodo' : 'periodos'} con envíos; con dos o más se dibujan las columnas.</p>
          )}
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo={`Desglose ${paso === 'dia' ? 'por día' : paso === 'semana' ? 'por semana' : 'por mes'}`} descripcion="Piezas enviadas y renta devengada">
        <DataTable
          etiqueta="Desglose de la renta por periodo"
          plana
          clave={(c) => c.id}
          filas={[...visibles].reverse()}
          vacio={{ titulo: 'Sin envíos', texto: 'Aún no hay renta devengada en este periodo.' }}
          columnas={[
            { id: 'periodo', titulo: 'Periodo', celda: (c) => (paso === 'dia' ? etiquetaFecha(c.ini) : `${etiquetaFecha(c.ini)} al ${etiquetaFecha(c.fin)}${c.parcial ? ' (en curso)' : ''}`), prioridadMovil: 'titulo' },
            { id: 'piezas', titulo: 'Piezas', numerica: true, celda: (c) => formatearPiezas(c.piezas), prioridadMovil: 'normal' },
            { id: 'renta', titulo: 'Renta', numerica: true, celda: (c) => m(c.renta_cent), prioridadMovil: 'principal' },
          ]}
        />
      </Tarjeta>

      <Tarjeta plana titulo="Historial de pagos" descripcion={socio ? 'Pagos de renta registrados a Omar' : 'Pagos que has recibido por la renta'}>
        <div data-testid="renta-pagos">
          <DataTable
            etiqueta="Historial de pagos de renta"
            plana
            clave={(p) => p.folio}
            filas={pagos}
            vacio={{ titulo: 'Sin pagos registrados', texto: `Todavía no se registra ningún pago de renta ${deQuien === 'tuya' ? 'a tu favor' : 'a Omar'}.` }}
            columnas={columnasPagos}
          />
        </div>
      </Tarjeta>
      <p className="a3-pie">{socio ? 'Cifras de la cuenta 2210 (renta por pagar a Omar): devengado menos lo compensado con tomas y lo pagado. Los pagos bajan esa cuenta y quedan en el libro de socios.' : 'Cifras de tu cuenta de renta. Si un pago no aparece, avisa a los socios.'}</p>
    </Pagina>
  );
}
