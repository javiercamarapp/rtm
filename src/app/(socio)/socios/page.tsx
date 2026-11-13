import { exigirSocio } from '@/composicion/acceso';
import type { Metadata } from 'next';
import Link from 'next/link';
import { etiquetaFecha } from '@/dominio/formato';
import { operacionDeSocio } from '@/composicion/operacion';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
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
  const { perfil } = await exigirSocio();
  const mio = perfil.socio_nombre === 'Angelo' || perfil.socio_nombre === 'Javier' ? perfil.socio_nombre : null;
  const [c, neta] = await Promise.all([(await operacionDeSocio()).cuentaSocios(), (await dropshippingDeSocio()).aportacionNeta()]);
  const d = c.javier_debe_a_angelo_cent;
  const parejo = d === 0n;
  const quien = d > 0n ? 'Javier debe a Angelo' : 'Angelo debe a Javier';
  const q = c.cuadre;
  const tonoLibro = q.libro_conciliado ? (q.estado === 'pendiente_proveedor' ? 'neutro' : 'ok') : 'atencion';
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
        descripcion={parejo ? 'Diferencia por la compra: parejo con lo que cada socio puso de su dinero.' : `Diferencia por la compra (informativa): ${quien} ${m(abs(d))} · costo ${m(c.costo_cent)}, mitad ${m(c.mitad_cent)}`}
        acciones={<div className="a3-acciones"><Link className="rtm-boton" href="/socios/Angelo/historial" data-testid="ir-historial-Angelo">Historial de Angelo</Link><Link className="rtm-boton" href="/socios/Javier/historial" data-testid="ir-historial-Javier">Historial de Javier</Link><Link className="rtm-boton" href="/socios/cascada">Cascada y actas</Link><AccionesSocios /></div>}
      />
      {!q.libro_conciliado && <Aviso tono="atencion" titulo="Revisar el libro: una identidad contable no se cumple.">{q.fallas} de {q.verificaciones.length} verificaciones no coinciden. Abre «Explicar este número» en el indicador Libro para ver cuáles y con qué cifras; el detalle está en Contabilidad, Comprobaciones.</Aviso>}
      {q.pendiente_proveedor_cent > 0n && <Aviso tono="atencion" titulo="Pendiente de pago al proveedor.">{m(q.pendiente_proveedor_cent)} se debe todavía a proveedores. No es una falla del libro: baja cuando la sociedad paga desde su caja o un socio paga con su dinero (Proveedores, registrar pago de un socio).</Aviso>}
      {c.otros_cent === 0n && c.costo_cent > 0n && <Aviso tono="info" titulo="Cómo se pagó el costo de la compra.">Costo {m(c.costo_cent)} = dinero propio de los socios {m(c.directo_socios_cent)} + caja de la sociedad {m(c.pagado_por_sociedad_cent)} + fondos de la sociedad que tenía un socio {m(c.pagado_con_fondos_cent)} + pendiente con proveedores {m(c.pendiente_proveedor_cent)}. La diferencia por la compra solo compara lo que cada socio puso de su dinero; un depósito a la caja sin gastar no cuenta como puesto para la compra.</Aviso>}

      <KpiLinea
        etiquetaAria="Indicadores de la cuenta de socios"
        celdas={[
          { id: 'libro', etiqueta: 'Libro', testid: 'libro-socios', valor: <CifraComprobada texto={q.libro_conciliado ? 'Conciliado' : `${q.fallas} por revisar`} cifra="socios:cuadre" comprobacion={q.libro_conciliado ? 'cuadra' : 'no_cuadra'} />, categoria: 3, nota: <Estado tono={tonoLibro}>{q.etiqueta}</Estado> },
          { id: 'dif', etiqueta: 'Diferencia por la compra', testid: 'diferencia-socios', valor: <CifraComprobada texto={m(d, true)} cifra="socios:diferencia" comprobacion="sin_comprobar" />, categoria: 4, nota: <>{parejo ? 'En paz' : quien} · informativa</> },
          { id: 'costo', etiqueta: 'Costo de la compra', valor: m(c.costo_cent), categoria: 1, nota: `Mitad por socio ${m(c.mitad_cent)}` },
          { id: 'angelo', etiqueta: 'Aportado neto por Angelo', valor: m(c.angelo.aportado_cent), categoria: 2, progreso: c.costo_cent > 0n ? { pct: Math.max(0, pct(c.angelo.aportado_cent, c.costo_cent) ?? 0), meta: 50 } : undefined, nota: c.angelo.aportado_cent < 0n ? 'Neto negativo: ya se le reembolso mas de lo que puso' : `${pct(c.angelo.aportado_cent, c.costo_cent)?.toFixed(1) ?? 'Sin dato'} % del costo` },
          { id: 'javier', etiqueta: 'Aportado neto por Javier', valor: m(c.javier.aportado_cent), categoria: 7, progreso: c.costo_cent > 0n ? { pct: Math.max(0, pct(c.javier.aportado_cent, c.costo_cent) ?? 0), meta: 50 } : undefined, nota: c.javier.aportado_cent < 0n ? 'Neto negativo: ya se le reembolso mas de lo que puso' : `${pct(c.javier.aportado_cent, c.costo_cent)?.toFixed(1) ?? 'Sin dato'} % del costo` },
          { id: 'fondos', etiqueta: 'Fondos de la sociedad en poder de socios', valor: m(fondos), categoria: 6, nota: c.socios.some((s) => s.alerta_fondos) ? 'Hay fondos sin entregar con alerta' : 'Sin alertas de entrega' },
        ]}
      />
      <FilaRatios
        etiqueta="Pendientes con los socios"
        items={[
          { etiqueta: 'Vía 1 informativa (Angelo − mitad del costo)', valor: m(c.via1_cent, true) },
          { etiqueta: 'Vía 2 informativa ((Angelo − Javier) ÷ 2)', valor: m(c.via2_cent, true) },
          { etiqueta: 'Reembolsos pendientes', valor: m(reemb) },
          { etiqueta: 'Capital por devolver', valor: m(cap) },
          { etiqueta: 'Total puesto por los dos', valor: total > 0n ? m(total) : null },
          { etiqueta: 'Fuera de la sociedad', valor: m(c.angelo.fuera_sociedad_cent + c.javier.fuera_sociedad_cent) },
        ]}
      />

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Aportado, puesto y fuera de la sociedad" descripcion="Lo que cada socio puso, por tipo" acciones={<Estado tono={tonoLibro}>{q.etiqueta}</Estado>}>
          {hayAportes ? (
            <AntiguedadSaldos tramos={['Capital', 'Reembolsable', 'Fuera de la sociedad']} titulo="Lo que puso cada socio" descripcion={`Angelo puso ${m(c.angelo.aportado_cent)} y Javier ${m(c.javier.aportado_cent)}, separado por capital, reembolsable y fuera de la sociedad.`} procedencia="observado" pie={`Corte: ${etiquetaFecha(c.hoy)} · Fuente: libro de la cuenta de socios`} filas={filasAportado} />
          ) : <p className="a3-grafica-vacia"><strong>Nadie ha puesto dinero</strong>Las aportaciones y gastos pagados por un socio aparecerán aquí.</p>}
        </Tarjeta>
        <Tarjeta titulo="Posición neta de cada socio" descripcion="Positivo: a su favor. Negativo: tiene fondos de la sociedad en su poder, que reducen su aportación neta">
          <BarList etiquetaAria="Posición neta por socio" items={c.socios.map((s) => ({ id: s.socio, etiqueta: s.socio, href: `/socios/${s.socio}`, texto: m(s.neto_cent, true), pct: maxNeto > 0n ? pct(abs(s.neto_cent), maxNeto) : null, nota: s.neto_cent > 0n ? 'A su favor' : s.neto_cent < 0n ? 'Fondos de la sociedad en su poder' : 'En paz', tono: s.neto_cent < 0n ? 'atencion' : undefined }))} />
          <BarList etiquetaAria="Fondos de la sociedad en poder de cada socio" items={c.socios.map((s) => ({ id: `f${s.socio}`, etiqueta: `Fondos en poder de ${s.socio}`, texto: m(s.fondos_cent), pct: pct(s.fondos_cent, fondos), nota: s.alerta_fondos ? `${s.dias_fondos} días sin entregar` : undefined, tono: s.alerta_fondos ? 'atencion' : undefined }))} />
        </Tarjeta>
      </Rejilla>


      <Tarjeta plana titulo="Aportación neta y diferencia a igualar" descripcion="Aportado menos los fondos de la sociedad que cada socio tiene en su poder. Ambos siguen metiendo dinero y quedan siempre igualados: quien mete más no gana más participación.">
        <p className="rtm-nota" data-testid="turno-aportar">{neta.igualados || neta.le_toca_aportar === null ? 'Igualados' : `Le toca aportar el siguiente pago: ${neta.le_toca_aportar}`}. La diferencia a igualar no es reembolso ni cobro: se resuelve con las siguientes aportaciones del que tiene menos.</p>
        <DataTable
          etiqueta="Aportación neta por socio"
          densidad="densa" plana
          clave={(s) => s.socio}
          filas={neta.socios}
          vacio={{ titulo: 'Sin aportaciones todavía', texto: 'Aparecen cuando un socio pone dinero.' }}
          columnas={[
            { id: 's', titulo: 'Socio', ancho: 'm', prioridadMovil: 'titulo', celda: (s) => s.socio },
            { id: 'a', titulo: 'Aportado', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (s) => m(s.aportado_cent) },
            { id: 'f', titulo: 'Fondos de la sociedad en su poder', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (s) => m(s.fondos_en_poder_cent) },
            { id: 'n', titulo: 'Aportación neta', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (s) => <span data-testid={`aportacion-neta-${s.socio}`}>{m(s.aportacion_neta_cent, true)}</span> },
            { id: 'd', titulo: 'Diferencia a igualar', numerica: true, ancho: 'm', prioridadMovil: 'normal', celda: (s) => <span data-testid={`diferencia-igualar-${s.socio}`}>{m(s.diferencia_a_igualar_cent)}</span> },
          ]}
        />
      </Tarjeta>

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

      <Tarjeta plana titulo="Cada socio con la sociedad" acciones={<>{mio && <Link className="rtm-boton" href={`/socios/${mio}`} data-testid="ir-mi-desglose">Mi desglose ({mio})</Link>}<Link className="rtm-boton" href="/socios/cascada" data-testid="ir-cascada">Cascada de reparto</Link></>}>
        <DataTable
          etiqueta="Posición de cada socio"
          densidad="densa" plana primeraFija
          clave={(s) => s.socio}
          filas={c.socios}
          totales={{ etiqueta: 'Total', celdas: { n: m(suma(c.socios.map((s) => s.neto_cent)), true), a: m(suma(c.socios.map((s) => s.aportado_cent))), r: m(reemb), k: m(cap), f: m(fondos) } }}
          columnas={[
            { id: 's', titulo: 'Socio', ancho: 'l', celda: (s) => <CeldaPersona nombre={s.socio} href={`/socios/${s.socio}`} testid={`estado-${s.socio}`} subtitulo={s.neto_cent > 0n ? 'La sociedad le debe' : s.neto_cent < 0n ? 'Fondos de la sociedad en su poder' : 'En paz'} /> },
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
