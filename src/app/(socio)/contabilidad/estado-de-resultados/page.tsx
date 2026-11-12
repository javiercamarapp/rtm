import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { serieSemanalDeSocio } from '@/composicion/contabilidad-serie';
import { fechaNeg } from '@/dominio/calendario';
import { rangoDeConsulta } from '@/dominio/contabilidad/rangos';
import type { EstadoResultados } from '@/dominio/contabilidad/tipos';
import { etiquetaFecha, formatearPiezas } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso } from '@/ui/componentes/controles';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { periodoAnterior } from '../../_a3/periodos';
import { GraficaSemanas } from '../../_a3/serie';
import { Estado, Pie, abs, m, pct } from '../../_a3/util';
import { SelectorRango } from '../selector-rango';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Estado de resultados' };

type Nivel = 'linea' | 'sub' | 'total';
interface Reng { clave: string; nombre: string; nivel: Nivel; valor: (e: EstadoResultados) => bigint }

const montoDe = (e: EstadoResultados, codigo: string) => e.lineas.find((l) => l.codigo === codigo)?.monto_cent ?? 0n;

function renglones(a: EstadoResultados, b: EstadoResultados | null): Reng[] {
  const codigos = (tipo: string, solo?: string[]) => {
    const set = new Map<string, string>();
    for (const e of [a, b]) for (const l of e?.lineas ?? []) if (l.tipo === tipo && (!solo || solo.includes(l.codigo)) && (montoDe(a, l.codigo) !== 0n || (b && montoDe(b, l.codigo) !== 0n))) set.set(l.codigo, l.nombre);
    return [...set.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
  };
  const lin = (tipo: string, solo: string[] | undefined, signo: 1n | -1n): Reng[] => codigos(tipo, solo).map(([c, n]) => ({ clave: c, nombre: `${c} ${n}`, nivel: 'linea', valor: (e) => montoDe(e, c) * signo }));
  return [
    ...lin('I', ['4110', '4120', '4130'], 1n),
    { clave: 'dev', nombre: '4220 Devoluciones sobre ventas', nivel: 'linea', valor: (e) => -e.devoluciones_cent },
    { clave: 'desc', nombre: '4210 Descuentos y bonificaciones', nivel: 'linea', valor: (e) => -e.descuentos_cent },
    { clave: 'vn', nombre: 'VENTAS NETAS', nivel: 'sub', valor: (e) => e.ventas_netas_cent },
    { clave: 'env', nombre: '4300 Envío cobrado a clientes', nivel: 'linea', valor: (e) => e.envio_cent },
    { clave: 'ion', nombre: 'INGRESOS OPERATIVOS NETOS', nivel: 'sub', valor: (e) => e.ingresos_operativos_cent },
    ...lin('C', undefined, 1n),
    { clave: 'cv', nombre: 'COSTO DE VENTAS', nivel: 'sub', valor: (e) => -e.costo_ventas_cent },
    { clave: 'ub', nombre: 'UTILIDAD BRUTA', nivel: 'sub', valor: (e) => e.utilidad_bruta_cent },
    ...lin('G', ['6110', '6120', '6130', '6140'], -1n),
    { clave: 'gv', nombre: 'GASTOS VARIABLES DE VENTA', nivel: 'sub', valor: (e) => -e.gastos_variables_cent },
    { clave: 'uc', nombre: 'UTILIDAD DE CONTRIBUCIÓN', nivel: 'sub', valor: (e) => e.utilidad_contribucion_cent },
    ...lin('G', ['6210', '6220', '6230', '6240', '6250', '6290'], -1n),
    { clave: 'gf', nombre: 'GASTOS FIJOS DEL SISTEMA Y ADMINISTRACIÓN', nivel: 'sub', valor: (e) => -e.gastos_fijos_cent },
    { clave: 'ot', nombre: 'Recargos por crédito, cambiarios, incobrables y redondeo', nivel: 'linea', valor: (e) => e.otros_cent },
    { clave: 'un', nombre: 'UTILIDAD NETA (antes de reparto)', nivel: 'total', valor: (e) => e.utilidad_neta_cent },
  ];
}

const pctSigno = (parte: bigint, total: bigint): string => (total <= 0n ? 'Sin dato' : `${(Number((parte * 10000n) / total) / 100).toFixed(1)} %`);

export default async function PaginaEstadoResultados({ searchParams }: { searchParams: Promise<{ ini?: string; fin?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const { ini, fin } = rangoDeConsulta(hoy, q.ini, q.fin);
  const ant = periodoAnterior(ini, fin);
  const lector = await contabilidadDeSocio();
  const [e, p, serie] = await Promise.all([lector.estadoResultados(ini, fin), lector.estadoResultados(ant.ini, ant.fin).catch(() => null), serieSemanalDeSocio(12).catch(() => null)]);
  const dato = e.con_movimientos;
  const hayAnt = p !== null && p.con_movimientos;
  const cifra = (c: bigint, nivel: 'bruta' | 'contribucion' | 'neta') => (dato ? <CifraComprobada texto={m(c)} cifra={`conta:utilidad:${ini}:${fin}:${nivel}`} comprobacion={e.comprobacion.cuadra ? 'cuadra' : 'no_cuadra'} /> : null);
  const filas = dato ? renglones(e, p) : [];
  const gastos = e.lineas.filter((l) => l.tipo === 'G' && l.monto_cent !== 0n);
  const totalGastos = e.gastos_variables_cent + e.gastos_fijos_cent;
  const pasos = [
    { id: 'vn', etiqueta: 'Ventas netas', valor: Number(e.ventas_netas_cent), tipo: 'inicio' as const, texto: m(e.ventas_netas_cent) },
    { id: 'env', etiqueta: 'Envío cobrado', valor: Number(e.envio_cent), tipo: 'delta' as const, texto: m(e.envio_cent, true) },
    { id: 'cv', etiqueta: 'Costo de ventas', valor: -Number(e.costo_ventas_cent), tipo: 'delta' as const, texto: m(-e.costo_ventas_cent, true) },
    { id: 'gv', etiqueta: 'Gastos variables', valor: -Number(e.gastos_variables_cent), tipo: 'delta' as const, texto: m(-e.gastos_variables_cent, true) },
    { id: 'gf', etiqueta: 'Gastos fijos', valor: -Number(e.gastos_fijos_cent), tipo: 'delta' as const, texto: m(-e.gastos_fijos_cent, true) },
    { id: 'ot', etiqueta: 'Otros', valor: Number(e.otros_cent), tipo: 'delta' as const, texto: m(e.otros_cent, true) },
    { id: 'un', etiqueta: 'Utilidad neta', valor: Number(e.utilidad_neta_cent), tipo: 'total' as const, texto: m(e.utilidad_neta_cent, true) },
  ];
  const porPieza = e.piezas_vendidas > 0 ? e.utilidad_neta_cent / BigInt(e.piezas_vendidas) : null;
  const dif = (a: bigint, b: bigint) => m(a - b, true);

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · estado de resultados"
        titulo={`La utilidad neta del periodo es ${dato ? m(e.utilidad_neta_cent) : 'sin dato'}`}
        descripcion={`Del ${etiquetaFecha(ini)} al ${etiquetaFecha(fin)}. Utilidad no es caja: el reparto de efectivo sigue la cascada.`}
        acciones={<SelectorRango base="/contabilidad/estado-de-resultados" hoy={hoy} ini={ini} fin={fin} />}
      />
      {!dato ? (
        <DataTable etiqueta="Estado de resultados" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin dato en este periodo', texto: 'Aún no hay asientos con fecha dentro del periodo elegido. Cuando haya ventas, costos y gastos aparecerán aquí.' }} />
      ) : (
        <>
          {e.ajustes_periodos_anteriores_cent !== 0n && <Aviso tono="info" titulo="Ajustes de periodos anteriores.">{m(e.ajustes_periodos_anteriores_cent, true)} se registraron en este periodo.</Aviso>}
          <KpiLinea
            etiquetaAria="Indicadores del estado de resultados"
            celdas={[
              { id: 'vn', etiqueta: 'Ventas netas', valor: m(e.ventas_netas_cent), categoria: 1, nota: hayAnt ? `Periodo anterior ${m(p!.ventas_netas_cent)}` : 'Sin periodo anterior comparable' },
              { id: 'ub', testid: 'utilidad-bruta', etiqueta: 'Utilidad bruta', valor: cifra(e.utilidad_bruta_cent, 'bruta'), categoria: 2, nota: `Margen ${pctSigno(e.utilidad_bruta_cent, e.ingresos_operativos_cent)}` },
              { id: 'uc', testid: 'utilidad-contribucion', etiqueta: 'Utilidad de contribución', valor: cifra(e.utilidad_contribucion_cent, 'contribucion'), categoria: 6, nota: `Margen ${pctSigno(e.utilidad_contribucion_cent, e.ingresos_operativos_cent)}` },
              { id: 'un', testid: 'utilidad-neta', etiqueta: 'Utilidad neta', valor: cifra(e.utilidad_neta_cent, 'neta'), categoria: 7, nota: `Margen ${pctSigno(e.utilidad_neta_cent, e.ingresos_operativos_cent)}` },
              { id: 'pz', etiqueta: 'Piezas vendidas', valor: formatearPiezas(e.piezas_vendidas), categoria: 4, nota: porPieza === null ? 'Sin piezas en el periodo' : `Utilidad neta por pieza ${m(porPieza, true)}` },
            ]}
          />
          <FilaRatios
            etiqueta="Comparativo con el periodo anterior"
            items={[
              { etiqueta: 'Ventas netas', valor: hayAnt ? dif(e.ventas_netas_cent, p!.ventas_netas_cent) : null },
              { etiqueta: 'Utilidad bruta', valor: hayAnt ? dif(e.utilidad_bruta_cent, p!.utilidad_bruta_cent) : null },
              { etiqueta: 'Gastos totales', valor: hayAnt ? dif(totalGastos, p!.gastos_variables_cent + p!.gastos_fijos_cent) : null },
              { etiqueta: 'Utilidad neta', valor: hayAnt ? dif(e.utilidad_neta_cent, p!.utilidad_neta_cent) : null },
              { etiqueta: 'Reparto 50/50', valor: `Angelo ${m(e.angelo_cent)} · Javier ${m(e.javier_cent)}` },
            ]}
          />
          <Rejilla dividir="8-4">
            <Tarjeta titulo="De las ventas a la utilidad neta" descripcion="Cada paso del estado de resultados">
              <Cascada titulo="Cascada del estado de resultados" descripcion={`Ventas netas ${m(e.ventas_netas_cent)}; utilidad neta ${m(e.utilidad_neta_cent, true)}.`} pasos={pasos} unidad="Pesos" />
            </Tarjeta>
            <Tarjeta titulo="En qué se van los gastos" descripcion="Gastos variables y fijos del periodo">
              {gastos.length > 0 ? <BarList etiquetaAria="Gastos por cuenta" items={gastos.map((g) => ({ id: g.codigo, etiqueta: `${g.codigo} ${g.nombre}`, texto: m(g.monto_cent), pct: pct(abs(g.monto_cent), totalGastos) }))} /> : <p className="a3-grafica-vacia"><strong>Sin gastos</strong>No hay gastos con importe en el periodo.</p>}
              <ListaClaveValor items={[
                { k: 'Gastos variables de venta', v: m(e.gastos_variables_cent) },
                { k: 'Gastos fijos y de administración', v: m(e.gastos_fijos_cent) },
                { k: 'Gastos sobre ingresos', v: pctSigno(totalGastos, e.ingresos_operativos_cent) },
                { k: 'Costo de ventas sobre ingresos', v: pctSigno(e.costo_ventas_cent, e.ingresos_operativos_cent) },
                { k: 'Gastos totales', v: <strong>{m(totalGastos)}</strong> },
              ]} />
            </Tarjeta>
          </Rejilla>
          <Rejilla dividir="8-4">
            <Tarjeta plana titulo="Estado de resultados" descripcion={`Periodo del ${etiquetaFecha(ini)} al ${etiquetaFecha(fin)}${hayAnt ? ` contra ${etiquetaFecha(ant.ini)} al ${etiquetaFecha(ant.fin)}` : ''}`}>
              <DataTable
                etiqueta="Estado de resultados"
                densidad="libro" plana primeraFija
                interactiva={{ exportar: `estado-resultados-${ini}-${fin}` }}
                clave={(r) => r.clave}
                filas={filas}
                totales={{ etiqueta: 'Utilidad neta', celdas: { a: m(e.utilidad_neta_cent, true), b: hayAnt ? m(p!.utilidad_neta_cent, true) : 'Sin dato', v: hayAnt ? dif(e.utilidad_neta_cent, p!.utilidad_neta_cent) : 'Sin dato', pc: pctSigno(e.utilidad_neta_cent, e.ingresos_operativos_cent) } }}
                columnas={[
                  { id: 'n', titulo: 'Renglón', ancho: 'xl', celda: (r) => (r.nivel === 'linea' ? <span className="a3-sangria-1">{r.nombre}</span> : <strong>{r.nombre}</strong>) },
                  { id: 'a', titulo: 'Periodo', bloque: 'Importe', numerica: true, ancho: 'm', celda: (r) => (r.nivel === 'linea' ? m(r.valor(e)) : <strong>{m(r.valor(e))}</strong>) },
                  { id: 'b', titulo: 'Anterior', bloque: 'Importe', numerica: true, ancho: 'm', secundaria: true, celda: (r) => (p === null || !hayAnt ? <span className="rtm-sin-dato">Sin dato</span> : r.nivel === 'linea' ? m(r.valor(p)) : <strong>{m(r.valor(p))}</strong>) },
                  { id: 'v', titulo: 'Variación', bloque: 'Importe', numerica: true, ancho: 'm', secundaria: true, celda: (r) => (p === null || !hayAnt ? <span className="rtm-sin-dato">Sin dato</span> : m(r.valor(e) - r.valor(p), true)) },
                  { id: 'pc', titulo: '% de ingresos', numerica: true, ancho: 's', secundaria: true, celda: (r) => pctSigno(r.valor(e), e.ingresos_operativos_cent) },
                ]}
              />
            </Tarjeta>
            <div className="a3-pila">
              <Tarjeta titulo="Utilidad neta por semana" descripcion="Últimas 12 semanas; la semana en curso es parcial">
                <GraficaSemanas titulo="Utilidad neta por semana" descripcion="Utilidad neta de cada una de las últimas semanas." semanas={serie?.semanas ?? []} valor={(s) => s.utilidad_neta_cent} pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: libro de asientos`} alto={140} />
              </Tarjeta>
              <Tarjeta titulo="Comprobación por dos vías">
                <p><Estado tono={e.comprobacion.cuadra ? 'ok' : 'malo'}>{e.comprobacion.cuadra ? 'Cuadra por las dos vías' : 'No cuadra'}</Estado></p>
                <Pie>Vía 1: suma de los niveles {m(e.comprobacion.via1_cent)}. Vía 2: suma directa de las cuentas 4 a 7 {m(e.comprobacion.via2_cent)}. El residuo de un centavo del reparto va a Angelo. Fuente: libro de asientos, corte {hoy}.</Pie>
              </Tarjeta>
            </div>
          </Rejilla>
        </>
      )}
    </Pagina>
  );
}
