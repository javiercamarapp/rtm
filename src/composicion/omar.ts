// Raiz de composicion de la vista de Omar. Las paginas y acciones de app/(omar) importan de aqui, nunca de infra.
import { cargarBodega, cargarCuenta, cargarPaquetes, explicarOmar, solicitarPiezas, type DepsOmar } from '@/aplicacion/omar/casos';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import type { ResultadoSolicitud } from '@/dominio/omar/tipos';
import { colaSolicitudesSupabase, lectorOmarSupabase } from '@/infra/supabase/omar';
import { exigirOmar } from './acceso';

/** Sesion de Omar ANTES de tocar nada: cuenta activa con rol omar o redireccion. La autoridad real sigue siendo la base (vistas con cero filas si esta desactivado). */
async function deps(): Promise<DepsOmar> {
  const { perfil } = await exigirOmar();
  return { perfil, lector: lectorOmarSupabase(), cola: colaSolicitudesSupabase() };
}

export async function bodegaDeOmar() {
  return cargarBodega(await deps());
}
export async function cuentaDeOmar(hoy: string) {
  return cargarCuenta(await deps(), hoy);
}
export async function paquetesDeOmar() {
  return cargarPaquetes(await deps());
}
export async function solicitarDeOmar(entrada: { clave: unknown; modelo: string; sabor: string; piezas: unknown }): Promise<ResultadoSolicitud> {
  return solicitarPiezas(await deps(), entrada);
}
export async function explicarDeOmar(cifra: string): Promise<Explicacion> {
  return explicarOmar(await deps(), cifra);
}
