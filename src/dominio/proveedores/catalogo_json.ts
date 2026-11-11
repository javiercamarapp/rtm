// Parser del catalogo de datos del proveedor (JSON publico de productos y variantes).
// Construye objetos campo por campo con una lista blanca: precios y precios de comparacion se descartan en memoria
// y jamas llegan a un objeto que se persista.

import type { LecturaCatalogo, ProductoLeido, VarianteLeida } from './tipos';

export type MotivoRechazo = 'no_json' | 'formato' | 'catalogo_vacio' | 'duplicados';

export type ResultadoParseo = { ok: true; lectura: LecturaCatalogo } | { ok: false; motivo: MotivoRechazo; detalle: string };

/** Productos por pagina que pide el lector; con 250 hay que pedir la pagina siguiente. */
export const TAMANO_PAGINA = 250;

function esRegistro(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function idComoTexto(v: unknown): string | null {
  if (typeof v === 'string' && /^\d+$/.test(v)) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v);
  return null;
}

function parsearVariante(crudo: unknown, productoId: string): VarianteLeida | string {
  if (!esRegistro(crudo)) return 'variante no es objeto';
  const id = idComoTexto(crudo['id']);
  if (id === null) return 'variante sin id';
  if (typeof crudo['available'] !== 'boolean') return 'variante sin available booleano';
  const opcion = crudo['option1'];
  const titulo = crudo['title'];
  const sabor = typeof opcion === 'string' && opcion.trim() !== '' ? opcion : typeof titulo === 'string' && titulo.trim() !== '' ? titulo : null;
  if (sabor === null) return 'variante sin opcion de sabor';
  return { id, productoId, sabor: sabor.trim(), disponible: crudo['available'] };
}

function parsearProducto(crudo: unknown): ProductoLeido | string {
  if (!esRegistro(crudo)) return 'producto no es objeto';
  const id = idComoTexto(crudo['id']);
  if (id === null) return 'producto sin id';
  const titulo = crudo['title'];
  if (typeof titulo !== 'string' || titulo.trim() === '') return 'producto sin titulo';
  const variantesCrudas = crudo['variants'];
  if (!Array.isArray(variantesCrudas)) return 'producto sin lista de variantes';
  const handle = typeof crudo['handle'] === 'string' ? crudo['handle'] : '';
  const variantes: VarianteLeida[] = [];
  for (const v of variantesCrudas) {
    const r = parsearVariante(v, id);
    if (typeof r === 'string') return r;
    variantes.push(r);
  }
  return { id, handle, titulo: titulo.trim(), variantes };
}

/** Valida y filtra el cuerpo ya decodificado. */
export function parsearCatalogo(crudo: unknown): ResultadoParseo {
  if (!esRegistro(crudo) || !Array.isArray(crudo['products'])) {
    return { ok: false, motivo: 'formato', detalle: 'falta la lista products' };
  }
  const lista: unknown[] = crudo['products'];
  if (lista.length === 0) return { ok: false, motivo: 'catalogo_vacio', detalle: 'products vacio' };
  const productos: ProductoLeido[] = [];
  const productosVistos = new Set<string>();
  const variantesVistas = new Set<string>();
  for (const p of lista) {
    const r = parsearProducto(p);
    if (typeof r === 'string') return { ok: false, motivo: 'formato', detalle: r };
    if (productosVistos.has(r.id)) return { ok: false, motivo: 'duplicados', detalle: 'producto repetido' };
    productosVistos.add(r.id);
    for (const v of r.variantes) {
      if (variantesVistas.has(v.id)) return { ok: false, motivo: 'duplicados', detalle: 'variante repetida' };
      variantesVistas.add(v.id);
    }
    productos.push(r);
  }
  return { ok: true, lectura: { productos } };
}

/** Une paginas ya parseadas (la segunda solo se pide si la primera trae 250 productos). */
export function unirPaginas(paginas: LecturaCatalogo[]): ResultadoParseo {
  const productos = paginas.flatMap((p) => p.productos);
  const ids = new Set<string>();
  for (const p of productos) {
    if (ids.has(p.id)) return { ok: false, motivo: 'duplicados', detalle: 'producto repetido entre paginas' };
    ids.add(p.id);
  }
  return { ok: true, lectura: { productos } };
}

// ---------------------------------------------------------------- respuesta cruda

export interface RespuestaCruda {
  estado: number;
  tipoContenido: string;
  cuerpo: string;
}

export type ClasificacionRespuesta =
  | { tipo: 'json'; valor: unknown }
  | { tipo: 'bloqueada'; motivo: '403' | '429' | 'captcha' | 'pagina_de_edad' }
  | { tipo: 'error'; motivo: 'http' | 'red' }
  | { tipo: 'no_json' };

const SENAL_CAPTCHA = /captcha|cf-challenge|just a moment|verifica que eres humano|are you human/i;
const SENAL_EDAD = /<form[^>]*age|verificaci[oó]n de edad|eres mayor de 18/i;

/**
 * 403, 429 o captcha: la fuente esta bloqueando y no se insiste, no se rota IP ni se disfraza el agente.
 * Un cuerpo que no es JSON (pagina de edad, desafio) tambien detiene la lectura.
 */
export function clasificarRespuesta(r: RespuestaCruda): ClasificacionRespuesta {
  if (r.estado === 0) return { tipo: 'error', motivo: 'red' };
  if (r.estado === 403) return { tipo: 'bloqueada', motivo: '403' };
  if (r.estado === 429) return { tipo: 'bloqueada', motivo: '429' };
  if (SENAL_CAPTCHA.test(r.cuerpo.slice(0, 4000))) return { tipo: 'bloqueada', motivo: 'captcha' };
  if (r.estado >= 400) return { tipo: 'error', motivo: 'http' };
  if (r.estado !== 200) return { tipo: 'error', motivo: 'http' };
  const esJson = /json/i.test(r.tipoContenido);
  if (!esJson) {
    if (SENAL_EDAD.test(r.cuerpo.slice(0, 4000))) return { tipo: 'bloqueada', motivo: 'pagina_de_edad' };
    return { tipo: 'no_json' };
  }
  try {
    return { tipo: 'json', valor: JSON.parse(r.cuerpo) as unknown };
  } catch {
    return { tipo: 'no_json' };
  }
}
