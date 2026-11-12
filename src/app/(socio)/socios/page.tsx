import type { Metadata } from 'next';
import Link from 'next/link';
import { etiquetaFecha } from '@/dominio/formato';
import { operacionDeSocio } from '@/composicion/operacion';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso, CeldaPersona } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AntiguedadSaldos } from '@/ui/graficas';
import { BotonAccion } from '../operacion/formulario-accion';
import { Dos, Estado, Pie, abs, m, pct, suma } from '../_a3/util';
import { AccionesSocios } from './formularios';

export const metadata: Metadata = { title: 'Cuenta de socios' };

export default async function PaginaSocios() {
  const c = await (await operacionDeSocio()).cuentaSocios();
  const d = c.javier_debe_a_angelo_cent;
  const parejo = d === 0n;
  const quien = d > 0n ? 'Javier debe a Angelo' : 'Angelo debe a Javier';
  const total = c.angelo.aportado_cent + c.javier.aportado_cent;
  const maxNeto = c.socios.reduce((a, s) => (abs(s.neto_cent) > a ? abs(s.neto_cent) : a), 0n);
  const filasAportado = (['angelo', 'javier'] as const).map((k) => {
    const p = c[k];
    const nombre = k === 'angelo' ? 'Angelo' : 'Javier';
    return { id: k, etiqueta: nombre, valores: [Number(p.puso_capital_cent), Number(p.puso_reembolsable_cent), Number(p.fuera_sociedad_cent)], textos: [m(p.puso_capital_cent), m(p.puso_reembolsable_cent), m(p.fuera_sociedad_cent)], total: m(p.aportado_cent + p.fuera_sociedad_cent) };
  });
  const hayAportes = filasAportado.some((f) => f.valores.some((v) => v > 0));
  const fondos = suma(c.socios.map((s) => s.fondos_cent));
  const reemb = suma(c.socios.map((s) => s.reembolso_pendiente_cent));
  const cap = suma(c.socios.map((s) => s.capital_pendiente_cent));
  const movs = c.movimientos;
  const entradas = suma(movs.filter((x) => x.monto_cent > 0n && !x.deshecho).map((x) => x.monto_cent));

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Cuentas de socios"
        titulo="Cuenta de socios"
        descripcion={parejo ? 'La cuenta entre socios está pareja: cada uno puso la mitad del costo.' : `${quien} ${m(abs(d))} por la compra · costo ${m(c.costo_cent)}, mitad ${m(c.mitad_cent)}`}
        acciones={<div className="a3-acciones"><AccionesSocios /></div>}
      />
      {c.financiado_por_sociedad_cent !== 0n && <Aviso tono="atencion" titulo="Parte del costo no la pusieron los socios.">{m(c.financiado_por_sociedad_cent)} salió de la sociedad: la identidad por dos vías no cuadra hasta registrarlo.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores de la cuenta de socios"
        celdas={[
          { id: 'dif', etiqueta: 'Diferencia por la compra', testid: 'diferencia-socios', valor: <CifraComprobada texto={m(d, true)} cifra="socios:diferencia" comprobacion={c.cuadra ? 'cuadra' : 'no_cuadra'} />, categoria: 4, nota: <>{parejo ? 'En paz' : quien} · <Estado tono={c.cuadra ? 'ok' : 'atencion'}>{c.cuadra ? 'Cuadra por dos vías' : 'No cuadra'}</Estado></> },
          { id: 'costo', etiqueta: 'Costo de la compra', valor: m(c.costo_cent), categoria: 1, nota: `Mitad por socio ${m(c.mitad_cent)}` },
          { id: 'angelo', etiqueta: 'Puso Angelo', valor: m(c.angelo.aportado_cent), categoria: 2, progreso: c.costo_cent > 0n ? { pct: pct(c.angelo.aportado_cent, c.costo_cent) ?? 0, meta: 50 } : undefined, nota: `${pct(c.angelo.aportado_cent, c.costo_cent)?.toFixed(1) ?? 'Sin dato'} % del costo` },
          { id: 'javier', etiqueta: 'Puso Javier', valor: m(c.javier.aportado_cent), categoria: 7, progreso: c.costo_cent > 0n ? { pct: pct(c.javier.aportado_cent, c.costo_cent) ?? 0, meta: 50 } : undefined, nota: `${pct(c.javier.aportado_cent, c.costo_cent)?.toFixed(1) ?? 'Sin dato'} % del costo` },
          { id: 'fondos', etiqueta: 'Fondos de la sociedad en poder de socios', valor: m(fondos), categoria: 6, nota: c.socios.some((s) => s.alerta_fondos) ? 'Hay fondos sin entregar con alerta' : 'Sin alertas de entrega' },
        ]}
      />
      <FilaRatios
        etiqueta="Pendientes con los socios"
        items={[
          { etiqueta: 'Vía 1 (Angelo − mitad del costo)', valor: m(c.via1_cent, true) },
          { etiqueta: 'Vía 2 ((Angelo − Javier) ÷ 2)', valor: m(c.via2_cent, true) },
          { etiqueta: 'Reembolsos pendientes', valor: m(reemb) },
          { etiqueta: 'Capital por devolver', valor: m(cap) },
          { etiqueta: 'Total puesto por los dos', valor: total > 0n ? m(total) : null },
          { etiqueta: 'Fuera de la sociedad', valor: m(c.angelo.fuera_sociedad_cent + c.javier.fuera_sociedad_cent) },
        ]}
      />

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Aportado, puesto y fuera de la sociedad" descripcion="Lo que cada socio puso, por tipo" acciones={<Estado tono={c.cuadra ? 'ok' : 'atencion'}>{c.cuadra ? 'Cuadra' : 'No cuadra'}</Estado>}>
          {hayAportes ? (
            <AntiguedadSaldos tramos={['Capital', 'Reembolsable', 'Fuera de la sociedad']} titulo="Lo que puso cada socio" descripcion={`Angelo puso ${m(c.angelo.aportado_cent)} y Javier ${m(c.javier.aportado_cent)}, separado por capital, reembolsable y fuera de la sociedad.`} procedencia="observado" pie={`Corte: ${etiquetaFecha(c.hoy)} · Fuente: libro de la cuenta de socios`} filas={filasAportado} />
          ) : <p className="a3-grafica-vacia"><strong>Nadie ha puesto dinero</strong>Las aportaciones y gastos pagados por un socio aparecerán aquí.</p>}
        </Tarjeta>
        <Tarjeta titulo="Posición neta de cada socio" descripcion="Positivo: la sociedad le debe. Negativo: él debe a la sociedad">
          <BarList etiquetaAria="Posición neta por socio" items={c.socios.map((s) => ({ id: s.socio, etiqueta: s.socio, href: `/socios/${s.socio}`, texto: m(s.neto_cent, true), pct: maxNeto > 0n ? pct(abs(s.neto_cent), maxNeto) : null, nota: s.neto_cent > 0n ? 'La sociedad le debe' : s.neto_cent < 0n ? 'Él debe' : 'En paz', tono: s.neto_cent < 0n ? 'malo' : undefined }))} />
          <BarList etiquetaAria="Fondos de la sociedad en poder de cada socio" items={c.socios.map((s) => ({ id: `f${s.socio}`, etiqueta: `Fondos en poder de ${s.socio}`, texto: m(s.fondos_cent), pct: pct(s.fondos_cent, fondos), nota: s.alerta_fondos ? `${s.dias_fondos} días sin entregar` : undefined, tono: s.alerta_fondos ? 'atencion' : undefined }))} />
        </Tarjeta>
      </Rejilla>

      {c.partidas_fuera_sociedad.length > 0 && (
        <Tarjeta plana titulo="Fuera de la sociedad (aparte)" descripcion="No entra al balance ni se mezcla con lo que un socio debe por un faltante">
          <DataTable etiqueta="Partidas fuera de la sociedad" densidad="densa" plana clave={(p) => `${p.socio}-${p.concepto}`} filas={c.partidas_fuera_sociedad}
            totales={{ etiqueta: 'Total', celdas: { m: m(suma(c.partidas_fuera_sociedad.map((p) => p.monto_cent))) } }}
            columnas={[
              { id: 's', titulo: 'Socio', ancho: 'm', celda: (p) => p.socio }, { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (p) => p.concepto },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (p) => m(p.monto_cent) }, { id: 'e', titulo: 'Estado', ancho: 'm', secundaria: true, celda: (p) => p.estado.replaceAll('_', ' ') },
            ]} />
        </Tarjeta>
      )}

      <Tarjeta plana titulo="Cada socio con la sociedad" acciones={<Link className="rtm-boton" href="/socios/cascada" data-testid="ir-cascada">Cascada de reparto</Link>}>
        <DataTable
          etiqueta="Posición de cada socio"
          densidad="densa" plana primeraFija
          clave={(s) => s.socio}
          filas={c.socios}
          totales={{ etiqueta: 'Total', celdas: { n: m(suma(c.socios.map((s) => s.neto_cent)), true), a: m(suma(c.socios.map((s) => s.aportado_cent))), r: m(reemb), k: m(cap), f: m(fondos) } }}
          columnas={[
            { id: 's', titulo: 'Socio', ancho: 'l', celda: (s) => <span data-testid={`estado-${s.socio}`}><CeldaPersona nombre={s.socio} href={`/socios/${s.socio}`} subtitulo={s.neto_cent > 0n ? 'La sociedad le debe' : s.neto_cent < 0n ? 'Él debe' : 'En paz'} /></span> },
            { id: 'a', titulo: 'Aportado', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(s.aportado_cent) },
            { id: 'n', titulo: 'Posición neta', numerica: true, ancho: 'm', celda: (s) => <CifraComprobada texto={m(s.neto_cent, true)} cifra={`socio:neto:${s.socio}`} comprobacion="cuadra" /> },
            { id: 'r', titulo: 'Reembolsos pendientes', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(s.reembolso_pendiente_cent) },
            { id: 'k', titulo: 'Capital por devolver', numerica: true, ancho: 'm', secundaria: true, celda: (s) => m(s.capital_pendiente_cent) },
            { id: 'f', titulo: 'Fondos de la sociedad en su poder', numerica: true, ancho: 'l', celda: (s) => <Dos a={<CifraComprobada texto={m(s.fondos_cent)} cifra={`socio:fondos:${s.socio}`} comprobacion="cuadra" />} b={s.alerta_fondos ? <Estado tono="atencion">Lleva {s.dias_fondos} días sin entregar</Estado> : undefined} /> },
          ]}
        />
      </Tarjeta>

      <Tarjeta plana titulo="Libro de movimientos" descripcion={`${movs.length} movimientos · entradas ${m(entradas)}`}>
        <DataTable
          etiqueta="Movimientos de la cuenta de socios"
          densidad="libro" plana pegajosa primeraFija
          interactiva={{ busqueda: 'Buscar socio o concepto', porPagina: 50, exportar: 'libro-socios' }}
          clave={(x) => `${x.tipo}-${x.id}`}
          filas={movs}
          totales={{ etiqueta: `Neto (${movs.length})`, celdas: { m: m(suma(movs.filter((x) => !x.deshecho).map((x) => x.monto_cent)), true) } }}
          vacio={{ titulo: 'Sin movimientos', texto: 'Aportaciones, gastos pagados por un socio, pagos y liquidaciones aparecerán aquí, cada uno con su eco y su deshacer.' }}
          columnas={[
            { id: 'd', titulo: 'Fecha', ancho: 's', celda: (x) => etiquetaFecha(x.fecha_neg) },
            { id: 's', titulo: 'Socio', ancho: 's', celda: (x) => x.socio },
            { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (x) => <>{x.concepto}{x.deshecho ? ' (deshecho)' : ''}</> },
            { id: 'cl', titulo: 'Clase', ancho: 'm', secundaria: true, celda: (x) => x.clasificacion.replaceAll('_', ' ') },
            { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (x) => m(x.monto_cent, true) },
            { id: 'q', titulo: 'Quién', ancho: 'l', secundaria: true, celda: (x) => <Dos a={x.autor ?? x.canal} b={x.mensaje_origen ?? <span className="rtm-mono">{x.evento}</span>} /> },
            { id: 'x', titulo: '', ancho: 's', celda: (x) => (x.deshacible ? <BotonAccion chico texto="Deshacer" accion="anular_movimiento_socio" args={{ p_tipo: x.tipo, p_id: x.id }} motivo="Motivo" titulo="Deshacer captura" /> : null) },
          ]}
        />
        <div className="a3-pie-tarjeta"><Pie>La empresa paga primero: gastos y capital se devuelven antes de repartir la utilidad 50/50.</Pie></div>
      </Tarjeta>
    </Pagina>
  );
}
