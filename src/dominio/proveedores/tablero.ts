// Tablero "Lo que hay en Karen": tipos del JSON de la base, filtros con estado en la URL, filtrado, orden y avisos.
// Aqui NO hay dinero ni precios: solo piezas, dias y conteos. Las cuentas (ventas, cobertura, recomendaciones) las hace SQL (`api.prov_tablero`).
import { sinCaladas } from './lista_cliente';

export interface SaborTablero {
  variante_id: string;
  sabor: string;
  disponible: boolean;
  inestable: boolean;
  sabor_canonico_id: string | null;
  ventas_60d: number;
  existencia_propia: number;
  cambio_en: string | null;
  cambio_tipo: string | null;
}

export interface EventoModelo { clave: string; tipo: string; en: string; antes: string | null; despues: string | null; sabor: string | null }

export interface ModeloTablero {
  producto_id: string;
  handle: string;
  marca: string;
  titulo: string;
  puffs: number | null;
  estado: string;
  primera_vez: string;
  nuevo_semana: boolean;
  mapeo: string;
  canonico_id: string | null;
  canonico_nombre: string | null;
  sin_sabores: boolean;
  nuevo_sin_costo: boolean;
  ventas_60d: number;
  ventas_30d: number;
  vendemos: boolean;
  existencia_propia: number;
  cobertura_dias: number | null;
  sabores: SaborTablero[];
  eventos: EventoModelo[];
}

export type MotivoRecomendacion = 'reponer' | 'llego_y_vendemos' | 'agotado_y_vendemos';

export interface Recomendacion {
  producto_id: string;
  titulo: string;
  marca: string;
  motivos: MotivoRecomendacion[];
  ventas_60d: number;
  existencia_propia: number;
  cobertura_dias: number | null;
  sabores_sugeridos: string[];
}

export interface DatosTablero { modelos: ModeloTablero[]; recomendaciones: Recomendacion[] }

// ---------------------------------------------------------------- filtros (estado en la URL)

export type FiltroDisponibilidad = 'todos' | 'con' | 'agotados';
export type FiltroExistencia = 'todas' | 'con' | 'sin';
export type OrdenTablero = 'nombre' | 'sabores' | 'vendidos' | 'cobertura' | 'recientes';

export interface FiltrosKaren {
  q: string;
  marcas: string[];
  disp: FiltroDisponibilidad;
  vendemos: boolean;
  nuevos: boolean;
  existencia: FiltroExistencia;
  caladas: boolean;
  orden: OrdenTablero;
  /** Modelo abierto en el panel. */
  modelo: string | null;
}

export const FILTROS_INICIALES: FiltrosKaren = { q: '', marcas: [], disp: 'todos', vendemos: false, nuevos: false, existencia: 'todas', caladas: false, orden: 'nombre', modelo: null };

const ORDENES: OrdenTablero[] = ['nombre', 'sabores', 'vendidos', 'cobertura', 'recientes'];

type Lector = { get(clave: string): string | null };

/** Lee los filtros de la URL. Cualquier valor raro vuelve al valor inicial: la URL nunca rompe la pagina. */
export function leerFiltros(sp: Lector): FiltrosKaren {
  const disp = sp.get('disp');
  const exi = sp.get('exi');
  const ord = sp.get('orden');
  const marcas = (sp.get('marca') ?? '').split('|').map((m) => m.trim()).filter(Boolean).slice(0, 40);
  return {
    q: (sp.get('q') ?? '').slice(0, 80),
    marcas: [...new Set(marcas)],
    disp: disp === 'con' || disp === 'agotados' ? disp : 'todos',
    vendemos: sp.get('vendemos') === '1',
    nuevos: sp.get('nuevos') === '1',
    existencia: exi === 'con' || exi === 'sin' ? exi : 'todas',
    caladas: sp.get('caladas') === '1',
    orden: ORDENES.includes(ord as OrdenTablero) ? (ord as OrdenTablero) : 'nombre',
    modelo: /^\d{1,24}$/.test(sp.get('m') ?? '') ? sp.get('m') : null,
  };
}

/** Cadena de consulta (sin "?") solo con lo que difiere del inicial. */
export function consultaDeFiltros(f: FiltrosKaren): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.marcas.length) p.set('marca', f.marcas.join('|'));
  if (f.disp !== 'todos') p.set('disp', f.disp);
  if (f.vendemos) p.set('vendemos', '1');
  if (f.nuevos) p.set('nuevos', '1');
  if (f.existencia !== 'todas') p.set('exi', f.existencia);
  if (f.caladas) p.set('caladas', '1');
  if (f.orden !== 'nombre') p.set('orden', f.orden);
  if (f.modelo) p.set('m', f.modelo);
  return p.toString();
}

export function filtrosActivos(f: FiltrosKaren): number {
  return (f.q.trim() ? 1 : 0) + (f.marcas.length ? 1 : 0) + (f.disp !== 'todos' ? 1 : 0) + (f.vendemos ? 1 : 0) + (f.nuevos ? 1 : 0) + (f.existencia !== 'todas' ? 1 : 0);
}

/** Minusculas y sin acentos, para buscar "sandia" y encontrar "Sandía". */
export function normalizarBusqueda(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export const disponibles = (m: ModeloTablero): number => m.sabores.filter((s) => s.disponible).length;

export type EstadoDisponibilidad = 'disponible' | 'poca' | 'agotado' | 'sin_dato';

/** Disponibilidad del modelo en Karen. "Poca" = menos de la tercera parte de los sabores (y no todos agotados). */
export function estadoDisponibilidad(m: ModeloTablero): EstadoDisponibilidad {
  if (m.sin_sabores || m.sabores.length === 0) return 'sin_dato';
  const d = disponibles(m);
  if (d === 0) return 'agotado';
  return d * 3 < m.sabores.length ? 'poca' : 'disponible';
}

const coincide = (m: ModeloTablero, q: string): boolean => {
  if (!q) return true;
  const campos = [m.titulo, m.marca, m.canonico_nombre ?? '', ...m.sabores.map((s) => s.sabor)];
  return q.split(' ').every((palabra) => campos.some((c) => normalizarBusqueda(c).includes(palabra)));
};

/** Los filtros del tablero, sin los de marca cuando `ignorarMarca` (para contar por marca en el desplegable). */
export function pasaFiltros(m: ModeloTablero, f: FiltrosKaren, ignorarMarca = false): boolean {
  if (!coincide(m, normalizarBusqueda(f.q))) return false;
  if (!ignorarMarca && f.marcas.length && !f.marcas.includes(m.marca)) return false;
  if (f.disp === 'con' && disponibles(m) === 0) return false;
  if (f.disp === 'agotados' && !(m.sabores.length > 0 && disponibles(m) === 0)) return false;
  if (f.vendemos && !m.vendemos) return false;
  if (f.nuevos && !m.nuevo_semana) return false;
  if (f.existencia === 'con' && m.existencia_propia <= 0) return false;
  if (f.existencia === 'sin' && m.existencia_propia > 0) return false;
  return true;
}

const porNombre = (a: ModeloTablero, b: ModeloTablero): number => a.marca.localeCompare(b.marca, 'es') || a.titulo.localeCompare(b.titulo, 'es');

export function filtrarYOrdenar(modelos: ModeloTablero[], f: FiltrosKaren): ModeloTablero[] {
  const r = modelos.filter((m) => pasaFiltros(m, f));
  const orden: Record<OrdenTablero, (a: ModeloTablero, b: ModeloTablero) => number> = {
    nombre: porNombre,
    sabores: (a, b) => disponibles(b) - disponibles(a) || porNombre(a, b),
    vendidos: (a, b) => b.ventas_60d - a.ventas_60d || porNombre(a, b),
    // Menor cobertura primero; los que no se venden (null) al final.
    cobertura: (a, b) => (a.cobertura_dias ?? Number.MAX_SAFE_INTEGER) - (b.cobertura_dias ?? Number.MAX_SAFE_INTEGER) || porNombre(a, b),
    recientes: (a, b) => b.primera_vez.localeCompare(a.primera_vez) || porNombre(a, b),
  };
  return r.sort(orden[f.orden]);
}

export function conteoPorMarca(modelos: ModeloTablero[], f: FiltrosKaren): { marca: string; n: number }[] {
  const mapa = new Map<string, number>();
  for (const m of modelos) {
    if (!mapa.has(m.marca)) mapa.set(m.marca, 0);
    if (pasaFiltros(m, f, true)) mapa.set(m.marca, mapa.get(m.marca)! + 1);
  }
  return [...mapa].map(([marca, n]) => ({ marca, n })).sort((a, b) => a.marca.localeCompare(b.marca, 'es'));
}

/** Nombre que se ve en la tarjeta: sin las caladas salvo que el usuario las pida. */
export const nombreVisible = (m: ModeloTablero, caladas: boolean): string => (caladas ? m.titulo : sinCaladas(m.titulo));

// ---------------------------------------------------------------- avisos y recomendaciones

export interface AvisoTablero {
  clave: string;
  tono: 'info' | 'atencion' | 'accion';
  titulo: string;
  detalle: string;
  /** Modelo que abre el aviso en el panel. */
  productoId: string | null;
}

export interface EventoGlobal { clave: string; tipo: string; en: string; antes: string | null; despues: string | null; modelo: string | null }

const MS_DIA = 86_400_000;

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

const textoCobertura = (r: Recomendacion): string => {
  if (r.existencia_propia === 0) return 'sin existencia propia';
  return `cobertura de ${plural(r.cobertura_dias ?? 0, 'día', 'días')}`;
};

/**
 * Avisos compactos del tablero. Orden: recomendaciones de compra, lo que llego o se agoto en los ultimos 3 dias (agrupado por tipo) y nombres por confirmar.
 * Todo viene de la base; aqui solo se redacta.
 */
export function avisosDeTablero(d: { recomendaciones: Recomendacion[]; eventos: EventoGlobal[]; porConfirmar: number }, ahora: Date): AvisoTablero[] {
  const r: AvisoTablero[] = [];
  for (const x of d.recomendaciones) {
    const sab = x.sabores_sugeridos.length ? ` Sabores que más vendes y Karen tiene: ${x.sabores_sugeridos.join(', ')}.` : '';
    if (x.motivos.includes('reponer')) {
      r.push({ clave: `reponer:${x.producto_id}`, tono: 'accion', titulo: `Conviene pedir ${x.titulo}`, detalle: `Vendes ${plural(x.ventas_60d, 'pieza', 'piezas')} en 60 días y tienes ${textoCobertura(x)}.${sab}`, productoId: x.producto_id });
    } else if (x.motivos.includes('llego_y_vendemos')) {
      r.push({ clave: `llego:${x.producto_id}`, tono: 'accion', titulo: `Llegó con Karen algo que vendes: ${x.titulo}`, detalle: `Vendes ${plural(x.ventas_60d, 'pieza', 'piezas')} en 60 días.${sab}`, productoId: x.producto_id });
    } else {
      r.push({ clave: `agotado:${x.producto_id}`, tono: 'atencion', titulo: `Se agotó con Karen algo que vendes: ${x.titulo}`, detalle: `Vendes ${plural(x.ventas_60d, 'pieza', 'piezas')} en 60 días y tienes ${textoCobertura(x)}.`, productoId: x.producto_id });
    }
  }
  const limite = ahora.getTime() - 3 * MS_DIA;
  const recientes = d.eventos.filter((e) => new Date(e.en).getTime() >= limite);
  const grupos: { tipo: string; uno: string; varios: string; tono: AvisoTablero['tono'] }[] = [
    { tipo: 'modelo_nuevo', uno: 'modelo nuevo', varios: 'modelos nuevos', tono: 'info' },
    { tipo: 'sabor_nuevo', uno: 'sabor nuevo', varios: 'sabores nuevos', tono: 'info' },
    { tipo: 'sabor_regreso', uno: 'sabor que regresó', varios: 'sabores que regresaron', tono: 'info' },
    { tipo: 'sabor_agotado', uno: 'sabor agotado', varios: 'sabores agotados', tono: 'atencion' },
    { tipo: 'modelo_agotado', uno: 'modelo agotado', varios: 'modelos agotados', tono: 'atencion' },
  ];
  for (const g of grupos) {
    const lista = recientes.filter((e) => e.tipo === g.tipo);
    if (lista.length === 0) continue;
    const modelos = [...new Set(lista.map((e) => e.modelo).filter((x): x is string => !!x))];
    r.push({ clave: `ev:${g.tipo}`, tono: g.tono, titulo: `${plural(lista.length, g.uno, g.varios)} en los últimos 3 días`, detalle: modelos.slice(0, 4).join(', ') + (modelos.length > 4 ? ` y ${modelos.length - 4} más` : ''), productoId: null });
  }
  if (d.porConfirmar > 0) r.push({ clave: 'cola', tono: 'atencion', titulo: `${plural(d.porConfirmar, 'nombre por confirmar', 'nombres por confirmar')}`, detalle: 'El sistema no está seguro de a qué modelo o sabor propio corresponden.', productoId: null });
  return r;
}

export const ETIQUETA_EVENTO: Record<string, string> = {
  modelo_nuevo: 'Modelo nuevo', sabor_nuevo: 'Sabor nuevo', sabor_agotado: 'Sabor agotado', sabor_regreso: 'Sabor disponible de nuevo', modelo_agotado: 'Modelo agotado', renombrado: 'Cambió de nombre',
  modelo_descontinuado: 'Modelo descontinuado', sabor_descontinuado: 'Sabor descontinuado', modelo_regreso_catalogo: 'Volvió al catálogo', inestable: 'Sabor inestable', poca_variedad: 'Poca variedad',
  variedad_recuperada: 'Variedad recuperada', promocion_nueva: 'Promoción nueva', promocion_anunciada: 'Promoción anunciada', promocion_por_terminar: 'Promoción por terminar', promocion_terminada: 'Promoción terminada', lectura_retenida: 'Lectura retenida',
};

/** Tono de un evento para la linea de tiempo: lo bueno (llego), lo malo (se agoto) y lo neutro. */
export function tonoDeEvento(tipo: string): 'ok' | 'malo' | 'neutro' {
  if (['modelo_nuevo', 'sabor_nuevo', 'sabor_regreso', 'modelo_regreso_catalogo', 'variedad_recuperada'].includes(tipo)) return 'ok';
  if (['sabor_agotado', 'modelo_agotado', 'modelo_descontinuado', 'sabor_descontinuado', 'poca_variedad'].includes(tipo)) return 'malo';
  return 'neutro';
}

// ---------------------------------------------------------------- actualizar ahora

export type MotivoBloqueoActualizar = 'interruptor_apagado' | 'tope_diario' | 'enfriamiento' | 'bloqueada';

export const ENFRIAMIENTO_MINUTOS = 10;

export interface FrescuraKaren { lectura_activa: boolean; peticiones_hoy: number; tope_dia: number; ultimo_intento: string | null; bloqueada: boolean }

/** Por que no se puede actualizar ahora (null = se puede). El servidor vuelve a comprobarlo: esto solo da el mensaje claro en pantalla. */
export function bloqueoDeActualizar(f: FrescuraKaren, ahora: Date): { motivo: MotivoBloqueoActualizar; mensaje: string } | null {
  if (!f.lectura_activa) return { motivo: 'interruptor_apagado', mensaje: 'La lectura automática está apagada. Se enciende cuando lo decidas; mientras tanto no se consulta el sitio de Karen.' };
  if (f.bloqueada) return { motivo: 'bloqueada', mensaje: 'El sitio de Karen bloqueó la lectura. Un socio debe reanudarla desde el aviso.' };
  if (f.peticiones_hoy >= f.tope_dia) return { motivo: 'tope_diario', mensaje: `Se alcanzó el tope de ${f.tope_dia} peticiones de hoy. Mañana se renueva.` };
  if (f.ultimo_intento) {
    const min = (ahora.getTime() - new Date(f.ultimo_intento).getTime()) / 60_000;
    if (min >= 0 && min < ENFRIAMIENTO_MINUTOS) return { motivo: 'enfriamiento', mensaje: `Hubo una lectura hace ${Math.max(1, Math.floor(min))} min. Espera ${ENFRIAMIENTO_MINUTOS} minutos entre lecturas.` };
  }
  return null;
}

/** "hace 5 min", "hace 3 h", "hace 2 días". Fechas futuras o invalidas dan "ahora". */
export function hace(iso: string | null, ahora: Date): string {
  if (!iso) return 'sin dato';
  const ms = ahora.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return 'ahora';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

export function iniciales(marca: string): string {
  const p = marca.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? p[0]?.[1] ?? '')).toUpperCase();
}
