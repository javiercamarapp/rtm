// Modelo de paginas del reporte (spec 16, sec. 2): titular de accion, cifra heroe, una grafica, tabla de maximo 8 renglones,
// Implicacion y Siguiente paso, y nota de procedencia al pie. Todo el texto sale de plantillas con marcadores {{cifra:id}}; cada
// texto pasa por la guardia de numeros antes de entrar al modelo. El semanal tiene 7 paginas; el mensual 12 mas un anexo.
import { sumarDias } from '../calendario';
import { resumenComprobaciones } from './estado';
import { diasTexto, formatearCifra, formatearValor, variacionTexto } from './formato';
import { type ContextoGuardia, exigirTextoVerificado, fechasEntre } from './guardia';
import { anexoUmbrales } from './insights';
import type { Paquete } from './paquete';
import { PARAMETROS } from './parametros';
import { causaDominante } from './puente';
import * as svg from './svg';
import { renderMarcadores } from './texto';
import type { Cifra, CeldaTabla, Clase, Tabla } from './tipos';
import { ErrorReporte } from './tipos';

export interface TarjetaApoyo {
  readonly etiqueta: string;
  readonly valor: string;
  readonly comparacion: string;
  readonly clase: Clase;
}
export interface PaginaModelo {
  readonly id: string;
  readonly titular: string;
  readonly heroe?: { readonly valor: string; readonly etiqueta: string; readonly detalle: string; readonly clase: Clase };
  readonly apoyo: readonly TarjetaApoyo[];
  readonly hallazgos: readonly string[];
  readonly acciones: readonly string[];
  readonly graficas: readonly { readonly titulo: string; readonly svg: string }[];
  readonly tablas: readonly Tabla[];
  readonly notas: readonly string[];
  readonly implicacion: string;
  readonly siguiente: string;
  readonly procedencia: string;
}
export interface ReporteModelo {
  readonly folio: string;
  readonly tipo: 'semanal' | 'mensual';
  readonly encabezado: string;
  readonly estado: string;
  readonly sale: boolean;
  readonly preliminar: boolean;
  readonly huella: string;
  readonly paginas: readonly PaginaModelo[];
  readonly anexo: readonly { readonly titulo: string; readonly lineas: readonly string[] }[];
}

// ---------- contexto de la guardia ----------

function recolectar(x: unknown, out: (bigint | number)[]): void {
  if (typeof x === 'bigint') out.push(x);
  else if (typeof x === 'number') out.push(x);
  else if (Array.isArray(x)) for (const y of x) recolectar(y, out);
  else if (x && typeof x === 'object') for (const y of Object.values(x)) recolectar(y, out);
}

export function contextoGuardia(p: Paquete, extra: readonly string[] = []): ContextoGuardia {
  const valores: (bigint | number)[] = [];
  recolectar(p.tablas, valores);
  recolectar(p.graficas, valores);
  const { ok, total } = resumenComprobaciones(p.comprobaciones);
  const fechas = fechasEntre(sumarDias(p.periodo.inicio, -1), sumarDias(p.periodo.fin, 3));
  const constantes = [p.periodo.inicio.slice(0, 4), p.periodo.fin.slice(0, 4), String(ok), String(total), ...p.cifras.map((c) => String(c.nMuestra)), ...Array.from({ length: 14 }, (_, i) => String(i + 1)), '7', '28', '56', '80', String(PARAMETROS.maxRenglonesTabla), ...extra];
  return { cifras: p.cifras, nombres: p.nombres, fechas: [...fechas, p.corteIso.slice(0, 10)], valoresExtra: valores, constantes };
}

// ---------- ayudas ----------

interface Ayuda {
  readonly p: Paquete;
  readonly idx: ReadonlyMap<string, Cifra>;
  readonly guardia: ContextoGuardia;
  T(plantilla: string): string;
  tiene(id: string): boolean;
  v(id: string): bigint;
  fmt(id: string): string;
}

function crearAyuda(p: Paquete): Ayuda {
  const idx = new Map(p.cifras.map((c) => [c.id, c]));
  const guardia = contextoGuardia(p);
  const fuente = {
    obtener: (id: string): Cifra => {
      const c = idx.get(id);
      if (!c) throw new ErrorReporte('CIFRA_INEXISTENTE', `la cifra ${id} no existe en el paquete`);
      return c;
    },
  };
  return {
    p,
    idx,
    guardia,
    T: (pl) => {
      const t = renderMarcadores(pl, fuente);
      exigirTextoVerificado(t, guardia);
      return t;
    },
    tiene: (id) => idx.get(id)?.estado === 'ok',
    v: (id) => fuente.obtener(id).valor,
    fmt: (id) => formatearCifra(fuente.obtener(id)),
  };
}

const M = (id: string, mod?: string): string => `{{cifra:${id}${mod ? `|${mod}` : ''}}}`;

function dirVar(a: Ayuda, id: string): 'sube' | 'baja' | 'se mantiene' {
  if (!a.tiene(id)) return 'se mantiene';
  const x = a.v(id);
  return x > 0n ? 'sube' : x < 0n ? 'baja' : 'se mantiene';
}

const CAUSA: Record<string, [string, string]> = {
  volumen: ['mayor volumen', 'menor volumen'],
  mezcla: ['una mezcla más rentable', 'un cambio de mezcla'],
  precio: ['mejores precios', 'menores precios'],
  costo: ['menor costo', 'mayor costo'],
  guia: ['menores guías', 'mayores guías'],
  otros: ['menores gastos de bodega y mensajeros', 'mayores gastos de bodega y mensajeros'],
};

function titularUtilidad(a: Ayuda, id: 'puente.pct' | 'varContrib'): string {
  if (!a.tiene(id)) return `La utilidad de contribución fue ${M('contrib')}; aún no hay periodo comparable.`;
  const d = dirVar(a, id);
  if (d === 'se mantiene') return `La utilidad de contribución se mantiene en ${M('contrib')}.`;
  const sube = d === 'sube';
  const causa = a.p.graficas.puente ? CAUSA[causaDominante(a.p.graficas.puente).id]![sube ? 0 : 1] : null;
  return `La utilidad ${d} ${M(id, 'abs')}${causa ? ` por ${causa}` : ''}.`;
}

function procedencia(a: Ayuda, fuente: string, nId: string | null, ids: string[], clase: Clase): string {
  const cs = ids.length ? `${ids.join(', ')} en verde. ` : '';
  const n = nId && a.tiene(nId) ? ` (n = ${M(nId)})` : '';
  return a.T(`Fuente: ${fuente}${n}, corte ${a.p.corteEtiqueta}; ${cs}Clase: ${clase}.`);
}

function tarjeta(a: Ayuda, etiqueta: string, id: string, varId: string | null, ref: string, clase: Clase): TarjetaApoyo {
  const comp = varId && a.tiene(varId) ? `${variacionTexto(a.v(varId))} que ${ref}` : 'sin referencia';
  return { etiqueta, valor: a.fmt(id), comparacion: a.tiene(id) ? comp : 'sin datos', clase };
}

function hallazgos(a: Ayuda, max = 3): string[] {
  return a.p.insights.insights
    .filter((i) => !i.hipotesis)
    .slice(0, max)
    .map((i) => a.T(i.frase));
}
function hallazgosTodos(a: Ayuda, ids: readonly string[], max = 3): string[] {
  return a.p.insights.insights
    .filter((i) => ids.includes(i.id))
    .slice(0, max)
    .map((i) => a.T(i.frase));
}
function acciones(a: Ayuda, max = 3, tipos?: readonly string[]): string[] {
  return a.p.insights.recomendaciones
    .filter((r) => !tipos || tipos.includes(r.tipo))
    .slice(0, max)
    .map((r) => a.T(`${r.titulo} Quién: ${r.quien}.`));
}
function primeraAccion(a: Ayuda, tipos?: readonly string[]): string {
  const r = a.p.insights.recomendaciones.find((x) => !tipos || tipos.includes(x.tipo));
  return r ? a.T(`${r.titulo} Quién sugerido: ${r.quien}.`) : 'Sin acciones nuevas: mantener el seguimiento del periodo.';
}
const sinDatos = (t: string): string => `Sin datos de ${t} en el periodo.`;

// ---------- paginas semanales ----------

function paginaResumen(a: Ayuda, mensual: boolean): PaginaModelo {
  const ref = mensual ? 'el mes anterior' : 'el promedio de cuatro semanas';
  const titular = mensual && a.tiene('res.utilidadNeta') && a.tiene('varContrib') ? `La utilidad neta fue ${M('res.utilidadNeta')}; la de contribución ${dirVar(a, 'varContrib')} ${M('varContrib', 'abs')} contra el mes anterior.` : titularUtilidad(a, 'varContrib');
  const idUtil = mensual && a.tiene('res.utilidadNeta') ? 'res.utilidadNeta' : 'contrib';
  const heroeEt = mensual && idUtil === 'res.utilidadNeta' ? 'utilidad neta' : 'utilidad de contribución';
  const detalleMes = mensual && a.tiene('res.margenNeto') ? `${M('res.margenNeto')} de las ventas · contribución ${M('contrib')}` : '';
  const detalle = detalleMes || [a.tiene('contribPz') ? `${M('contribPz')} por pieza` : '', a.tiene('contribPct') ? `${M('contribPct')} de las ventas` : '', a.tiene('refContrib') ? `${mensual ? 'mes anterior' : 'promedio de cuatro semanas'} ${M('refContrib')}` : ''].filter(Boolean).join(' · ');
  const cs = ['C1', 'C2'];
  return {
    id: 'resumen',
    titular: a.T(titular),
    heroe: { valor: a.fmt(idUtil), etiqueta: heroeEt, detalle: a.T(detalle || 'sin referencia'), clase: 'Calculado' },
    apoyo: [tarjeta(a, 'Ventas', 'ventas', 'varVentas', ref, 'Observado'), tarjeta(a, 'Piezas', 'piezas', 'varPiezas', ref, 'Observado'), { etiqueta: 'Cobrado', valor: a.fmt('cobrado'), comparacion: a.tiene('cobradoPct') ? a.T(`${M('cobradoPct')} de lo vendido`) : 'sin datos', clase: 'Observado' }, { etiqueta: 'Por cobrar', valor: a.fmt('age.total'), comparacion: a.tiene('age.vencidaPct') ? a.T(`${M('age.vencidaPct')} con más de treinta días`) : 'sin datos', clase: 'Observado' }],
    hallazgos: hallazgos(a),
    acciones: acciones(a),
    graficas: [],
    tablas: [],
    notas: [],
    implicacion: a.T(`La utilidad de contribución cubre ${a.tiene('contribPct') ? M('contribPct') : 'una parte'} de las ventas antes de gastos fijos.`),
    siguiente: primeraAccion(a),
    procedencia: procedencia(a, `pedidos confirmados ${a.p.periodo.etiqueta}`, 'pedidosN', cs, 'Observado'),
  };
}

function paginaUtilidad(a: Ayuda): PaginaModelo {
  const p = a.p.graficas.puente;
  return {
    id: 'utilidad',
    titular: a.T(titularUtilidad(a, 'puente.pct')),
    ...(p ? { heroe: { valor: a.fmt('puente.suma'), etiqueta: 'cambio de la utilidad contra el periodo anterior', detalle: a.T(`de ${M('puente.inicio')} a ${M('puente.fin')}`), clase: 'Calculado' as Clase } } : {}),
    apoyo: [],
    hallazgos: hallazgosTodos(a, ['I09', 'I10', 'I11', 'I23']),
    acciones: [],
    graficas: p ? [{ titulo: 'Puente de utilidad', svg: svg.svgPuente(p) }] : [],
    tablas: [a.p.tablas.pedidos!],
    notas: p ? [] : ['Sin periodo anterior comparable: el puente no se dibuja.'],
    implicacion: p ? a.T(`El paso mayor es ${causaDominante(p).etiqueta.toLowerCase()}, con ${formatearValor(causaDominante(p).deltaCent, 'cent')}.`) : 'Sin periodo anterior no hay causa que atribuir.',
    siguiente: primeraAccion(a, ['renegociar']),
    procedencia: procedencia(a, `pedidos confirmados ${a.p.periodo.etiqueta}`, 'pedidosN', ['C1', 'C2', 'C14'], 'Calculado'),
  };
}

function paginaClientes(a: Ayuda): PaginaModelo {
  const tiene = a.tiene('cli.top2Pct');
  const ins = hallazgosTodos(a, ['I01', 'I02', 'I03', 'I04', 'I06'], 3);
  return {
    id: 'clientes',
    titular: tiene ? a.T(`Dos clientes explican ${M('cli.top2Pct')} de las ventas${ins[0] ? '; revisar el ritmo de compra' : ''}.`) : sinDatos('concentración de clientes'),
    ...(tiene ? { heroe: { valor: a.fmt('cli.top2Pct'), etiqueta: 'de las ventas en los dos mayores clientes', detalle: a.T(`HHI ${M('cli.hhi')}`), clase: 'Calculado' as Clase } } : {}),
    apoyo: [],
    hallazgos: ins,
    acciones: [],
    graficas: a.p.graficas.pareto ? [{ titulo: 'Pareto de clientes', svg: svg.svgPareto(a.p.graficas.pareto.items, a.p.graficas.pareto.totalCent) }] : [],
    tablas: [a.p.tablas.clientes!],
    notas: tiene ? [] : ['Se necesitan cinco clientes con pedido para hablar de concentración.'],
    implicacion: tiene ? 'Una cartera concentrada depende del ritmo de pocos clientes.' : 'Con pocos clientes la concentración no es concluyente.',
    siguiente: 'Dar seguimiento al ritmo de compra de los dos mayores clientes.',
    procedencia: procedencia(a, `ventas por cliente ${a.p.periodo.etiqueta}`, 'cli.n', ['C2', 'C14'], 'Calculado'),
  };
}

function paginaProductos(a: Ayuda): PaginaModelo {
  const ins = hallazgosTodos(a, ['I13', 'I14', 'I15', 'I16', 'I17', 'I08', 'I12'], 3);
  const t = a.tiene('inv.inmovilizado');
  const tiene13 = a.p.insights.insights.find((i) => i.id === 'I13');
  return {
    id: 'productos',
    titular: a.T(tiene13 ? `${tiene13.frase} Revisar lo que no rota.` : t ? `Capital inmovilizado de ${M('inv.inmovilizado')}; sin modelos por acabarse.` : sinDatos('inventario')),
    ...(t ? { heroe: { valor: a.fmt('inv.inmovilizado'), etiqueta: 'capital inmovilizado', detalle: a.tiene('inv.inmovPct') ? a.T(`${M('inv.inmovPct')} del inventario a costo`) : '', clase: 'Calculado' as Clase } } : {}),
    apoyo: [],
    hallazgos: ins,
    acciones: acciones(a, 3, ['reponer', 'dejar_de_surtir']),
    graficas: a.p.graficas.cobertura.some((f) => f.dias !== null) ? [{ titulo: 'Cobertura en días', svg: svg.svgCobertura(a.p.graficas.cobertura) }] : [],
    tablas: [a.p.tablas.reposicion!],
    notas: a.p.tablas.reposicion!.filas.length === 0 ? ['Sin reposición sugerida: faltan semanas de historia o no hay modelos bajo su punto de reorden.'] : [],
    implicacion: 'Lo que más rota es lo que se acaba; lo parado es capital.',
    siguiente: primeraAccion(a, ['reponer', 'dejar_de_surtir']),
    procedencia: procedencia(a, 'kardex y ventas semanales', null, ['C5', 'I5'], 'Estimado'),
  };
}

function paginaDinero(a: Ayuda): PaginaModelo {
  const liq = a.tiene('liq.porPagar');
  const g = a.p.graficas;
  return {
    id: 'dinero',
    titular: liq && a.tiene('liq.holgura') ? a.T(`Se liquida el viernes con ${M('liq.holgura', 'abs')} de ${a.v('liq.holgura') >= 0n ? 'holgura' : 'faltante'}; ${M('age.total')} está en la calle.`) : a.T(`Hay ${M('age.total')} por cobrar.`),
    ...(liq ? { heroe: { valor: a.fmt('liq.porPagar'), etiqueta: 'por pagar al proveedor', detalle: a.tiene('liq.cobertura') ? a.T(`cobertura ${M('liq.cobertura')}`) : '', clase: 'Calculado' as Clase } } : {}),
    apoyo: [],
    hallazgos: hallazgosTodos(a, ['I19', 'I20', 'I21'], 3),
    acciones: [],
    graficas: [{ titulo: 'Antigüedad de saldos', svg: svg.svgAntiguedad(g.antiguedad) }, ...(g.flujo ? [{ titulo: 'Flujo de caja', svg: svg.svgFlujo(g.flujo) }] : [])],
    tablas: a.p.tablas.liquidacion ? [a.p.tablas.liquidacion] : [],
    notas: [...a.p.proyeccionNota.filter((n) => n.startsWith('Flujo')), 'La liquidación con el proveedor cubre lunes a viernes; el resto del reporte cubre lunes a domingo.'],
    implicacion: a.tiene('age.vencidaPct') ? a.T(`${M('age.vencidaPct')} de la cartera pasa de treinta días.`) : 'Sin cartera vencida que reportar.',
    siguiente: primeraAccion(a, ['cobrar']),
    procedencia: procedencia(a, 'cuentas por cobrar, pagos y hoja del proveedor', null, ['C6', 'C7', 'L1'], 'Calculado'),
  };
}

function paginaGastos(a: Ayuda): PaginaModelo {
  const t = a.tiene('gas.total') && a.v('gas.total') > 0n;
  const g = a.p.graficas.gastos;
  return {
    id: 'gastos',
    titular: t ? a.T(`Gastaste ${M('gas.total')}: ${M('gas.varPct')} es variable.`) : 'Sin gastos en el periodo.',
    ...(t ? { heroe: { valor: a.fmt('gas.total'), etiqueta: 'gasto total', detalle: a.T([a.tiene('gas.pctVentas') ? `${M('gas.pctVentas')} de las ventas` : '', a.tiene('gas.porPieza') ? `${M('gas.porPieza')} por pieza` : ''].filter(Boolean).join(' · ') || 'sin referencia'), clase: 'Observado' as Clase } } : {}),
    apoyo: [],
    hallazgos: hallazgosTodos(a, ['I24'], 2),
    acciones: [],
    graficas: [...(t ? [{ titulo: 'Composición del gasto', svg: svg.svgBarraSegmentada(g.segmentos) }] : []), ...(g.plataforma ? [{ titulo: 'Plataforma contra su tope', svg: svg.svgBullet('Plataforma', g.plataforma.gastoCent, g.plataforma.topeCent) }] : [])],
    tablas: [a.p.tablas.gastos!],
    notas: ['No cuentan como gasto de la sociedad: empaque, publicidad, catálogos, fotos y regalos.'],
    implicacion: t ? a.T(`Los gastos fijos suman ${M('gas.fijo')} y los variables ${M('gas.variable')}.`) : 'Sin gastos que analizar.',
    siguiente: 'Registrar los gastos pendientes antes del cierre del periodo.',
    procedencia: procedencia(a, 'gastos registrados', null, ['C22'], 'Observado'),
  };
}

function paginaSocios(a: Ayuda): PaginaModelo {
  const s = a.p.graficas.socios;
  const dif = a.tiene('soc.diferencia');
  const debe = dif ? (a.v('soc.diferencia') >= 0n ? 'Javier debe a Angelo' : 'Angelo debe a Javier') : '';
  return {
    id: 'socios',
    titular: dif ? a.T(`${debe} ${M('soc.diferencia', 'abs')}; Omar queda en ${M('soc.omarNeto')}.`) : sinDatos('socios'),
    ...(dif ? { heroe: { valor: a.T(M('soc.diferencia', 'abs')), etiqueta: debe, detalle: a.T(`antes ${M('soc.anterior')}`), clase: 'Calculado' as Clase } } : {}),
    apoyo: [],
    hallazgos: hallazgosTodos(a, ['I05', 'I25', 'I18'], 3),
    acciones: [],
    graficas: s ? [{ titulo: 'Posición entre socios', svg: svg.svgDivergente(s.pasos) }] : [],
    tablas: [a.p.tablas.control!],
    notas: [],
    implicacion: dif ? 'La posición entre socios sale de la fórmula del documento de Angelo y se explica movimiento por movimiento.' : 'Sin posición entre socios en el periodo.',
    siguiente: 'Revisar las comprobaciones que no cuadran y cerrar los puentes abiertos.',
    procedencia: procedencia(a, 'cuenta de socios y de Omar', null, ['C8', 'C9'], 'Calculado'),
  };
}

// ---------- paginas mensuales ----------

function paginaEstado(a: Ayuda): PaginaModelo {
  const t = a.tiene('res.utilidadNeta');
  return {
    id: 'estado',
    titular: t ? a.T(`La utilidad neta fue ${M('res.utilidadNeta')}${a.tiene('res.margenNeto') ? `, ${M('res.margenNeto')} de las ventas` : ''}.`) : sinDatos('estado de resultados'),
    ...(t ? { heroe: { valor: a.fmt('res.utilidadNeta'), etiqueta: 'utilidad neta', detalle: a.tiene('res.margenNeto') ? a.T(`${M('res.margenNeto')} de las ventas`) : '', clase: 'Calculado' as Clase } } : {}),
    apoyo: [],
    hallazgos: [],
    acciones: [],
    graficas: a.p.graficas.cascada.length ? [{ titulo: 'Cascada del estado de resultados', svg: svg.svgCascada(a.p.graficas.cascada) }] : [],
    tablas: a.p.tablas.resultados ? [a.p.tablas.resultados] : [],
    notas: a.p.tablas.sistema ? ['Costos de mantenimiento del sistema: ver la tabla de la página de gastos.'] : [],
    implicacion: 'La cascada muestra dónde se queda cada peso entre las ventas netas y la utilidad.',
    siguiente: 'Aprobar el periodo para que el estado de resultados pase a definitivo.',
    procedencia: procedencia(a, 'estado de resultados', null, ['C3', 'C10', 'C11'], 'Calculado'),
  };
}

function paginaMes(a: Ayuda, id: string, titular: string, heroeId: string | null, heroeEt: string, grafs: PaginaModelo['graficas'], tablas: readonly Tabla[], implicacion: string, siguiente: string, ids: string[], clase: Clase, hall: readonly string[] = [], notas: readonly string[] = []): PaginaModelo {
  const ok = heroeId !== null && a.tiene(heroeId);
  return {
    id,
    titular: a.T(titular),
    ...(ok ? { heroe: { valor: a.fmt(heroeId!), etiqueta: heroeEt, detalle: '', clase } } : {}),
    apoyo: [],
    hallazgos: hall,
    acciones: [],
    graficas: grafs,
    tablas,
    notas,
    implicacion: a.T(implicacion),
    siguiente: a.T(siguiente),
    procedencia: procedencia(a, `datos de ${a.p.periodo.etiqueta}`, null, ids, clase),
  };
}

export function construirReporte(p: Paquete): ReporteModelo {
  const a = crearAyuda(p);
  const g = p.graficas;
  const mensual = p.tipo === 'mensual';
  const estado = p.estado.sale ? p.estado.etiquetas.join(' · ') : 'NO SALE';
  const paginas: PaginaModelo[] = [];
  if (!mensual) {
    paginas.push(paginaResumen(a, false), paginaUtilidad(a), paginaClientes(a), paginaProductos(a), paginaDinero(a), paginaGastos(a), paginaSocios(a));
  } else {
    const r = paginaResumen(a, true);
    paginas.push(r, paginaEstado(a));
    paginas.push({ ...paginaUtilidad(a), id: 'puente' });
    paginas.push({ ...paginaClientes(a), id: 'clientes', graficas: [...(g.pareto ? [{ titulo: 'Pareto de clientes', svg: svg.svgPareto(g.pareto.items, g.pareto.totalCent) }] : []), ...(g.bump ? [{ titulo: 'Posición de clientes por semana', svg: svg.svgBump(g.bump) }] : [])] });
    paginas.push(
      paginaMes(a, 'gustos', g.calor ? 'Los gustos por sabor se concentran en pocos sabores por cliente.' : 'Aún no hay muestra para el mapa de gustos.', null, '', g.calor ? [{ titulo: 'Mapa de calor cliente por sabor', svg: svg.svgCalor(g.calor) }] : [], [], g.calor ? 'Conviene surtir primero los sabores que cada cliente repite.' : 'Con tres pedidos y sesenta piezas por cliente el mapa se llena.', 'Registrar el sabor de cada pedido para completar el mapa.', ['C2'], 'Observado', hallazgosTodos(a, ['I07'], 3), p.proyeccionNota.filter((n) => n.startsWith('Mapa'))),
      paginaMes(a, 'productos', g.burbujas ? 'Los modelos Estrella sostienen la utilidad; los de Revisar rotan con poco margen.' : 'Aún no hay muestra para clasificar los modelos.', 'inv.valor', 'valor del inventario', [...(g.burbujas ? [{ titulo: 'Margen y rotación por modelo', svg: svg.svgBurbujas(g.burbujas) }] : [])], [a.p.tablas.reposicion!], 'Empujar los modelos Estrella y revisar el precio de los que están en Revisar.', 'Revisar el precio de los modelos en Revisar.', ['C5'], 'Calculado', hallazgosTodos(a, ['I08', 'I12'], 3), p.proyeccionNota.filter((n) => n.startsWith('Burbujas'))),
      { ...paginaProductos(a), id: 'inventario' },
      paginaMes(a, 'cobranza', a.tiene('age.vencidaPct') ? `${M('age.vencidaPct')} de la cartera pasa de treinta días.` : 'Sin cartera vencida que reportar.', 'age.total', 'por cobrar', [{ titulo: 'Antigüedad de saldos', svg: svg.svgAntiguedad(g.antiguedad) }, ...(g.tendenciaCartera.length >= 2 ? [{ titulo: 'Cartera de más de treinta días', svg: svg.svgSparkline('Cartera de más de treinta días', g.tendenciaCartera) }] : [])], [], 'La cartera vencida inmoviliza el efectivo del siguiente pedido.', 'Cobrar primero las partidas más antiguas.', ['C6'], 'Observado', hallazgosTodos(a, ['I19', 'I20'], 3)),
      paginaMes(a, 'proveedores', g.mancuernas.length ? 'El costo por pieza difiere entre proveedores en varios modelos.' : sinDatos('proveedores'), 'liq.porPagar', 'por pagar al proveedor', g.mancuernas.length ? [{ titulo: 'Costo por proveedor', svg: svg.svgMancuernas(g.mancuernas) }] : [], a.p.tablas.liquidacion ? [a.p.tablas.liquidacion] : [], 'Pedir cada modelo al proveedor más barato libera margen.', 'Comparar el costo puesto en bodega antes de cada pedido.', ['C7'], 'Calculado', hallazgosTodos(a, ['I22'], 3)),
      paginaMes(a, 'caja', g.flujo ? (g.flujo.saldoMinimoCent >= 0n ? 'El flujo de caja proyectado alcanza para las próximas cuatro semanas.' : 'El flujo de caja proyectado no alcanza en el peor caso de las próximas cuatro semanas.') : 'Aún no hay base para proyectar el flujo de caja.', a.tiene('flujo.minimo') ? 'flujo.minimo' : null, 'saldo mínimo proyectado', g.flujo ? [{ titulo: 'Flujo de caja', svg: svg.svgFlujo(g.flujo) }] : [], [], 'El saldo mínimo marca cuánto se puede retirar sin riesgo.', 'Fijar el retiro de los socios con base en el saldo mínimo.', ['C8', 'C9'], 'Estimado', hallazgosTodos(a, ['I05', 'I21'], 3), p.proyeccionNota.filter((n) => n.startsWith('Flujo'))),
      paginaMes(a, 'gastos', a.tiene('gas.total') && a.v('gas.total') > 0n ? `Gastaste ${M('gas.total')}: ${M('gas.varPct')} es variable.` : 'Sin gastos en el periodo.', 'gas.total', 'gasto total', [...(a.tiene('gas.total') && a.v('gas.total') > 0n ? [{ titulo: 'Composición del gasto', svg: svg.svgBarraSegmentada(g.gastos.segmentos) }] : []), ...(g.gastos.plataforma ? [{ titulo: 'Plataforma contra su tope', svg: svg.svgBullet('Plataforma', g.gastos.plataforma.gastoCent, g.gastos.plataforma.topeCent) }] : [])], [a.p.tablas.gastos!, ...(a.p.tablas.sistema ? [a.p.tablas.sistema] : [])], 'Los costos de mantenimiento del sistema se cargan a la sociedad y se reembolsan a Javier antes del reparto.', 'Revisar el cargo del sistema con la columna como debería ser.', ['C22'], 'Observado', hallazgosTodos(a, ['I24'], 2)),
      paginaMes(a, 'proyecciones', a.tiene('proy.central') ? `La utilidad estimada es ${M('proy.central')} por semana, con rango al ochenta por ciento.` : 'Aún falta historia para estimar la utilidad.', a.tiene('proy.cuatro') ? 'proy.cuatro' : null, 'utilidad estimada en cuatro semanas', [...(g.tendencia ? [{ titulo: 'Proyección de utilidad', svg: svg.svgTendencia(g.tendencia) }] : []), ...(g.tornado.length ? [{ titulo: 'Sensibilidad', svg: svg.svgTornado(g.tornado) }] : [])], [], g.tendencia ? 'La proyección es Estimado y no es garantía; los escenarios no llevan probabilidad.' : 'Qué falta para estimar: semanas de historia con dato.', 'Fijar un piso de precio por modelo antes del próximo aumento de costo.', ['C1'], 'Estimado', [], p.proyeccionNota),
    );
  }
  const anexo = [
    { titulo: 'Comprobaciones', lineas: p.comprobaciones.map((c) => `${c.id}  ${c.nombre}: ${c.ok ? 'cuadra' : 'no cuadra'}`) },
    { titulo: 'Insights: umbrales vigentes (config)', lineas: anexoUmbrales().map((u) => `${u.id}  ${u.nombre}. ${u.regla}. Umbral: ${u.umbral}. Muestra: ${u.muestra}.`) },
    { titulo: 'Parámetros de proyección (config)', lineas: [`Promedio móvil exponencial: alfa ${PARAMETROS.alfaEma}, ventana ${PARAMETROS.ventanaEma} semanas, mínimo ${PARAMETROS.minSemanasEma}.`, `Rango empírico al ochenta por ciento: z ${PARAMETROS.z80}.`, `Tendencia: de ${PARAMETROS.tendencia.minSemanas} a ${PARAMETROS.tendencia.maxSemanas} semanas, t mínimo ${PARAMETROS.tendencia.tMinimo}, horizonte máximo ${PARAMETROS.tendencia.horizonteMax} semanas.`, `Punto de reorden: z ${PARAMETROS.reorden.z}, revisión ${PARAMETROS.reorden.revisionDias} días.`] },
    ...(p.insights.pocosDatos.length ? [{ titulo: 'Pocos datos', lineas: p.insights.pocosDatos.map((x) => x.frase) }] : []),
  ];
  return { folio: p.periodo.folio, tipo: p.tipo, encabezado: `RTM · Reporte ${p.tipo} · ${p.periodo.etiqueta}`, estado, sale: p.estado.sale, preliminar: p.estado.etiquetas.includes('PRELIMINAR'), huella: p.huella, paginas, anexo };
}

// ---------- texto plano (comparacion dorada y guardia del documento) ----------

export function celdaATexto(c: CeldaTabla): string {
  switch (c.t) {
    case 'texto':
      return c.v;
    case 'cent':
      return formatearValor(c.v, 'cent', c.f);
    case 'pz':
      return formatearValor(BigInt(c.v), 'pz');
    case 'n':
      return String(c.v);
    case 'dias':
      return diasTexto(c.v);
    case 'bp':
      return formatearValor(c.v, 'bp', c.f);
  }
}

export function tablaATexto(t: Tabla): string[] {
  const out = [`${t.titulo}`, t.columnas.join(' | ')];
  for (const f of t.filas) out.push(f.map(celdaATexto).join(' | '));
  if (t.nota) out.push(t.nota);
  return out;
}

/** Texto visible del reporte, sin folio ni huella en el cuerpo (van aparte), para la comparacion con el dorado. */
export function reporteATexto(r: ReporteModelo): string {
  const L: string[] = [r.encabezado, `Estado: ${r.estado}`, ''];
  r.paginas.forEach((pg, i) => {
    L.push(`--- Página ${i + 1} de ${r.paginas.length}: ${pg.id} ---`, pg.titular);
    if (pg.heroe) L.push(`${pg.heroe.valor}  ${pg.heroe.etiqueta}${pg.heroe.detalle ? ` · ${pg.heroe.detalle}` : ''} [${pg.heroe.clase}]`);
    for (const t of pg.apoyo) L.push(`${t.etiqueta}: ${t.valor} (${t.comparacion}) [${t.clase}]`);
    if (pg.hallazgos.length) L.push('Lo que encontramos', ...pg.hallazgos.map((h, k) => `  ${k + 1}. ${h}`));
    if (pg.acciones.length) L.push('Qué hacer', ...pg.acciones.map((h, k) => `  ${k + 1}. ${h}`));
    for (const gr of pg.graficas) L.push(`[Gráfica] ${gr.titulo}`);
    for (const t of pg.tablas) L.push(...tablaATexto(t));
    for (const n of pg.notas) L.push(`Nota: ${n}`);
    L.push(`Implicación: ${pg.implicacion}`, `Siguiente paso: ${pg.siguiente}`, pg.procedencia, '');
  });
  for (const x of r.anexo) L.push(`--- Anexo: ${x.titulo} ---`, ...x.lineas, '');
  return L.join('\n');
}
