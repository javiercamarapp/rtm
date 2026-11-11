// Normalizacion de modelos y sabores del proveedor contra el catalogo propio y los alias. Determinista: costo de IA cero.
// Capas: (1) limpieza, (2) alias confirmados (un alias puede apuntar a un GRUPO de modelos), (3) similitud de trigramas.
// Un nombre sin resolver NO bloquea la lectura: queda "pendiente" en una cola de confirmacion para el dueno.

import { normalizar } from '@/dominio/catalogo/normalizar';
import type { ElementoCola, EstadoMapeo, Instante } from './tipos';

export const UMBRAL_COLA_MIN = 0.6;
export const UMBRAL_AUTO = 0.9;

export interface ModeloCanonico {
  id: string;
  nombre: string;
}
export interface AliasModelo {
  alias: string;
  modeloIds: string[];
}
export interface SaborCanonico {
  id: string;
  nombre: string;
}
export interface AliasSabor {
  textoNorm: string;
  saborId: string;
}

export interface ContextoNormalizacion {
  modelos: ModeloCanonico[];
  aliasModelos: AliasModelo[];
  sabores: SaborCanonico[];
  /** Pares ya confirmados por un socio: no se vuelve a preguntar. */
  aliasSabores: AliasSabor[];
  /** Pares rechazados por un socio (`tipo|textoNorm|id`): no se vuelven a sugerir. */
  descartados: string[];
}

export function contextoVacio(): ContextoNormalizacion {
  return { modelos: [], aliasModelos: [], sabores: [], aliasSabores: [], descartados: [] };
}

// ---------------------------------------------------------------- limpieza

/**
 * Minusculas, sin acentos, sin comas de miles ("60,000" = "60k"), sin espacios dobles.
 * Un numero de miles redondos solo se abrevia cuando va solo ("8000" -> "8k"), nunca dentro de un codigo ("te6000").
 */
export function normalizarModelo(titulo: string): string {
  const sinComas = titulo.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const base = normalizar(sinComas);
  return base
    .split(' ')
    .map((t) => {
      const m = /^(\d{1,3})000$/.exec(t);
      return m ? `${m[1]}k` : t;
    })
    .join(' ');
}

/** Clave compacta para comparar "Elf Bar" con "ELFBAR". */
export function claveCompacta(norm: string): string {
  return norm.replace(/ /g, '');
}

/** Sabor: limpieza basica y se quita la palabra "ice" solo para comparar (el original se conserva). */
export function normalizarSabor(sabor: string): string {
  return normalizar(sabor)
    .split(' ')
    .filter((t) => t !== 'ice')
    .join(' ')
    .trim();
}

// ---------------------------------------------------------------- similitud (misma idea que pg_trgm)

function trigramas(texto: string): Set<string> {
  const out = new Set<string>();
  for (const palabra of texto.split(' ').filter(Boolean)) {
    const p = `  ${palabra} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** Coeficiente de Jaccard sobre trigramas, de 0 a 1. */
export function similitudTrigramas(a: string, b: string): number {
  const ta = trigramas(a);
  const tb = trigramas(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let comunes = 0;
  for (const t of ta) if (tb.has(t)) comunes++;
  return comunes / (ta.size + tb.size - comunes);
}

// ---------------------------------------------------------------- modelos

export type ResolucionModelo =
  | { tipo: 'exacto'; canonicoId: string }
  | { tipo: 'alias'; canonicoId: string }
  | { tipo: 'grupo'; ids: string[] }
  | { tipo: 'sugerido'; canonicoId: string; similitud: number }
  | { tipo: 'sin_resolver' };

export function resolverModelo(titulo: string, ctx: ContextoNormalizacion): ResolucionModelo {
  const norm = normalizarModelo(titulo);
  const clave = claveCompacta(norm);
  if (clave === '') return { tipo: 'sin_resolver' };
  for (const m of ctx.modelos) if (claveCompacta(normalizarModelo(m.nombre)) === clave) return { tipo: 'exacto', canonicoId: m.id };
  for (const a of ctx.aliasModelos) {
    if (claveCompacta(normalizarModelo(a.alias)) !== clave) continue;
    if (a.modeloIds.length === 1) return { tipo: 'alias', canonicoId: a.modeloIds[0]! };
    if (a.modeloIds.length > 1) return { tipo: 'grupo', ids: [...a.modeloIds] };
  }
  let mejor: { id: string; s: number } | null = null;
  for (const m of ctx.modelos) {
    if (ctx.descartados.includes(`modelo|${norm}|${m.id}`)) continue;
    const s = similitudTrigramas(norm, normalizarModelo(m.nombre));
    if (s >= UMBRAL_COLA_MIN && (mejor === null || s > mejor.s)) mejor = { id: m.id, s };
  }
  // Un modelo nunca se vincula solo por similitud: afecta pedidos y costos. Siempre queda por confirmar.
  return mejor ? { tipo: 'sugerido', canonicoId: mejor.id, similitud: mejor.s } : { tipo: 'sin_resolver' };
}

// ---------------------------------------------------------------- sabores

export type ResolucionSabor =
  | { tipo: 'confirmado'; saborId: string }
  | { tipo: 'exacto'; saborId: string }
  | { tipo: 'auto'; saborId: string; similitud: number }
  | { tipo: 'por_confirmar'; saborId: string; similitud: number }
  | { tipo: 'sin_resolver' };

export function resolverSabor(sabor: string, ctx: ContextoNormalizacion): ResolucionSabor {
  const norm = normalizarSabor(sabor);
  if (norm === '') return { tipo: 'sin_resolver' };
  const confirmado = ctx.aliasSabores.find((a) => a.textoNorm === norm);
  if (confirmado) return { tipo: 'confirmado', saborId: confirmado.saborId };
  for (const s of ctx.sabores) if (normalizarSabor(s.nombre) === norm) return { tipo: 'exacto', saborId: s.id };
  let mejor: { id: string; s: number } | null = null;
  for (const s of ctx.sabores) {
    if (ctx.descartados.includes(`sabor|${norm}|${s.id}`)) continue;
    const sim = similitudTrigramas(norm, normalizarSabor(s.nombre));
    if (mejor === null || sim > mejor.s) mejor = { id: s.id, s: sim };
  }
  if (mejor && mejor.s >= UMBRAL_AUTO) return { tipo: 'auto', saborId: mejor.id, similitud: mejor.s };
  if (mejor && mejor.s >= UMBRAL_COLA_MIN) return { tipo: 'por_confirmar', saborId: mejor.id, similitud: mejor.s };
  return { tipo: 'sin_resolver' };
}

export function mapeoDeSabor(r: ResolucionSabor): { mapeo: EstadoMapeo; saborCanonicoId: string | null } {
  switch (r.tipo) {
    case 'confirmado':
      return { mapeo: 'confirmado', saborCanonicoId: r.saborId };
    case 'exacto':
    case 'auto':
      return { mapeo: 'auto', saborCanonicoId: r.saborId };
    default:
      return { mapeo: 'pendiente', saborCanonicoId: null };
  }
}

export function mapeoDeModelo(r: ResolucionModelo): { mapeo: EstadoMapeo; canonicoId: string | null; gruposCandidatos: string[] } {
  switch (r.tipo) {
    case 'exacto':
    case 'alias':
      return { mapeo: 'auto', canonicoId: r.canonicoId, gruposCandidatos: [] };
    case 'grupo':
      return { mapeo: 'pendiente', canonicoId: null, gruposCandidatos: r.ids };
    case 'sugerido':
      return { mapeo: 'pendiente', canonicoId: null, gruposCandidatos: [] };
    case 'sin_resolver':
      return { mapeo: 'pendiente', canonicoId: null, gruposCandidatos: [] };
  }
}

// ---------------------------------------------------------------- cola de confirmacion

/** Agrega a la cola sin duplicar (`tipo|textoNorm`). Devuelve la cola nueva y si agrego algo. */
export function encolar(cola: ElementoCola[], nuevo: ElementoCola): { cola: ElementoCola[]; agregado: boolean } {
  if (cola.some((e) => e.tipo === nuevo.tipo && e.textoNorm === nuevo.textoNorm)) return { cola, agregado: false };
  return { cola: [...cola, nuevo], agregado: true };
}

export function elementoDeCola(tipo: 'modelo' | 'sabor', textoOriginal: string, en: Instante, sugerenciaId: string | null, similitud: number | null): ElementoCola {
  const textoNorm = tipo === 'modelo' ? normalizarModelo(textoOriginal) : normalizarSabor(textoOriginal);
  return { tipo, textoOriginal, textoNorm, sugerenciaId, similitud, creada: en };
}

/** Un socio confirma un par: se guarda como alias y sale de la cola ("lo confirmado no se vuelve a preguntar"). */
export function confirmarPar(cola: ElementoCola[], ctx: ContextoNormalizacion, tipo: 'modelo' | 'sabor', textoNorm: string, canonicoId: string): { cola: ElementoCola[]; ctx: ContextoNormalizacion } {
  const restante = cola.filter((e) => !(e.tipo === tipo && e.textoNorm === textoNorm));
  if (tipo === 'sabor') {
    return { cola: restante, ctx: { ...ctx, aliasSabores: [...ctx.aliasSabores.filter((a) => a.textoNorm !== textoNorm), { textoNorm, saborId: canonicoId }] } };
  }
  const aliasModelos = [...ctx.aliasModelos.filter((a) => claveCompacta(normalizarModelo(a.alias)) !== claveCompacta(textoNorm)), { alias: textoNorm, modeloIds: [canonicoId] }];
  return { cola: restante, ctx: { ...ctx, aliasModelos } };
}

/** Un socio rechaza la sugerencia: no se vuelve a proponer ese par. */
export function descartarPar(cola: ElementoCola[], ctx: ContextoNormalizacion, tipo: 'modelo' | 'sabor', textoNorm: string, sugerenciaId: string): { cola: ElementoCola[]; ctx: ContextoNormalizacion } {
  const restante = cola.filter((e) => !(e.tipo === tipo && e.textoNorm === textoNorm));
  return { cola: restante, ctx: { ...ctx, descartados: [...ctx.descartados, `${tipo}|${textoNorm}|${sugerenciaId}`] } };
}

// ---------------------------------------------------------------- marca y puffs derivados del titulo

const MARCAS = [
  'Waka',
  'Elf Bar',
  'Geek Bar',
  'Lost Mary',
  'Pillow Talk',
  'iPlay',
  'HCigar',
  'Fasta',
  'Nexa',
  'Instabar',
  'Fifty Bar',
  'Hyper Bar',
  'Bugatti',
  'Bot It',
  'Naked',
  'Snowwolf',
  'Tyson',
  'Lightrise',
  'Wonder',
  'Kros',
  'Death Row',
  'Orion Bar',
  'Fire',
  'Vfly',
  'iJoy',
  'V-Play',
];

const MARCAS_ORDENADAS = [...MARCAS].sort((a, b) => claveCompacta(normalizar(b)).length - claveCompacta(normalizar(a)).length);

/** Marca (por prefijo del titulo) y puffs (numero de miles o de 4 a 6 cifras). */
export function derivarMarcaYPuffs(titulo: string): { marca: string; puffs: number | null } {
  const norm = normalizarModelo(titulo);
  const compacto = claveCompacta(norm);
  let marca = '';
  for (const m of MARCAS_ORDENADAS) {
    if (compacto.startsWith(claveCompacta(normalizar(m)))) {
      marca = m;
      break;
    }
  }
  if (marca === '') {
    const primera = norm.split(' ')[0] ?? '';
    marca = primera === '' ? 'Sin marca' : primera.charAt(0).toUpperCase() + primera.slice(1);
  }
  let puffs: number | null = null;
  for (const t of norm.split(' ')) {
    const k = /^(\d{1,3})k$/.exec(t);
    if (k) puffs = Number(k[1]) * 1000;
    const suelto = /^(?:[a-z]{0,3})(\d{4,6})$/.exec(t);
    if (suelto && puffs === null) puffs = Number(suelto[1]);
  }
  return { marca, puffs };
}
