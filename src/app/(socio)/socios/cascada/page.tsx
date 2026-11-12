import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { fechaNeg, semanaReporte, sumarDias } from '@/dominio/calendario';
import { centavosDesdeTexto } from '@/dominio/dinero';
import { etiquetaFecha } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso } from '@/ui/componentes/controles';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { BotonAccion, FormularioAccion } from '../../operacion/formulario-accion';
import { Dos, Estado, Pie, abs, m, pct } from '../../_a3/util';

export const metadata: Metadata = { title: 'Cascada de reparto' };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADO_CIERRE = { propuesto: 'Propuesto: faltan las dos firmas', firmado_por_uno: 'Firmado por uno: falta el otro socio', cerrado: 'Cerrado y firmado por los dos', anulado: 'Anulado' } as const;

export default async function PaginaCascada({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string; caja?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const sem = semanaReporte(hoy);
  const ini = q.ini && FECHA.test(q.ini) ? q.ini : sem.inicio;
  const fin = q.fin && FECHA.test(q.fin) ? q.fin : hoy;
  let caja = 0n;
  try { if (q.caja) caja = centavosDesdeTexto(q.caja); } catch { caja = 0n; }
  if (caja < 0n) caja = 0n;
  const lector = await operacionDeSocio();
  const [c, cierres] = await Promise.all([lector.cascadaProyeccion(ini, fin, caja), lector.cierresReparto()]);
  const ps = c.por_socio;
  const ant = semanaReporte(sumarDias(sem.inicio, -1));
  const terminado = fin < hoy;
  const pasos = [
    { id: 'e', etiqueta: 'Efectivo de la sociedad', valor: Number(c.efectivo.total_cent), tipo: 'inicio' as const, texto: m(c.efectivo.total_cent) },
    { id: 'r', etiqueta: 'Reembolsos', valor: -Number(c.reembolsos.pagado_cent), tipo: 'delta' as const, texto: m(-c.reembolsos.pagado_cent, true) },
    { id: 'a', etiqueta: 'Aportaciones devueltas', valor: -Number(c.aportaciones.pagado_cent), tipo: 'delta' as const, texto: m(-c.aportaciones.pagado_cent, true) },
    { id: 'u', etiqueta: 'Utilidad repartida', valor: -Number(c.repartible_cent), tipo: 'delta' as const, texto: m(-c.repartible_cent, true) },
    { id: 't', etiqueta: 'Efectivo que queda', valor: Number(c.remanente_cent), tipo: 'total' as const, texto: m(c.remanente_cent) },
  ];
  const liq = c.liquidar;
  const u = c.utilidad_detalle;
  const maxRes = abs(ps.Angelo.resultado_cent) > abs(ps.Javier.resultado_cent) ? abs(ps.Angelo.resultado_cent) : abs(ps.Javier.resultado_cent);
  const enlaceCaja = (i: string, f: string) => `/socios/cascada?ini=${i}&fin=${f}${caja > 0n ? `&caja=${Number(caja) / 100}` : ''}`;

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/socios', texto: 'Cuenta de socios' }}
        eyebrow="Cascada de reparto"
        titulo={`${c.en_vivo ? 'Proyección en vivo del' : 'Reparto del'} ${etiquetaFecha(ini)} al ${etiquetaFecha(fin)}`}
        descripcion="La empresa paga primero: reembolsos, luego aportaciones, y solo lo que queda se reparte 50/50, limitado por el efectivo. Utilidad no es caja."
        acciones={
          <>
            <nav className="rtm-seg" aria-label="Periodo">
              <Link href={enlaceCaja(sem.inicio, hoy)} aria-current={ini === sem.inicio && fin === hoy ? 'true' : undefined}>Esta semana (en vivo)</Link>
              <Link href={enlaceCaja(ant.inicio, ant.fin)} aria-current={ini === ant.inicio && fin === ant.fin ? 'true' : undefined} data-testid="semana-anterior">Semana anterior</Link>
            </nav>
            <form action="/socios/cascada" method="get" className="a3-filtros-form">
              <input type="hidden" name="ini" value={ini} /><input type="hidden" name="fin" value={fin} />
              <input className="rtm-campo rtm-campo-num" name="caja" inputMode="decimal" defaultValue={caja > 0n ? String(Number(caja) / 100) : ''} placeholder="Efectivo en la cuenta" aria-label="Efectivo en la cuenta de la sociedad" data-testid="caja" />
              <button type="submit" className="rtm-boton">Recalcular</button>
            </form>
          </>
        }
      />
      {c.utilidad_provisional && <Aviso tono="atencion" titulo="Utilidad provisional.">Hay guías sin costo real; la cifra se ajusta cuando se costeen.</Aviso>}
      {c.perdida_cent > 0n && <Aviso tono="atencion" titulo="Hay pérdida en el periodo.">{m(c.perdida_cent)}: no se reparte nada y se arrastra al periodo siguiente.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores del reparto"
        celdas={[
          { id: 'ut', etiqueta: '1. Utilidad neta del periodo', testid: 'utilidad-neta', valor: <CifraComprobada texto={m(c.utilidad_cent, c.utilidad_cent < 0n)} cifra={`cascada:utilidad:${ini}:${fin}`} comprobacion="cuadra" />, categoria: 2, nota: c.utilidad_provisional ? 'Provisional' : 'Neta de todos los gastos' },
          { id: 'ef', etiqueta: '2. Efectivo disponible', valor: m(c.efectivo.total_cent), categoria: 1, partes: c.efectivo.total_cent > 0n ? [{ etiqueta: 'En poder de los socios', valor: Number(c.efectivo.en_poder_cent) }, { etiqueta: 'En la cuenta de la sociedad', valor: Number(c.efectivo.caja_cent) }] : undefined, nota: c.limitado_por_efectivo ? 'El reparto queda limitado por el efectivo' : `Socios ${m(c.efectivo.en_poder_cent)} · cuenta ${m(c.efectivo.caja_cent)}` },
          { id: 're', etiqueta: 'Reembolsos pagados', valor: m(c.reembolsos.pagado_cent), categoria: 6, progreso: c.reembolsos.pendiente_cent > 0n ? { pct: pct(c.reembolsos.pagado_cent, c.reembolsos.pendiente_cent) ?? 0 } : undefined, nota: `Pendientes ${m(c.reembolsos.pendiente_cent)}` },
          { id: 'ap', etiqueta: 'Aportaciones devueltas', valor: m(c.aportaciones.pagado_cent), categoria: 4, progreso: c.aportaciones.pendiente_cent > 0n ? { pct: pct(c.aportaciones.pagado_cent, c.aportaciones.pendiente_cent) ?? 0 } : undefined, nota: `Pendientes ${m(c.aportaciones.pendiente_cent)}` },
          { id: 'rp', etiqueta: 'Utilidad repartible 50/50', valor: <span data-testid="repartible">{m(c.repartible_cent)}</span>, categoria: 7, nota: `Queda en la sociedad ${m(c.remanente_cent)}` },
        ]}
      />
      <FilaRatios
        etiqueta="Detalle de la utilidad"
        items={[
          { etiqueta: `Utilidad de pedidos (${u.pedidos})`, valor: m(u.utilidad_pedidos_cent, u.utilidad_pedidos_cent < 0n) },
          { etiqueta: 'Utilidad de tomas de Omar', valor: m(u.utilidad_tomas_cent, u.utilidad_tomas_cent < 0n) },
          { etiqueta: 'Gastos del periodo', valor: m(u.gastos_cent) },
          { etiqueta: 'Suma asignada a los dos', valor: m(c.suma_asignada_cent) },
          { etiqueta: 'Identidad', valor: <Estado tono={c.identidad_cuadra ? 'ok' : 'malo'}>{c.identidad_cuadra ? 'Cuadra' : 'No cuadra'}</Estado> },
        ]}
      />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Del efectivo de la sociedad a lo que queda" descripcion="La cascada completa del periodo">
          <Cascada titulo="Cascada de reparto" descripcion={`Efectivo ${m(c.efectivo.total_cent)}; reembolsos ${m(c.reembolsos.pagado_cent)}; aportaciones ${m(c.aportaciones.pagado_cent)}; utilidad repartida ${m(c.repartible_cent)}; queda ${m(c.remanente_cent)}.`} pasos={pasos} unidad="Pesos" />
        </Tarjeta>
        <Tarjeta titulo="3. Orden de pago con ese efectivo" descripcion="Cada paso se paga con lo que dejó el anterior">
          <ListaClaveValor items={[
            { k: `a. Reembolsos (${m(c.reembolsos.pendiente_cent)} pendientes)`, v: m(c.reembolsos.pagado_cent) },
            { k: `b. Aportaciones (${m(c.aportaciones.pendiente_cent)} pendientes)`, v: m(c.aportaciones.pagado_cent) },
            { k: 'c. Utilidad repartible 50/50', v: m(c.repartible_cent) },
            { k: 'Efectivo que queda', v: <strong>{m(c.remanente_cent)}</strong> },
          ]} />
          <p className="a3-sub">Con qué se paga el efectivo</p>
          <BarList etiquetaAria="Uso del efectivo" items={[
            { id: 'r', etiqueta: 'Reembolsos', texto: m(c.reembolsos.pagado_cent), pct: pct(c.reembolsos.pagado_cent, c.efectivo.total_cent) },
            { id: 'a', etiqueta: 'Aportaciones devueltas', texto: m(c.aportaciones.pagado_cent), pct: pct(c.aportaciones.pagado_cent, c.efectivo.total_cent) },
            { id: 'u', etiqueta: 'Utilidad repartida', texto: m(c.repartible_cent), pct: pct(c.repartible_cent, c.efectivo.total_cent) },
            { id: 'q', etiqueta: 'Queda en la sociedad', texto: m(c.remanente_cent), pct: pct(c.remanente_cent, c.efectivo.total_cent) },
          ]} />
          <Pie>El centavo suelto de un reparto va a favor de quien paga o aporta más.</Pie>
        </Tarjeta>
      </Rejilla>

      <Tarjeta plana titulo="4. Resultado por socio" descripcion="Lo que corresponde a cada uno y lo que tiene o debe">
          <DataTable
            etiqueta="Resultado por socio"
            densidad="densa" plana primeraFija
            clave={(s) => s}
            filas={['Angelo', 'Javier'] as const}
            totales={{ etiqueta: 'Suma', celdas: { r: m(ps.Angelo.paga_reembolso_cent + ps.Javier.paga_reembolso_cent), a: m(ps.Angelo.paga_aportacion_cent + ps.Javier.paga_aportacion_cent), u: m(ps.Angelo.utilidad_cent + ps.Javier.utilidad_cent), t: m(c.suma_asignada_cent), x: m(c.suma_resultados_cent, true) } }}
            columnas={[
              { id: 's', titulo: 'Socio', ancho: 'm', celda: (s) => s },
              { id: 'r', titulo: 'Reembolsos', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(ps[s].paga_reembolso_cent) },
              { id: 'a', titulo: 'Aportaciones', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(ps[s].paga_aportacion_cent) },
              { id: 'u', titulo: 'Su parte de la utilidad', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(ps[s].utilidad_cent) },
              { id: 't', titulo: 'Le corresponde', numerica: true, ancho: 'm', celda: (s) => m(ps[s].asignado_cent) },
              { id: 'p', titulo: 'Tiene o debe', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(ps[s].debe_cent) },
              { id: 'x', titulo: 'Resultado', numerica: true, ancho: 'l', celda: (s) => <Dos a={<CifraComprobada texto={m(ps[s].resultado_cent, true)} cifra={`cascada:resultado:${s}:${ini}:${fin}:${caja}`} comprobacion="cuadra" />} b={ps[s].resultado_cent > 0n ? 'Recibe' : ps[s].resultado_cent < 0n ? 'Entrega' : 'En paz'} /> },
            ]}
          />
      </Tarjeta>

      <Rejilla dividir="4-8">
        <div className="a3-pila">
        <Tarjeta titulo="Resultado de cada socio" descripcion="Recibe o entrega, en magnitud">
          <BarList etiquetaAria="Resultado por socio" items={(['Angelo', 'Javier'] as const).map((s) => ({ id: s, etiqueta: s, texto: m(ps[s].resultado_cent, true), pct: maxRes > 0n ? pct(abs(ps[s].resultado_cent), maxRes) : null, nota: ps[s].resultado_cent > 0n ? 'Recibe' : ps[s].resultado_cent < 0n ? 'Entrega' : 'En paz', tono: ps[s].resultado_cent < 0n ? 'malo' : undefined }))} />
          <Pie>Identidad: lo que se asigna a los dos ({m(c.suma_asignada_cent)}) es exactamente el efectivo repartido.</Pie>
        </Tarjeta>
        <Tarjeta titulo="5. Saldo entre socios">
          <p data-testid="saldo-entre-socios">{liq ? <>{liq.de} entrega {m(liq.monto_cent)} a {liq.a} y quedan en paz.</> : 'Los dos resultados están en cero: no hay nada que liquidar entre socios.'}</p>
          {liq && (
            <div className="a3-acciones">
              <FormularioAccion boton="Registrar liquidación entre socios" titulo="Liquidación entre socios" confirmar="Registrar liquidación" accion="registrar_liquidacion_entre_socios" testid="liquidar-cascada"
                fijos={{ p_de: liq.de, p_a: liq.a, p_monto_cent: Number(liq.monto_cent) }} campos={[{ nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto', defecto: `Cascada ${ini} al ${fin}` }]}
                nota={`${liq.de} entrega ${m(liq.monto_cent)} a ${liq.a}.`} />
            </div>
          )}
          {terminado ? (
            <div className="a3-acciones">
              <FormularioAccion boton="Proponer cierre de este periodo" titulo="Proponer el cierre del reparto" confirmar="Proponer cierre" accion="proponer_cierre_reparto" primario testid="proponer-cierre"
                fijos={{ p_ini: ini, p_fin: fin, p_caja_cent: Number(caja) }} campos={[{ nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' }]}
                nota="Congela las cifras de arriba. Surte efecto cuando firman los dos socios; antes de eso se puede anular." />
            </div>
          ) : <Pie>El periodo aún no termina: se puede proponer el cierre a partir del {etiquetaFecha(sumarDias(fin, 1))}. Mientras tanto esta vista es una proyección.</Pie>}
        </Tarjeta>
        </div>
        <Tarjeta plana titulo="Cierre firmado por los dos" descripcion="Cada cierre congela las cifras y requiere las dos firmas">
          <DataTable
            etiqueta="Cierres de reparto"
            densidad="densa" plana
            clave={(x) => x.id}
            filas={cierres}
            vacio={{ titulo: 'Sin cierres', texto: 'Cuando se proponga y firme un cierre aparecerá aquí con las dos firmas.' }}
            columnas={[
              { id: 'f', titulo: 'Folio', ancho: 'm', celda: (x) => <span className="rtm-mono">{x.folio}</span> },
              { id: 'p', titulo: 'Periodo', ancho: 'l', celda: (x) => `${etiquetaFecha(x.periodo_ini)} al ${etiquetaFecha(x.periodo_fin)}` },
              { id: 'u', titulo: 'Utilidad', numerica: true, ancho: 'm', secundaria: true, celda: (x) => m(x.utilidad_cent) },
              { id: 'e', titulo: 'Estado', ancho: 'xl', celda: (x) => <Dos a={<Estado tono={x.estado === 'cerrado' ? 'ok' : x.estado === 'anulado' ? 'neutro' : 'atencion'}>{ESTADO_CIERRE[x.estado]}</Estado>} b={x.firmas.length > 0 ? `Firmas: ${x.firmas.map((f) => f.socio).join(' y ')}` : 'Sin firmas'} /> },
              { id: 'a', titulo: '', ancho: 'l', celda: (x) => (x.estado === 'propuesto' || x.estado === 'firmado_por_uno' ? (
                  <span className="rtm-acciones-fila">
                    {!x.yo_firme && <BotonAccion chico primario texto="Firmar" titulo={`Firmar ${x.folio}`} confirmarTexto="Firmar" accion="firmar_cierre_reparto" args={{ p_cierre: x.id }} testid={`firmar-${x.folio}`} />}
                    <BotonAccion chico texto="Anular" accion="anular_cierre_reparto" args={{ p_cierre: x.id }} motivo="Motivo" titulo={`Anular ${x.folio}`} />
                  </span>) : null) },
            ]}
          />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
