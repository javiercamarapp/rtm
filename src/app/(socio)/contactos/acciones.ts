'use server';

import { lectorContactosDeSocio } from '@/composicion/contactos';
import { aCsv, type FiltroContactos } from '@/dominio/contactos/vista';

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function filtroSeguro(f: Partial<FiltroContactos> | undefined): FiltroContactos {
  return { busqueda: texto(f?.busqueda, 80), origen: texto(f?.origen, 80), anuncio: texto(f?.anuncio, 200), colonia: texto(f?.colonia, 120) };
}

export type RespuestaRevelar = { ok: true; telefonos: string[] } | { ok: false; mensaje: string };
export type RespuestaExportar = { ok: true; csv: string; total: number } | { ok: false; mensaje: string };

/** Revela los telefonos de un contacto. La base deja el registro (quien, cuando); sin sesion de socio no llega a la base. */
export async function revelarTelefono(id: number): Promise<RespuestaRevelar> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, mensaje: 'Solicitud inválida.' };
  try {
    return { ok: true, telefonos: await (await lectorContactosDeSocio()).revelar(id, 'revelar en pantalla') };
  } catch {
    return { ok: false, mensaje: 'No se pudo revelar el teléfono. Intenta de nuevo.' };
  }
}

/** Exporta la seleccion (ids) o todo el filtro (ids null). Cada contacto exportado queda registrado en la base. */
export async function exportarContactos(ids: number[] | null, filtro: Partial<FiltroContactos>): Promise<RespuestaExportar> {
  if (ids !== null && (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || ids.some((i) => !Number.isInteger(i) || i < 1))) return { ok: false, mensaje: 'Selección inválida.' };
  try {
    const filas = await (await lectorContactosDeSocio()).exportar(ids, filtroSeguro(filtro));
    return { ok: true, csv: aCsv(filas), total: filas.length };
  } catch {
    return { ok: false, mensaje: 'No se pudo exportar. Intenta de nuevo.' };
  }
}
