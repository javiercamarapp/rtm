// Validacion pura del alta y la edicion de clientes, precios (tabulador con vigencia) y costos (Isaac y Karen).
// La base es la autoridad final (restricciones, vigencias, nombre unico); aqui solo se evita mandar basura y se explica el error en palabras.
import { centavosDesdeTexto } from '../dinero';

export const TIPOS_CLIENTE = ['mayoreo', 'credito_interno', 'ocasional'] as const;
export type TipoCliente = (typeof TIPOS_CLIENTE)[number];
export const ETIQUETA_TIPO: Record<TipoCliente, string> = { mayoreo: 'Mayoreo', credito_interno: 'Crédito interno', ocasional: 'Ocasional' };
export const PROVEEDORES = ['Isaac', 'Karen'] as const;
export type ProveedorCosto = (typeof PROVEEDORES)[number];

/** Tope de cordura por pieza: 100,000.00 pesos. Evita un cero de mas; la base no lo exige. */
export const TOPE_PIEZA_CENT = 10_000_000n;

export type Validado<T, K extends string> = { ok: true; valor: T } | { ok: false; errores: Partial<Record<K, string>> };

export function esFechaValida(f: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(a, mes - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === mes - 1 && t.getUTCDate() === d;
}

/** Monto escrito por una persona -> centavos > 0 y <= tope. null si no es valido. */
export function montoPositivo(texto: string): bigint | null {
  try {
    const c = centavosDesdeTexto(texto);
    return c > 0n && c <= TOPE_PIEZA_CENT ? c : null;
  } catch {
    return null;
  }
}

const idValido = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const limpio = (s: unknown): string => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');
const parecePhone = (s: string): boolean => /\d{7,}/.test(s.replace(/[\s().+-]/g, ''));

// ---- Clientes ----
export interface EntradaCliente { nombre: string; tipo: string; nota: string }
export interface ClienteValido { nombre: string; tipo: TipoCliente; nota: string | null }
export type CampoCliente = 'nombre' | 'tipo' | 'nota';

export function validarCliente(e: EntradaCliente): Validado<ClienteValido, CampoCliente> {
  const errores: Partial<Record<CampoCliente, string>> = {};
  const nombre = limpio(e.nombre);
  const nota = limpio(e.nota);
  if (nombre.length < 2) errores.nombre = 'Escribe el nombre del cliente (mínimo 2 letras).';
  else if (nombre.length > 80) errores.nombre = 'El nombre es muy largo (máximo 80 caracteres).';
  else if (parecePhone(nombre)) errores.nombre = 'Parece un teléfono. Aquí solo se guarda el nombre: sin teléfonos ni direcciones.';
  if (!(TIPOS_CLIENTE as readonly string[]).includes(e.tipo)) errores.tipo = 'Elige el tipo de cliente.';
  if (nota.length > 200) errores.nota = 'La nota es muy larga (máximo 200 caracteres).';
  else if (parecePhone(nota)) errores.nota = 'La nota parece traer un teléfono. Quítalo: no se guardan teléfonos ni direcciones.';
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, valor: { nombre, tipo: e.tipo as TipoCliente, nota: nota === '' ? null : nota } };
}

// ---- Precios ----
export interface EntradaPrecio { clienteId: number; modeloId: number; precio: string; desde: string; nota: string; precioActualCent: bigint | null; vigenteDesde: string | null }
export interface PrecioValido { clienteId: number; modeloId: number; precioCent: bigint; desde: string; origen: 'chat'; nota: string | null }
export type CampoPrecio = 'modelo' | 'precio' | 'desde' | 'nota';

export function validarPrecio(e: EntradaPrecio): Validado<PrecioValido, CampoPrecio> {
  const errores: Partial<Record<CampoPrecio, string>> = {};
  const nota = limpio(e.nota);
  if (!idValido(e.modeloId)) errores.modelo = 'Elige el modelo.';
  const cent = montoPositivo(e.precio);
  if (e.precio.trim() === '') errores.precio = 'Escribe el precio por pieza.';
  else if (cent === null) errores.precio = 'Precio no válido. Usa pesos con máximo dos decimales, por ejemplo 150 o 149.50 (mayor que cero).';
  else if (e.precioActualCent !== null && cent === e.precioActualCent) errores.precio = 'Es el mismo precio que ya está vigente: no hay nada que cambiar.';
  if (!esFechaValida(e.desde)) errores.desde = 'Elige la fecha desde la que vale el nuevo precio.';
  else if (e.vigenteDesde && e.desde <= e.vigenteDesde) errores.desde = 'La vigencia debe empezar después del último cambio (vigente desde ese día). Los precios no se corrigen hacia atrás.';
  if (nota.length > 200) errores.nota = 'La nota es muy larga (máximo 200 caracteres).';
  else if (e.precioActualCent !== null && nota === '') errores.nota = 'Escribe por qué cambia el precio (queda en el historial).';
  if (Object.keys(errores).length > 0 || cent === null) return { ok: false, errores };
  return { ok: true, valor: { clienteId: e.clienteId, modeloId: e.modeloId, precioCent: cent, desde: e.desde, origen: 'chat', nota: nota === '' ? null : nota } };
}

// ---- Costos ----
export interface EntradaCosto { proveedor: string; modeloId: number; costo: string; desde: string; fuente: string; esLista: boolean; motivo: string; supuesto: boolean; costoActualCent: bigint | null; vigenteDesde: string | null }
export interface CostoValido { proveedor: ProveedorCosto; modeloId: number; costoCent: bigint; desde: string; fuente: string; esLista: boolean; motivo: string | null; supuesto: boolean }
export type CampoCosto = 'proveedor' | 'modelo' | 'costo' | 'desde' | 'fuente' | 'motivo';

export function validarCosto(e: EntradaCosto): Validado<CostoValido, CampoCosto> {
  const errores: Partial<Record<CampoCosto, string>> = {};
  const fuente = limpio(e.fuente);
  const motivo = limpio(e.motivo);
  if (!(PROVEEDORES as readonly string[]).includes(e.proveedor)) errores.proveedor = 'Elige Isaac o Karen.';
  if (!idValido(e.modeloId)) errores.modelo = 'Elige el modelo.';
  const cent = montoPositivo(e.costo);
  if (e.costo.trim() === '') errores.costo = 'Escribe el costo por pieza.';
  else if (cent === null) errores.costo = 'Costo no válido. Usa pesos con máximo dos decimales, por ejemplo 95 o 94.50 (mayor que cero).';
  else if (e.costoActualCent !== null && cent === e.costoActualCent && e.esLista) errores.costo = 'Es el mismo costo que ya está vigente: no hay nada que cambiar.';
  if (!esFechaValida(e.desde)) errores.desde = 'Elige la fecha desde la que vale el nuevo costo.';
  else if (e.vigenteDesde && e.desde <= e.vigenteDesde) errores.desde = 'La vigencia debe empezar después del último cambio (vigente desde ese día).';
  if (fuente === '') errores.fuente = 'Escribe de dónde sale el costo (por ejemplo "lista de Isaac del 11 nov" o "me lo dijo Karen por chat").';
  else if (fuente.length > 120) errores.fuente = 'La fuente es muy larga (máximo 120 caracteres).';
  if (!e.esLista && motivo === '') errores.motivo = 'Si no es el costo de lista, escribe el motivo (por ejemplo "promoción de fin de mes").';
  else if (motivo.length > 200) errores.motivo = 'El motivo es muy largo (máximo 200 caracteres).';
  if (Object.keys(errores).length > 0 || cent === null) return { ok: false, errores };
  return { ok: true, valor: { proveedor: e.proveedor as ProveedorCosto, modeloId: e.modeloId, costoCent: cent, desde: e.desde, fuente, esLista: e.esLista, motivo: motivo === '' ? null : motivo, supuesto: e.supuesto } };
}

/** Vista previa de un cambio de precio para la confirmacion: solo compara dos numeros ya conocidos; los margenes los calcula la base al guardar. */
export type CambioPrecio = { tipo: 'nuevo'; nuevoCent: bigint } | { tipo: 'sube' | 'baja'; actualCent: bigint; nuevoCent: bigint; diferenciaCent: bigint };
export function describirCambio(actualCent: bigint | null, nuevoCent: bigint): CambioPrecio {
  if (actualCent === null) return { tipo: 'nuevo', nuevoCent };
  const dif = nuevoCent - actualCent;
  return { tipo: dif >= 0n ? 'sube' : 'baja', actualCent, nuevoCent, diferenciaCent: dif >= 0n ? dif : -dif };
}
