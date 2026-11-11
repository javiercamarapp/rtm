// Resolucion de alias de clientes, modelos, sabores y proveedores. Codigo puro: el modelo de lenguaje nunca resuelve.
// Regla de oro: cualquier duda produce PREGUNTA, nunca un valor por omision.
//   unico   -> continuar mostrando el nombre resuelto
//   varios  -> preguntar con botones
//   ninguno -> preguntar (con sugerencias cercanas, que nunca deciden)
//   vacio   -> preguntar
import { normalizar } from '../catalogo/normalizar';
import type { Miembro } from './tipos';

export interface EntradaCatalogo {
  id: string;
  nombre: string;
  alias: readonly string[];
}

export interface Candidato {
  id: string;
  nombre: string;
}

export type MotivoVarios = 'alias_compartido' | 'tokens' | 'regla';

export type Resolucion =
  | { estado: 'unico'; id: string; nombre: string; via: 'exacto' | 'tokens' }
  | { estado: 'varios'; candidatos: Candidato[]; motivo: MotivoVarios }
  | { estado: 'ninguno'; sugerencias: Candidato[] }
  | { estado: 'vacio' };

/** Ids reservados para las opciones de "Omar" a secas. */
export const ID_TOMA_OMAR_BODEGA = 'bodega_omar';

/** Textos de modelo que SIEMPRE se preguntan: el precio de venta es igual pero costo e inventario difieren entre variantes. */
const MODELOS_SIEMPRE_AMBIGUOS: ReadonlySet<string> = new Set(['waka 50', 'waka 50k']);

function tokenCoincide(q: string, n: string): boolean {
  if (q === n) return true;
  if (/^\d+$/.test(q)) return n === `${q}k`;
  return q.length >= 3 && !/\d/.test(q) && n.startsWith(q);
}

function tokensCoinciden(consulta: readonly string[], nombre: readonly string[]): boolean {
  const libres = [...nombre];
  for (const q of consulta) {
    const i = libres.findIndex((n) => tokenCoincide(q, n));
    if (i < 0) return false;
    libres.splice(i, 1);
  }
  return true;
}

function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0]!;
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = fila[j]!;
      fila[j] = Math.min(fila[j]! + 1, fila[j - 1]! + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = guardado;
    }
  }
  return fila[b.length]!;
}

function sugerenciasCercanas(q: string, catalogo: readonly EntradaCatalogo[]): Candidato[] {
  const tolerancia = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
  if (tolerancia === 0) return [];
  const salida: Candidato[] = [];
  for (const e of catalogo) {
    const nombres = [e.nombre, ...e.alias].map(normalizar);
    const cerca = nombres.some((n) => [n, ...n.split(' ')].some((t) => Math.abs(t.length - q.length) <= tolerancia && distancia(q, t) <= tolerancia));
    if (cerca) salida.push({ id: e.id, nombre: e.nombre });
  }
  return salida.slice(0, 4);
}

function candidatosPorTokens(q: string, catalogo: readonly EntradaCatalogo[]): Candidato[] {
  const consulta = q.split(' ');
  return catalogo
    .filter((e) => [e.nombre, ...e.alias].some((n) => tokensCoinciden(consulta, normalizar(n).split(' '))))
    .map((e) => ({ id: e.id, nombre: e.nombre }));
}

function resolverContra(
  texto: string,
  catalogo: readonly EntradaCatalogo[],
  siempreAmbiguos: ReadonlySet<string>,
): Resolucion {
  const q = normalizar(texto);
  if (q === '') return { estado: 'vacio' };

  if (siempreAmbiguos.has(q)) {
    const candidatos = candidatosPorTokens(q, catalogo);
    return candidatos.length === 0
      ? { estado: 'ninguno', sugerencias: [] }
      : { estado: 'varios', candidatos, motivo: 'regla' };
  }

  const exactos = catalogo.filter((e) => [e.nombre, ...e.alias].some((n) => normalizar(n) === q));
  if (exactos.length === 1) return { estado: 'unico', id: exactos[0]!.id, nombre: exactos[0]!.nombre, via: 'exacto' };
  if (exactos.length > 1) {
    return { estado: 'varios', candidatos: exactos.map((e) => ({ id: e.id, nombre: e.nombre })), motivo: 'alias_compartido' };
  }

  const porTokens = candidatosPorTokens(q, catalogo);
  if (porTokens.length === 1) return { estado: 'unico', id: porTokens[0]!.id, nombre: porTokens[0]!.nombre, via: 'tokens' };
  if (porTokens.length > 1) return { estado: 'varios', candidatos: porTokens, motivo: 'tokens' };

  return { estado: 'ninguno', sugerencias: sugerenciasCercanas(q, catalogo) };
}

export function resolverModelo(texto: string, catalogo: readonly EntradaCatalogo[]): Resolucion {
  return resolverContra(texto, catalogo, MODELOS_SIEMPRE_AMBIGUOS);
}

export function resolverSabor(texto: string, saboresEnExistencia: readonly EntradaCatalogo[]): Resolucion {
  return resolverContra(texto, saboresEnExistencia, new Set());
}

export type ResolucionCliente = Resolucion | { estado: 'toma_propia' };

/**
 * Cliente por alias. "Omar" a secas:
 *  - escrito por Omar: es su toma propia (bodega);
 *  - escrito por un socio: SIEMPRE se pregunta entre la toma de la bodega y un cliente llamado Omar (nunca se elige solo).
 */
export function resolverCliente(
  texto: string,
  clientes: readonly EntradaCatalogo[],
  autor: Pick<Miembro, 'rol'>,
): ResolucionCliente {
  if (normalizar(texto) === 'omar') {
    if (autor.rol === 'omar') return { estado: 'toma_propia' };
    const comoCliente = clientes
      .filter((c) => normalizar(c.nombre).split(' ')[0] === 'omar')
      .map((c) => ({ id: c.id, nombre: `${c.nombre} (cliente)` }));
    return {
      estado: 'varios',
      candidatos: [{ id: ID_TOMA_OMAR_BODEGA, nombre: 'Toma de Omar (bodega)' }, ...comoCliente],
      motivo: 'regla',
    };
  }
  return resolverContra(texto, clientes, new Set());
}

export type IdProveedor = 'isaac' | 'karen';

const ALIAS_PROVEEDOR: Readonly<Record<string, IdProveedor>> = {
  isaac: 'isaac',
  karen: 'karen',
  vapemate: 'karen',
  'vape mate': 'karen',
};

export type ResolucionProveedor =
  | { estado: 'unico'; id: IdProveedor; nombre: 'Isaac' | 'Karen' }
  | { estado: 'varios'; candidatos: Candidato[] }
  | { estado: 'ninguno' }
  | { estado: 'vacio' };

/** Karen y Vapemate son el mismo proveedor. "Mr Cactus" NO es alias (se pregunta). Dos proveedores en una indicacion: se pregunta. */
export function resolverProveedor(texto: string): ResolucionProveedor {
  const q = normalizar(texto);
  if (q === '') return { estado: 'vacio' };
  const hallados = new Set<IdProveedor>();
  for (const [alias, id] of Object.entries(ALIAS_PROVEEDOR)) {
    if (` ${q} `.includes(` ${alias} `)) hallados.add(id);
  }
  if (hallados.size === 0) return { estado: 'ninguno' };
  if (hallados.size > 1) {
    return { estado: 'varios', candidatos: [{ id: 'isaac', nombre: 'Isaac' }, { id: 'karen', nombre: 'Karen' }] };
  }
  const id = [...hallados][0]!;
  return { estado: 'unico', id, nombre: id === 'isaac' ? 'Isaac' : 'Karen' };
}
