// Casos de uso del alta y la edicion de clientes, precios y costos. Validan, llaman al puerto (funciones api.* de escritura) y devuelven un eco en palabras.
// El puerto lo implementa infra/supabase; si la funcion SQL aun no existe (ver docs/pendiente-sql-alta.md) el adaptador lanza ErrorAltaNegocio con codigo NO_INSTALADA.
import {
  validarCliente, validarCosto, validarPrecio,
  type CampoCliente, type CampoCosto, type CampoPrecio, type ClienteValido, type CostoValido, type EntradaCliente, type EntradaCosto, type EntradaPrecio, type PrecioValido,
} from '@/dominio/catalogo/alta';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import type { LectorCatalogo } from './puertos';

export class ErrorAltaNegocio extends Error {
  constructor(message: string, readonly codigo: string | null) {
    super(message);
  }
}

export interface CostoHistorico { proveedor: 'Isaac' | 'Karen'; costoCent: bigint; desde: string; hasta: string | null; fuente: string; esLista: boolean; motivo: string | null; supuesto: boolean; vigente: boolean }

export interface AltaCatalogo {
  crearCliente(clave: string, d: ClienteValido): Promise<{ clienteId: number; creado: boolean }>;
  editarCliente(clave: string, clienteId: number, d: ClienteValido & { activo: boolean }): Promise<{ clienteId: number }>;
  fijarPrecio(clave: string, d: PrecioValido): Promise<{ precioId: number; sinCambio: boolean }>;
  fijarCosto(clave: string, d: CostoValido): Promise<{ costoId: number; sinCambio: boolean }>;
  historialCostos(modeloId: number): Promise<CostoHistorico[]>;
}

export type ResultadoAlta<K extends string> =
  | { ok: true; eco: string; id: number; sinCambio: boolean }
  | { ok: false; mensaje: string; errores: Partial<Record<K, string>> };

const CLAVE = /^web:[0-9a-f-]{8,64}$/;
const falla = <K extends string>(mensaje: string, errores: Partial<Record<K, string>> = {}): ResultadoAlta<K> => ({ ok: false, mensaje, errores });

const MENSAJES: Record<string, string> = {
  P0422: 'La vigencia cae antes del último cambio registrado. Elige una fecha posterior.',
  P0409: 'Esa operación ya se había enviado con otros datos. Recarga la página.',
  '22023': 'El cliente o el modelo ya no existe. Recarga la página.',
  '23505': 'Ya existe otro cliente con ese nombre.',
  '23P01': 'Esa vigencia se cruza con otra ya registrada. Revisa las fechas.',
  '42501': 'Tu sesión no tiene permiso para esto.',
};

/** Convierte cualquier falla del puerto en un mensaje en espanol, sin filtrar texto tecnico de la base. */
export function mensajeDeFalla(e: unknown): string {
  if (e instanceof ErrorAltaNegocio) {
    if (e.codigo === 'NO_INSTALADA') return e.message;
    return (e.codigo && MENSAJES[e.codigo]) || e.message || 'No se pudo guardar. Intenta de nuevo.';
  }
  return 'No se pudo guardar. Intenta de nuevo.';
}

async function ejecutar<K extends string, T>(clave: string, hacer: () => Promise<T>, eco: (r: T) => ResultadoAlta<K>): Promise<ResultadoAlta<K>> {
  if (!CLAVE.test(clave)) return falla('Falta la clave de la operación. Recarga la página.');
  try {
    return eco(await hacer());
  } catch (e) {
    return falla(mensajeDeFalla(e));
  }
}

export async function altaCliente(p: AltaCatalogo, clave: string, entrada: EntradaCliente): Promise<ResultadoAlta<CampoCliente>> {
  const v = validarCliente(entrada);
  if (!v.ok) return falla('Revisa los campos marcados.', v.errores);
  return ejecutar(clave, () => p.crearCliente(clave, v.valor), (r) => ({
    ok: true, id: r.clienteId, sinCambio: !r.creado,
    eco: r.creado ? `Cliente creado: ${v.valor.nombre}.` : `Ya existía un cliente con el nombre ${v.valor.nombre}: no se duplicó.`,
  }));
}

export async function edicionCliente(p: AltaCatalogo, clave: string, clienteId: number, entrada: EntradaCliente & { activo: boolean }): Promise<ResultadoAlta<CampoCliente>> {
  if (!Number.isInteger(clienteId) || clienteId <= 0) return falla('Cliente no válido.');
  const v = validarCliente(entrada);
  if (!v.ok) return falla('Revisa los campos marcados.', v.errores);
  return ejecutar(clave, () => p.editarCliente(clave, clienteId, { ...v.valor, activo: entrada.activo }), (r) => ({
    ok: true, id: r.clienteId, sinCambio: false,
    eco: `Cliente actualizado: ${v.valor.nombre}${entrada.activo ? '' : ' (inactivo: ya no aparece para pedidos nuevos)'}.`,
  }));
}

export async function altaPrecio(p: AltaCatalogo, clave: string, entrada: EntradaPrecio, nombres: { cliente: string; modelo: string }): Promise<ResultadoAlta<CampoPrecio>> {
  const v = validarPrecio(entrada);
  if (!v.ok) return falla('Revisa los campos marcados.', v.errores);
  return ejecutar(clave, () => p.fijarPrecio(clave, v.valor), (r) => ({
    ok: true, id: r.precioId, sinCambio: r.sinCambio,
    eco: r.sinCambio
      ? `Sin cambio: ${nombres.modelo} ya valía ${formatearMoneda(v.valor.precioCent)} para ${nombres.cliente}.`
      : `Precio guardado: ${nombres.modelo} a ${formatearMoneda(v.valor.precioCent)} por pieza para ${nombres.cliente}, desde el ${etiquetaFecha(v.valor.desde)}. El anterior queda en el historial.`,
  }));
}

export interface SolicitudPrecio { clienteId: number; modeloId: number; precio: string; desde: string; nota: string }
export interface SolicitudCosto { proveedor: string; modeloId: number; costo: string; desde: string; fuente: string; esLista: boolean; motivo: string; supuesto: boolean }

/** El servidor es la autoridad: busca el precio vigente y los nombres en la base; nunca confia en lo que el navegador dice del estado actual. */
export async function precioDeSolicitud(lector: Pick<LectorCatalogo, 'ficha' | 'modelos'>, p: AltaCatalogo, clave: string, s: SolicitudPrecio): Promise<ResultadoAlta<CampoPrecio>> {
  let ficha, modelos;
  try {
    [ficha, modelos] = await Promise.all([lector.ficha(s.clienteId), lector.modelos()]);
  } catch {
    return falla('No se pudo leer el tabulador del cliente. Intenta de nuevo.');
  }
  const modelo = modelos.find((m) => m.id === s.modeloId);
  if (!ficha || !modelo) return falla('El cliente o el modelo ya no existe. Recarga la página.');
  const actual = ficha.tabulador.find((t) => t.modeloId === s.modeloId);
  return altaPrecio(p, clave, { ...s, precioActualCent: actual?.precioCent ?? null, vigenteDesde: actual?.desde ?? null }, { cliente: ficha.nombre, modelo: `${modelo.marca} ${modelo.nombre}` });
}

export async function costoDeSolicitud(lector: Pick<LectorCatalogo, 'modelos'>, p: AltaCatalogo, clave: string, s: SolicitudCosto): Promise<ResultadoAlta<CampoCosto>> {
  let modelos;
  try {
    modelos = await lector.modelos();
  } catch {
    return falla('No se pudo leer el catálogo. Intenta de nuevo.');
  }
  const modelo = modelos.find((m) => m.id === s.modeloId);
  if (!modelo) return falla('El modelo ya no existe. Recarga la página.');
  const actual = modelo.costos.find((c) => c.proveedor === s.proveedor);
  return altaCosto(p, clave, { ...s, costoActualCent: actual?.costoCent ?? null, vigenteDesde: actual?.desde ?? null }, `${modelo.marca} ${modelo.nombre}`);
}

export async function altaCosto(p: AltaCatalogo, clave: string, entrada: EntradaCosto, modelo: string): Promise<ResultadoAlta<CampoCosto>> {
  const v = validarCosto(entrada);
  if (!v.ok) return falla('Revisa los campos marcados.', v.errores);
  return ejecutar(clave, () => p.fijarCosto(clave, v.valor), (r) => ({
    ok: true, id: r.costoId, sinCambio: r.sinCambio,
    eco: r.sinCambio
      ? `Sin cambio: ${modelo} ya costaba ${formatearMoneda(v.valor.costoCent)} con ${v.valor.proveedor}.`
      : `Costo guardado: ${modelo} a ${formatearMoneda(v.valor.costoCent)} por pieza con ${v.valor.proveedor}, desde el ${etiquetaFecha(v.valor.desde)}${v.valor.supuesto ? ' (supuesto)' : ''}. El anterior queda en el historial.`,
  }));
}
