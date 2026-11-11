import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { fechaNeg, semanaReporte, sumarDias } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { etiquetaHoy } from '../../contexto';
import { BotonAccion, FormularioAccion } from '../../operacion/formulario-accion';

export const metadata: Metadata = { title: 'Cascada de reparto' };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ESTADO_CIERRE = { propuesto: 'Propuesto: faltan las dos firmas', firmado_por_uno: 'Firmado por uno: falta el otro socio', cerrado: 'Cerrado y firmado por los dos', anulado: 'Anulado' } as const;

export default async function Pagina({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const sem = semanaReporte(hoy);
  const ini = q.ini && FECHA.test(q.ini) ? q.ini : sem.inicio;
  const fin = q.fin && FECHA.test(q.fin) ? q.fin : hoy;
  const lector = await operacionDeSocio();
  const [c, cierres] = await Promise.all([lector.cascadaProyeccion(ini, fin), lector.cierresReparto()]);
  const ps = c.por_socio;
  const ant = semanaReporte(sumarDias(sem.inicio, -1));
  const terminado = fin < hoy;
  const pasos = [
    { id: 'e', etiqueta: 'Efectivo de la sociedad', valor: Number(c.efectivo.total_cent), tipo: 'inicio' as const, texto: formatearMoneda(c.efectivo.total_cent) },
    { id: 'r', etiqueta: 'Reembolsos', valor: -Number(c.reembolsos.pagado_cent), tipo: 'delta' as const, texto: formatearMoneda(-c.reembolsos.pagado_cent, { conSigno: true }) },
    { id: 'u', etiqueta: 'Utilidad repartida', valor: -Number(c.repartible_cent - Object.values(ps).reduce((a, x) => a + x.anticipo_cent, 0n)), tipo: 'delta' as const, texto: formatearMoneda(-(c.repartible_cent - Object.values(ps).reduce((a, x) => a + x.anticipo_cent, 0n)), { conSigno: true }) },
    { id: 't', etiqueta: 'Efectivo que queda', valor: Number(c.remanente_cent), tipo: 'total' as const, texto: formatearMoneda(c.remanente_cent) },
  ];
  const liq = c.liquidar;

  return (
    <>
      <p className="rtm-migaja"><Link href="/socios">Cuenta de socios</Link> / Cascada de reparto</p>
      <EncabezadoPagina
        eyebrow={`Cascada de reparto · ${etiquetaHoy()}`}
        antes={c.en_vivo ? 'Proyección en vivo del' : 'Reparto del'}
        enfasis={`${etiquetaFecha(ini)} al ${etiquetaFecha(fin)}`}
        contexto="La empresa paga primero: reembolsos de gastos pagados por socios y solo lo que queda se reparte 50/50, limitado por el efectivo. Las pérdidas y la utilidad que no se pudo repartir pasan al siguiente periodo. El capital solo se devuelve con un retiro de capital acordado por los dos."
      />
      <div className="rtm-acciones-fila">
        <div className="rtm-segmentado" role="group" aria-label="Periodo">
          <Link href={`/socios/cascada?ini=${sem.inicio}&fin=${hoy}`} aria-current={ini === sem.inicio && fin === hoy}>Esta semana (en vivo)</Link>
          <Link href={`/socios/cascada?ini=${ant.inicio}&fin=${ant.fin}`} aria-current={ini === ant.inicio && fin === ant.fin} data-testid="semana-anterior">Semana anterior</Link>
        </div>
      </div>

      <section className="rtm-seccion rtm-entra rtm-i-1" aria-label="Paso 1 y 2: utilidad y efectivo">
        <h2>1. Utilidad neta del periodo</h2>
        <p className="rtm-hero-cifra" data-testid="utilidad-neta"><CifraComprobada texto={formatearMoneda(c.utilidad_cent, { conSigno: c.utilidad_cent < 0n })} cifra={`cascada:utilidad:${ini}:${fin}`} comprobacion="cuadra" /></p>
        <p className="rtm-nota">Ya neta de todos los gastos, incluidos los que pagó un socio.{c.utilidad_provisional ? ' Es provisional: hay guías sin costo real.' : ''}{c.perdida_cent > 0n ? ` Hay pérdida de ${formatearMoneda(c.perdida_cent)}: no se reparte nada.` : ''}</p>
        <h2>2. Límite por efectivo disponible</h2>
        <p className="rtm-nota" data-testid="efectivo-calculado">Efectivo total (calculado de las cajas, no tecleado): {formatearMoneda(c.efectivo.en_poder_cent)} en poder de los socios + {formatearMoneda(c.efectivo.caja_cent)} en las cajas de efectivo = <strong>{formatearMoneda(c.efectivo.total_cent)}</strong>. Comprometido (proveedores, dinero de clientes sin aplicar y reserva): {formatearMoneda(c.efectivo.comprometido_cent)}. Disponible para repartir: <strong>{formatearMoneda(c.efectivo.disponible_cent)}</strong>.{c.limitado_por_efectivo ? ' El reparto queda limitado por el efectivo.' : ''}</p>
        <p className="rtm-nota">Utilidad acumulada: {formatearMoneda(c.utilidad_cent)} del periodo {c.arrastre_ini_cent >= 0n ? '+' : '-'} {formatearMoneda(c.arrastre_ini_cent < 0n ? -c.arrastre_ini_cent : c.arrastre_ini_cent)} de arrastre = {formatearMoneda(c.utilidad_acumulada_cent)}. Pasa al siguiente periodo: {formatearMoneda(c.arrastre_fin_cent, { conSigno: true })}.</p>
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Paso 3: orden de pago">
        <h2>3. Orden de pago con ese efectivo</h2>
        <ol className="rtm-cascada" aria-label="Orden de pago">
          <li><span>a. Reembolsos de gastos pagados por socios ({formatearMoneda(c.reembolsos.pendiente_cent)} pendientes)</span><span>{formatearMoneda(c.reembolsos.pagado_cent)}</span></li>
          <li><span>b. Utilidad repartible 50/50 (el capital aportado, {formatearMoneda(c.aportaciones.pendiente_cent)}, no se devuelve solo)</span><span data-testid="repartible">{formatearMoneda(c.repartible_cent)}</span></li>
          <li data-total><span>Efectivo que queda en la sociedad</span><span>{formatearMoneda(c.remanente_cent)}</span></li>
        </ol>
        <Cascada titulo="Del efectivo de la sociedad a lo que queda" descripcion={`Efectivo ${formatearMoneda(c.efectivo.total_cent)}; reembolsos ${formatearMoneda(c.reembolsos.pagado_cent)}; utilidad repartida ${formatearMoneda(c.repartible_cent)}; queda ${formatearMoneda(c.remanente_cent)}.`} pasos={pasos} unidad="Pesos" />
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Paso 4: resultado por socio">
        <h2>4. Resultado por socio</h2>
        <DataTable
          etiqueta="Resultado por socio"
          clave={(s) => s}
          filas={['Angelo', 'Javier'] as const}
          columnas={[
            { id: 's', titulo: 'Socio', celda: (s) => s },
            { id: 'r', titulo: 'Reembolsos', numerica: true, secundaria: true, celda: (s) => formatearMoneda(ps[s].paga_reembolso_cent) },
            { id: 'a', titulo: 'Retiros ya recibidos', numerica: true, secundaria: true, celda: (s) => formatearMoneda(ps[s].anticipo_cent) },
            { id: 'u', titulo: 'Su parte de la utilidad', numerica: true, secundaria: true, celda: (s) => formatearMoneda(ps[s].utilidad_cent) },
            { id: 't', titulo: 'Le corresponde', numerica: true, celda: (s) => formatearMoneda(ps[s].asignado_cent) },
            { id: 'p', titulo: 'Tiene o debe', numerica: true, secundaria: true, celda: (s) => formatearMoneda(ps[s].debe_cent) },
            { id: 'x', titulo: 'Resultado', numerica: true, celda: (s) => <><CifraComprobada texto={formatearMoneda(ps[s].resultado_cent, { conSigno: true })} cifra={`cascada:resultado:${s}:${ini}:${fin}`} comprobacion="cuadra" /><span className="rtm-celda-sub">{ps[s].resultado_cent > 0n ? 'Recibe' : ps[s].resultado_cent < 0n ? 'Entrega' : 'En paz'}</span></> },
          ]}
        />
        <p className="rtm-nota">Identidad por dos vías: lo asignado a los dos ({formatearMoneda(c.identidad.via1_cent)}) y los resultados más lo que tienen en su poder y lo que deben sin ser efectivo ({formatearMoneda(c.identidad.via2_cent)}; deuda que no es efectivo: {formatearMoneda(c.identidad.deuda_no_efectivo_cent)}) son el efectivo repartido ({formatearMoneda(c.identidad.efectivo_repartido_cent)}). <EstadoTexto tono={c.identidad_cuadra ? 'ok' : 'malo'}>{c.identidad_cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto></p>
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Paso 5: saldo entre socios">
        <h2>5. Saldo entre socios</h2>
        <p data-testid="saldo-entre-socios">{liq ? <>{liq.de} entrega {formatearMoneda(liq.monto_cent)} a {liq.a} y quedan en paz.</> : 'Los dos resultados están en cero: no hay nada que liquidar entre socios.'}</p>
        {liq && (
          <div className="rtm-acciones-fila">
            <FormularioAccion boton="Registrar liquidación entre socios" titulo="Liquidación entre socios" confirmar="Registrar liquidación" accion="registrar_liquidacion_entre_socios" testid="liquidar-cascada"
              fijos={{ p_de: liq.de, p_a: liq.a, p_monto_cent: Number(liq.monto_cent) }} campos={[{ nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto', defecto: `Cascada ${ini} al ${fin}` }]}
              nota={`${liq.de} entrega ${formatearMoneda(liq.monto_cent)} a ${liq.a}.`} />
          </div>
        )}
        <p className="rtm-nota">El centavo suelto de un reparto va a favor de quien paga o aporta más.</p>
      </section>

      <section className="rtm-seccion rtm-entra rtm-i-5" aria-label="Cierre del periodo">
        <h2>Cierre firmado por los dos</h2>
        {terminado ? (
          <div className="rtm-acciones-fila">
            <FormularioAccion boton="Proponer cierre de este periodo" titulo="Proponer el cierre del reparto" confirmar="Proponer cierre" accion="proponer_cierre_reparto" primario testid="proponer-cierre"
              fijos={{ p_ini: ini, p_fin: fin }} campos={[{ nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' }]}
              nota="Congela las cifras de arriba en un acta. Cada firma recalcula: si algo cambió entre tanto, hay que anular el acta y proponerla otra vez. Surte efecto con las dos firmas y no se edita; se corrige con una contra-acta." />
          </div>
        ) : <p className="rtm-nota">El periodo aún no termina: se puede proponer el cierre a partir del {etiquetaFecha(sumarDias(fin, 1))}. Mientras tanto esta vista es una proyección.</p>}
        <DataTable
          etiqueta="Cierres de reparto"
          clave={(x) => x.id}
          filas={cierres}
          vacio={{ titulo: 'Sin cierres', texto: 'Cuando se proponga y firme un cierre aparecerá aquí con las dos firmas.' }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (x) => <><span className="rtm-mono">{x.folio}</span>{x.tipo === 'contra' ? <span className="rtm-celda-sub">Contra-acta</span> : null}</> },
            { id: 'p', titulo: 'Periodo', celda: (x) => `${etiquetaFecha(x.periodo_ini)} al ${etiquetaFecha(x.periodo_fin)}` },
            { id: 'u', titulo: 'Utilidad', numerica: true, secundaria: true, celda: (x) => formatearMoneda(x.utilidad_cent) },
            { id: 'e', titulo: 'Estado', celda: (x) => <><EstadoTexto tono={x.estado === 'cerrado' ? 'ok' : x.estado === 'anulado' ? 'neutro' : 'atencion'}>{ESTADO_CIERRE[x.estado]}</EstadoTexto><span className="rtm-celda-sub">{x.firmas.length > 0 ? `Firmas: ${x.firmas.map((f) => f.socio).join(' y ')}` : 'Sin firmas'}</span></> },
            { id: 'a', titulo: '', celda: (x) => (x.estado === 'propuesto' || x.estado === 'firmado_por_uno' ? (
                <span className="rtm-acciones-fila">
                  {!x.yo_firme && <BotonAccion chico primario texto="Firmar" titulo={`Firmar ${x.folio}`} confirmarTexto="Firmar" accion="firmar_cierre_reparto" args={{ p_cierre: x.id }} testid={`firmar-${x.folio}`} />}
                  <BotonAccion chico texto="Anular" accion="anular_cierre_reparto" args={{ p_cierre: x.id }} motivo="Motivo" titulo={`Anular ${x.folio}`} />
                </span>) : x.estado === 'cerrado' && x.tipo === 'periodo' && !x.corregida ? (
                <BotonAccion chico texto="Contra-acta" accion="contra_acta_reparto" args={{ p_cierre: x.id }} motivo="Motivo" titulo={`Corregir ${x.folio} con una contra-acta`} />) : null) },
          ]}
        />
      </section>
    </>
  );
}
