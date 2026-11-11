'use server';

import { inventarioDeSocio, exportarInventarioDeSocio, operarConteo, type ResultadoInventario } from '@/composicion/inventario';
import type { InventarioExportado } from '@/aplicacion/inventario/exportar';
import { EXPLICACIONES_CONTEO, type ExplicacionConteo, type ParametrosInventario, type PrevisualizacionConteo, type VersionInventario } from '@/dominio/inventario/tipos';

const CLAVE = /^web:[0-9a-f-]{8,64}$/;

function paramsValidos(p: Partial<ParametrosInventario>): Partial<ParametrosInventario> {
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() !== '' && v.length <= 80 ? v.trim() : null);
  return {
    marca: texto(p.marca), modelo: texto(p.modelo), solo_socios_venden: p.solo_socios_venden === true, solo_disponibles: p.solo_disponibles === true,
    mostrar_cantidades: p.mostrar_cantidades === true, con_caladas: p.con_caladas === true,
    cliente_id: typeof p.cliente_id === 'number' && Number.isInteger(p.cliente_id) && p.cliente_id > 0 ? p.cliente_id : null,
  };
}

/** Exporta el inventario en PDF (version clientes o interna). Idempotente por la clave del formulario. */
export async function exportarInventarioAccion(claveIdem: string, version: VersionInventario, params: Partial<ParametrosInventario>): Promise<ResultadoInventario<InventarioExportado>> {
  if (!CLAVE.test(claveIdem) || (version !== 'clientes' && version !== 'interna')) return { ok: false, mensaje: 'Solicitud inválida. Recarga la página.' };
  return exportarInventarioDeSocio(claveIdem, version, paramsValidos(params));
}

export async function previsualizarConteoAccion(ubicacion: string, lineas: { sku_id: number; contado: number }[]): Promise<PrevisualizacionConteo> {
  if (!/^[a-z_]{3,30}$/.test(ubicacion) || lineas.length === 0 || lineas.length > 2000) throw new Error('solicitud invalida');
  const limpias = lineas.map((l) => {
    if (!Number.isInteger(l.sku_id) || !Number.isInteger(l.contado) || l.contado < 0 || l.contado > 100000) throw new Error('cantidad invalida');
    return { sku_id: l.sku_id, contado: l.contado };
  });
  return (await inventarioDeSocio()).conteoPrevisualizar(ubicacion, limpias);
}

/** Abre y cierra el conteo en un paso (el conteo exige fecha y hora de cuando se conto). Idempotente por la clave del formulario. */
export async function cerrarConteoAccion(
  claveIdem: string, ubicacion: string, contadoAt: string, lineas: { sku_id: number; contado: number; explicacion_tipo?: string | null; explicacion_ref?: string | null }[],
): Promise<ResultadoInventario<{ conteo_id: number; ajustes: number }>> {
  if (!CLAVE.test(claveIdem) || !/^[a-z_]{3,30}$/.test(ubicacion) || Number.isNaN(Date.parse(contadoAt)) || lineas.length === 0 || lineas.length > 2000) return { ok: false, mensaje: 'Solicitud inválida. Recarga la página.' };
  const limpias: { sku_id: number; contado: number; explicacion_tipo: ExplicacionConteo | null; explicacion_ref: string | null }[] = [];
  for (const l of lineas) {
    if (!Number.isInteger(l.sku_id) || !Number.isInteger(l.contado) || l.contado < 0 || l.contado > 100000) return { ok: false, mensaje: 'Hay una cantidad contada inválida.' };
    const tipo = l.explicacion_tipo && (EXPLICACIONES_CONTEO as readonly string[]).includes(l.explicacion_tipo) ? (l.explicacion_tipo as ExplicacionConteo) : null;
    limpias.push({ sku_id: l.sku_id, contado: l.contado, explicacion_tipo: tipo, explicacion_ref: l.explicacion_ref ? l.explicacion_ref.slice(0, 200) : null });
  }
  return operarConteo(async (e) => {
    const { conteo_id } = await e.abrirConteo(`${claveIdem}:abrir`, ubicacion, 'semanal', new Date(contadoAt).toISOString());
    return e.cerrarConteo(`${claveIdem}:cerrar`, conteo_id, limpias);
  });
}
