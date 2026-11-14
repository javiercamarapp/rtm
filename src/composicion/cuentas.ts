// Raiz de composicion de la pantalla Cuentas. Las paginas y acciones de app/(socio)/cuentas importan de aqui, nunca de infra.
import { cambiarCorreo, cambiarEstado, darDeAlta } from '@/aplicacion/cuentas/cuentas';
import type { EntradaAlta, ListaCuentas } from '@/dominio/cuentas/cuentas';
import { cuentasSupabase } from '@/infra/supabase/cuentas';
import { exigirSocio } from './acceso';

/** Guarda de socio ANTES de tocar nada; la base valida el rol de nuevo dentro de cada funcion. */
export async function cuentasDeSocio(): Promise<ListaCuentas> {
  await exigirSocio();
  return cuentasSupabase().listar();
}
export async function altaDeCuenta(clave: string, entrada: EntradaAlta) {
  await exigirSocio();
  const p = cuentasSupabase();
  const { tipos } = await p.listar();
  return darDeAlta(p, clave, entrada, tipos.filter((t) => t.creableWeb).map((t) => t.rol));
}
export async function estadoDeCuenta(clave: string, correo: string, activo: boolean, motivo: string | null) {
  await exigirSocio();
  return cambiarEstado(cuentasSupabase(), clave, correo, activo, motivo);
}
export async function correoDeCuenta(clave: string, actual: string, nuevo: string, motivo: string | null) {
  await exigirSocio();
  return cambiarCorreo(cuentasSupabase(), clave, actual, nuevo, motivo);
}
