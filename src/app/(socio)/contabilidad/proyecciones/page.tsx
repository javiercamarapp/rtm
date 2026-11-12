import type { Metadata } from 'next';
import { operacionDeSocio } from '@/composicion/operacion';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { serieSemanalDeSocio } from '@/composicion/contabilidad-serie';
import { diaSemanaLunes0, fechaNeg, sumarDias } from '@/dominio/calendario';
import { etiquetaFecha } from '@/dominio/formato';
import type { FlujoInsumo } from '@/dominio/reportes/insumos';
import { LEYENDA_ESCENARIO, LEYENDA_ESTIMADO, coberturaViernes, diasEntre, escenarioCosto, flujoCaja, promedioMovilExponencial, tendenciaLineal, type Proyeccion } from '@/dominio/reportes/proyecciones';
import { PARAMETROS } from '@/dominio/reportes/parametros';
import { Aviso } from '@/ui/componentes/controles';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { LineaProyeccion } from '@/ui/graficas';
import { Estado, Pie, fechaCorta, m, pct } from '../../_a3/util';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Proyecciones y estimaciones' };

const aBig = (x: number) => BigInt(Math.round(x));
const num = (b: bigint) => Number(b);
const razon = (p: Proyeccion<unknown>): string => (p.emite ? '' : p.razon);

export default async function PaginaProyecciones() {
  const hoy = fechaNeg(new Date());
  const [serie, v, lector] = await Promise.all([serieSemanalDeSocio(26).catch(() => null), (await contabilidadDeSocio()).valuacion(hoy).catch(() => null), operacionDeSocio()]);
  const [cxc, hojaI, hojaK, omar] = await Promise.all([lector.cuentasPorCobrar().catch(() => null), lector.hojaProveedor('Isaac', null, 'sociedad').catch(() => null), lector.hojaProveedor('Karen', null, 'sociedad').catch(() => null), lector.omarCuenta(null).catch(() => null)]);

  const completas = (serie?.semanas ?? []).filter((s) => !s.parcial);
  // Semanas con historia real: desde la primera con movimientos (antes no hay negocio que proyectar).
  const primera = completas.findIndex((s) => s.con_movimientos);
  const historia = primera < 0 ? [] : completas.slice(primera);
  const inicios = historia.map((s) => s.ini);
  const cobros = historia.map((s) => num(s.cobros_clientes_cent));
  const utilidad = historia.map((s) => num(s.utilidad_neta_cent));
  const ventas = historia.map((s) => num(s.ventas_netas_cent));
  const piezas = historia.map((s) => s.piezas_vendidas);
  const nHist = historia.length;
  const faltan = (min: number) => Math.max(0, min - nHist);

  const pCobros = promedioMovilExponencial(cobros, 4, inicios);
  const pUtil = promedioMovilExponencial(utilidad, 4, inicios);
  const pVentas = promedioMovilExponencial(ventas, 4, inicios);
  const pPiezas = promedioMovilExponencial(piezas, 4, inicios);
  const tUtil = tendenciaLineal(utilidad, 4, inicios);

  // Flujo de caja a 4 semanas con compromisos conocidos.
  const fondos = v?.l01_liquidez_cent ?? null;
  const viernes = sumarDias(hoy, (4 - diaSemanaLunes0(hoy) + 7) % 7);
  const idxViernes = Math.min(3, Math.floor(diasEntre(hoy, viernes) / 7));
  const porPagarViernes = [hojaI, hojaK].reduce((a, h) => a + (h && h.totales.falta_por_saldar_cent > 0n ? h.totales.falta_por_saldar_cent : 0n), 0n);
  const prometidos = [0n, 0n, 0n, 0n];
  for (const f of cxc?.filas ?? []) {
    if (f.saldo_cent <= 0n || !f.vence || f.vence < hoy) continue;
    const i = Math.floor(diasEntre(hoy, f.vence) / 7);
    if (i >= 0 && i < 4) prometidos[i] = prometidos[i]! + f.saldo_cent;
  }
  const hastaViernes = (cxc?.filas ?? []).filter((f) => f.saldo_cent > 0n && f.vence && f.vence >= hoy && f.vence <= viernes).reduce((a, f) => a + f.saldo_cent, 0n);
  const recientes = historia.slice(-4);
  const prom = (xs: readonly bigint[]) => (xs.length === 0 ? 0n : aBig(xs.reduce((a, b) => a + num(b), 0) / xs.length));
  const gastoSemanal = prom(recientes.map((s) => s.gastos_cent));
  const pagoProvSemanal = prom(recientes.map((s) => (s.pagos_proveedores_cent < 0n ? -s.pagos_proveedores_cent : 0n)));
  const omarPaga = omar && omar.neto_cent > 0n ? omar.neto_cent : 0n;
  const insumo: FlujoInsumo | null = fondos === null ? null : {
    saldoInicialCent: fondos,
    cobrosSemanalesCent: historia.map((s) => s.cobros_clientes_cent),
    cobrosPrometidosCent: prometidos,
    pagosProveedorCent: [0, 1, 2, 3].map((i) => (i === idxViernes ? (porPagarViernes > pagoProvSemanal ? porPagarViernes : pagoProvSemanal) : pagoProvSemanal)),
    omarCent: [omarPaga, 0n, 0n, 0n],
    gastosCent: [gastoSemanal, gastoSemanal, gastoSemanal, gastoSemanal],
  };
  const flujo = insumo ? flujoCaja(insumo) : null;
  const cobertura = fondos === null ? null : coberturaViernes(fondos, hastaViernes, porPagarViernes);

  // Sensibilidad al costo: escenario sobre las cuatro semanas proyectadas.
  const escenariosTodos = pPiezas.emite && pUtil.emite && pVentas.emite
    ? PARAMETROS.escenarios.deltasCostoCent.map((d) => escenarioCosto({ piezasProyectadas: Math.max(0, Math.round(pPiezas.datos.central * 4)), utilidadProyectadaCent: aBig(pUtil.datos.central * 4), ventasProyectadasCent: aBig(pVentas.datos.central * 4), deltaCostoCent: d, lineas: [] }))
    : null;
  const escenarios = escenariosTodos && escenariosTodos.every((e) => e.emite) ? escenariosTodos.map((e, i) => ({ i, e })) : null;

  // Grafica de caja: ultimos saldos observados y 4 semanas estimadas.
  const obsCaja = (serie?.semanas ?? []).filter((s) => !s.parcial && s.con_movimientos).slice(-6);
  const puntosCaja = flujo && flujo.emite ? [
    ...obsCaja.map((s) => ({ id: s.ini, etiqueta: fechaCorta(s.ini), valor: num(s.saldo_final_cent), texto: m(s.saldo_final_cent, true), tipo: 'observado' as const })),
    ...flujo.datos.semanas.map((s) => ({ id: `s${s.semana}`, etiqueta: `+${s.semana} sem`, valor: num(s.saldoCent), texto: m(s.saldoCent, true), tipo: 'estimado' as const, bajo: num(s.saldoLoCent), alto: num(s.saldoHiCent) })),
  ] : [];
  const puntosUtil = pUtil.emite ? [
    ...historia.slice(-6).map((s) => ({ id: s.ini, etiqueta: fechaCorta(s.ini), valor: num(s.utilidad_neta_cent), texto: m(s.utilidad_neta_cent, true), tipo: 'observado' as const })),
    ...pUtil.datos.puntos.map((p) => ({ id: `u${p.h}`, etiqueta: `+${p.h} sem`, valor: p.central, texto: m(aBig(p.central), true), tipo: 'estimado' as const, bajo: p.lo, alto: p.hi })),
  ] : [];

  const MIN = PARAMETROS.minSemanasEma;
  const mayorBarra = [fondos ?? 0n, hastaViernes, porPagarViernes].reduce((a, b) => (b > a ? b : a), 1n);
  const coberturaTexto = cobertura === null ? null : `${(Number(cobertura) / 1000).toFixed(2)} veces`;
  const coberturaOk = cobertura !== null && cobertura >= PARAMETROS.coberturaViernesVerde;

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · proyecciones y estimaciones"
        titulo={pCobros.emite || pUtil.emite ? 'Estimaciones a cuatro semanas' : 'Sin historia no hay proyección'}
        descripcion={`Todo lo estimado va etiquetado «Estimado», con rango y muestra mínima. Historia disponible: ${nHist} ${nHist === 1 ? 'semana completa' : 'semanas completas'} (mínimo ${MIN}).`}
      />
      {nHist < MIN && <Aviso tono="info" titulo="Pocas semanas de historia.">No se estima hasta tener {MIN} semanas completas con movimientos; faltan {faltan(MIN)}. Con un solo día de ventas no se inventa un futuro.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores de proyección"
        celdas={[
          { id: 'hist', etiqueta: 'Historia disponible', valor: `${nHist} ${nHist === 1 ? 'semana' : 'semanas'}`, categoria: 1, progreso: { pct: Math.min(100, (nHist / MIN) * 100), meta: 100 }, nota: nHist >= MIN ? 'Muestra mínima alcanzada' : `Faltan ${faltan(MIN)} para estimar` },
          { id: 'cobros', etiqueta: 'Cobros esperados por semana', valor: pCobros.emite ? m(aBig(pCobros.datos.central)) : null, categoria: 2, nota: pCobros.emite ? `Estimado · rango ${m(aBig(pCobros.datos.puntos[0]!.lo))} a ${m(aBig(pCobros.datos.puntos[0]!.hi))}` : razon(pCobros) },
          { id: 'util', etiqueta: 'Utilidad esperada por semana', valor: pUtil.emite ? m(aBig(pUtil.datos.central), true) : null, categoria: 7, nota: pUtil.emite ? `Estimado · rango ${m(aBig(pUtil.datos.puntos[0]!.lo), true)} a ${m(aBig(pUtil.datos.puntos[0]!.hi), true)}` : razon(pUtil) },
          { id: 'cob', etiqueta: 'Cobertura del viernes', valor: coberturaTexto, categoria: 4, nota: cobertura === null ? (fondos === null ? 'Sin dato de fondos' : 'Nada por pagar el viernes') : <Estado tono={coberturaOk ? 'ok' : 'atencion'}>{coberturaOk ? 'Cubierto' : 'Justo'}</Estado> },
        ]}
      />
      <FilaRatios
        etiqueta="Compromisos conocidos"
        items={[
          { etiqueta: `Por pagar el viernes ${etiquetaFecha(viernes)}`, valor: porPagarViernes > 0n ? m(porPagarViernes) : null },
          { etiqueta: 'Fondos de la sociedad hoy', valor: fondos === null ? null : m(fondos) },
          { etiqueta: 'Cobros prometidos hasta el viernes', valor: cxc ? m(hastaViernes) : null },
          { etiqueta: 'Omar nos cobra', valor: omar ? m(omarPaga) : null },
        ]}
      />

      <Rejilla dividir="6-6">
        <div data-testid="proyeccion-bloque"><Tarjeta titulo="Flujo de caja a 4 semanas" descripcion="Cobros esperados contra pagos conocidos; la banda es el rango" acciones={<Estado tono="atencion">Estimado</Estado>}>
          {puntosCaja.length >= 2 ? (
            <LineaProyeccion titulo="Saldo de fondos proyectado" descripcion="Saldo de fondos de las últimas semanas y proyección a cuatro semanas con rango." unidad="Pesos" procedencia="estimado" pie={`Corte: ${etiquetaFecha(hoy)} · ${LEYENDA_ESTIMADO} · método: ${flujo && flujo.emite ? flujo.metodo : ''}`} puntos={puntosCaja} />
          ) : (
            <p className="a3-grafica-vacia"><strong>{flujo === null ? 'Sin dato de fondos' : 'No se estima'}</strong>{flujo === null ? 'Hace falta la liquidez de la sociedad para proyectar la caja.' : razon(flujo)}</p>
          )}
        </Tarjeta></div>
        <Tarjeta titulo="Cobertura del viernes" descripcion="(fondos + cobros esperados) ÷ por pagar al proveedor">
          <BarList
            etiquetaAria="Con qué se paga el viernes"
            items={[
              { id: 'fon', etiqueta: 'Fondos de la sociedad', texto: fondos === null ? 'Sin dato' : m(fondos), pct: fondos === null ? null : pct(fondos, mayorBarra) },
              { id: 'cob', etiqueta: 'Cobros con fecha hasta el viernes', texto: cxc ? m(hastaViernes) : 'Sin dato', pct: cxc ? pct(hastaViernes, mayorBarra) : null },
              { id: 'pag', etiqueta: 'Por pagar el viernes', texto: porPagarViernes > 0n ? m(porPagarViernes) : 'Sin dato', pct: porPagarViernes > 0n ? pct(porPagarViernes, mayorBarra) : null, tono: 'malo' },
            ]}
            mostrarPct={false}
          />
          <ListaClaveValor items={[
            { k: 'Cobertura', v: coberturaTexto ?? <span className="rtm-sin-dato">Sin dato</span> },
            { k: 'Umbral verde', v: `${(Number(PARAMETROS.coberturaViernesVerde) / 1000).toFixed(2)} veces` },
            { k: 'Por pagar', v: porPagarViernes > 0n ? m(porPagarViernes) : <span className="rtm-sin-dato">Sin dato</span> },
          ]} />
          <Pie>Incluye solo compromisos conocidos (liquidación del viernes, cobros con fecha y la cuenta de Omar); el resto se estima con el promedio de las últimas semanas.</Pie>
        </Tarjeta>
      </Rejilla>

      {flujo && flujo.emite && (
        <Tarjeta plana titulo="Detalle del flujo a 4 semanas" descripcion={`${flujo.metodo}. ${flujo.leyenda}`}>
          <DataTable
            etiqueta="Flujo de caja proyectado"
            densidad="densa" plana primeraFija
            clave={(s) => s.semana}
            filas={[...flujo.datos.semanas]}
            columnas={[
              { id: 's', titulo: 'Semana', ancho: 'm', celda: (s) => `+${s.semana} · ${s.clase}` },
              { id: 'c', titulo: 'Cobros', bloque: 'Entradas', numerica: true, ancho: 'm', celda: (s) => m(s.cobrosCent) },
              { id: 'p', titulo: 'Proveedores', bloque: 'Salidas', numerica: true, ancho: 'm', celda: (s) => m(s.pagosProvCent) },
              { id: 'o', titulo: 'Omar', bloque: 'Salidas', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(s.omarCent) },
              { id: 'g', titulo: 'Gastos', bloque: 'Salidas', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(s.gastosCent) },
              { id: 'sa', titulo: 'Saldo', bloque: 'Saldo estimado', numerica: true, ancho: 'm', celda: (s) => m(s.saldoCent, true) },
              { id: 'r', titulo: 'Rango', bloque: 'Saldo estimado', numerica: true, ancho: 'l', secundaria: true, celda: (s) => `${m(s.saldoLoCent, true)} a ${m(s.saldoHiCent, true)}` },
            ]}
          />
        </Tarjeta>
      )}

      <Rejilla dividir="6-6">
        <div data-testid="proyeccion-bloque"><Tarjeta titulo="Utilidad proyectada" descripcion="Promedio móvil exponencial con rango al 80 %" acciones={<Estado tono="atencion">Estimado</Estado>}>
          {puntosUtil.length >= 2 ? (
            <LineaProyeccion titulo="Utilidad neta semanal proyectada" descripcion="Utilidad neta de las últimas semanas y proyección a cuatro semanas con rango." unidad="Pesos" procedencia="estimado" pie={`Corte: ${etiquetaFecha(hoy)} · ${LEYENDA_ESTIMADO}${tUtil.emite && tUtil.datos.usaTendencia ? ' · hay tendencia significativa' : ''}`} puntos={puntosUtil} />
          ) : (
            <p className="a3-grafica-vacia"><strong>No se estima</strong>{razon(pUtil) || `Faltan ${faltan(MIN)} semanas (mínimo ${MIN}).`}</p>
          )}
        </Tarjeta></div>
        <div data-testid="proyeccion-bloque"><Tarjeta titulo="Sensibilidad al costo de Isaac y Karen" descripcion={`${LEYENDA_ESCENARIO}; cuatro semanas proyectadas`} acciones={<Estado tono="info">Escenario</Estado>}>
          {escenarios ? (
            <DataTable
              etiqueta="Escenarios de costo"
              densidad="densa" plana
              clave={(x) => x.i}
              filas={escenarios}
              columnas={[
                { id: 'd', titulo: 'Sube el costo', ancho: 'm', celda: ({ e }) => (e.emite ? `+${m(e.datos.deltaCostoCent)} por pieza` : <span className="rtm-sin-dato">Sin dato</span>) },
                { id: 'i', titulo: 'Efecto en utilidad', numerica: true, ancho: 'm', celda: ({ e }) => (e.emite ? m(e.datos.impactoCent, true) : '') },
                { id: 'u', titulo: 'Utilidad nueva', numerica: true, ancho: 'm', celda: ({ e }) => (e.emite ? m(e.datos.utilidadNuevaCent, true) : '') },
                { id: 'mg', titulo: 'Margen nuevo', numerica: true, ancho: 's', secundaria: true, celda: ({ e }) => (e.emite ? `${(Number(e.datos.margenNuevoBp) / 100).toFixed(1)} %` : '') },
              ]}
            />
          ) : (
            <p className="a3-grafica-vacia"><strong>No se estima</strong>Se calcula sobre las piezas, las ventas y la utilidad proyectadas; hacen falta {MIN} semanas de historia con ventas y piezas vendidas (hay {nHist}).</p>
          )}
          <Pie>Escenario con supuesto explícito, sin probabilidad: el efecto es piezas proyectadas por el aumento de costo; no separa a Isaac de Karen porque la utilidad no se divide por proveedor.</Pie>
        </Tarjeta></div>
      </Rejilla>

      <div data-testid="proyeccion-bloque"><Tarjeta titulo="Punto de reorden" descripcion="Cuánto y cuándo reponer cada modelo según su rotación y el tiempo de entrega" acciones={<Estado tono="apagado">Sin dato</Estado>}>
        <p className="a3-grafica-vacia"><strong>Se calcula por modelo</strong>Necesita al menos {PARAMETROS.reorden.minSemanasModelo} semanas de ventas por modelo, {PARAMETROS.reorden.minPiezas} piezas y el tiempo de entrega de cada proveedor. Aparecerá con la historia de inventario; hoy no se inventa ningún punto.</p>
      </Tarjeta></div>
    </Pagina>
  );
}
