// Stock disponible de proveedores: agregados por marca y filtros con estado en la URL. Solo piezas, sabores y conteos: NUNCA dinero ni precios del proveedor.
// Las cuentas salen de lo que ya calcula SQL (`api.prov_tablero`); aqui solo se cuenta y se agrupa lo leido.
import { disponibles, estadoDisponibilidad, normalizarBusqueda, type ModeloTablero } from './tablero';

export type DispStock = 'todos' | 'con' | 'agotados';
export interface FiltrosStock { q: string; marca: string | null; disp: DispStock; nuevos: boolean }
export const FILTROS_STOCK_INICIALES: FiltrosStock = { q: '', marca: null, disp: 'todos', nuevos: false };

type Parametros = Record<string, string | string[] | undefined>;
const uno = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

/** Lee los filtros de la URL; un valor raro vuelve al inicial. */
export function leerFiltrosStock(sp: Parametros): FiltrosStock {
  const disp = uno(sp['disp']);
  return {
    q: uno(sp['q']).slice(0, 80),
    marca: uno(sp['marca']).slice(0, 60) || null,
    disp: disp === 'con' || disp === 'agotados' ? disp : 'todos',
    nuevos: uno(sp['nuevos']) === '1',
  };
}

export function pasaFiltroStock(m: ModeloTablero, f: FiltrosStock): boolean {
  const q = normalizarBusqueda(f.q);
  if (q) {
    const campos = [m.titulo, m.marca, m.canonico_nombre ?? '', ...m.sabores.map((s) => s.sabor)].map(normalizarBusqueda);
    if (!q.split(' ').every((w) => campos.some((c) => c.includes(w)))) return false;
  }
  if (f.marca && m.marca !== f.marca) return false;
  if (f.disp === 'con' && disponibles(m) === 0) return false;
  if (f.disp === 'agotados' && !(m.sabores.length > 0 && disponibles(m) === 0)) return false;
  if (f.nuevos && !m.nuevo_semana) return false;
  return true;
}

/** Margen para la carga inicial: todos los modelos de la primera lectura comparten (casi) el mismo instante. La lectura horaria siguiente queda fuera de este margen. */
const MARGEN_LINEA_BASE_MS = 10 * 60_000;

/** Instante de la primera lectura (linea base): la primera vez mas antigua entre los modelos, o null sin modelos. */
export function lineaBase(modelos: ModeloTablero[]): string | null {
  let base: number | null = null;
  for (const m of modelos) {
    const t = Date.parse(m.primera_vez);
    if (!Number.isNaN(t) && (base === null || t < base)) base = t;
  }
  return base === null ? null : new Date(base).toISOString();
}

/** La linea base NO cuenta como nuevo: solo es nuevo lo que aparecio despues de la carga inicial. Idempotente. */
export function sinLineaBase(modelos: ModeloTablero[]): ModeloTablero[] {
  const base = lineaBase(modelos);
  if (base === null) return modelos;
  const limite = Date.parse(base) + MARGEN_LINEA_BASE_MS;
  return modelos.map((m) => (m.nuevo_semana && Date.parse(m.primera_vez) <= limite ? { ...m, nuevo_semana: false } : m));
}

export interface ResumenMarca { marca: string; modelos: number; conStock: number; agotados: number; sinDato: number; saboresDisp: number; saboresTotal: number; pct: number | null }

export function resumenPorMarca(modelos: ModeloTablero[]): ResumenMarca[] {
  const mapa = new Map<string, ResumenMarca>();
  for (const m of modelos) {
    const r = mapa.get(m.marca) ?? { marca: m.marca, modelos: 0, conStock: 0, agotados: 0, sinDato: 0, saboresDisp: 0, saboresTotal: 0, pct: null };
    r.modelos += 1;
    const e = estadoDisponibilidad(m);
    if (e === 'sin_dato') r.sinDato += 1; else if (e === 'agotado') r.agotados += 1; else r.conStock += 1;
    r.saboresDisp += disponibles(m);
    r.saboresTotal += m.sabores.length;
    mapa.set(m.marca, r);
  }
  return [...mapa.values()].map((r) => ({ ...r, pct: r.saboresTotal ? Math.round((r.saboresDisp / r.saboresTotal) * 100) : null })).sort((a, b) => a.marca.localeCompare(b.marca, 'es'));
}

export interface KpisStock { modelos: number; conStock: number; agotados: number; nuevos: number; saboresDisp: number; saboresTotal: number; pct: number | null }

export function kpisStock(modelos: ModeloTablero[]): KpisStock {
  const r = resumenPorMarca(modelos);
  const sum = (f: (x: ResumenMarca) => number): number => r.reduce((a, x) => a + f(x), 0);
  const saboresTotal = sum((x) => x.saboresTotal);
  const saboresDisp = sum((x) => x.saboresDisp);
  return {
    modelos: modelos.length, conStock: sum((x) => x.conStock), agotados: sum((x) => x.agotados), nuevos: modelos.filter((m) => m.nuevo_semana).length,
    saboresDisp, saboresTotal, pct: saboresTotal ? Math.round((saboresDisp / saboresTotal) * 100) : null,
  };
}

/** Ultimo cambio conocido del modelo (el mas reciente entre sus sabores y sus eventos), o null. */
export function ultimoCambio(m: ModeloTablero): { en: string; tipo: string } | null {
  const candidatos = [
    ...m.eventos.map((e) => ({ en: e.en, tipo: e.tipo })),
    ...m.sabores.filter((s) => s.cambio_en).map((s) => ({ en: s.cambio_en as string, tipo: s.cambio_tipo ?? 'cambio' })),
  ].sort((a, b) => b.en.localeCompare(a.en));
  return candidatos[0] ?? null;
}

/** Agrupa por marca (orden alfabetico) y dentro por nombre. */
export function agruparPorMarca(modelos: ModeloTablero[]): { marca: string; modelos: ModeloTablero[] }[] {
  const mapa = new Map<string, ModeloTablero[]>();
  for (const m of modelos) mapa.set(m.marca, [...(mapa.get(m.marca) ?? []), m]);
  return [...mapa].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([marca, lista]) => ({ marca, modelos: lista.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es')) }));
}
