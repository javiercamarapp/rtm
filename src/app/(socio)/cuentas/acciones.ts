'use server';

import type { ResultadoCuentas } from '@/aplicacion/cuentas/cuentas';
import { altaDeCuenta, correoDeCuenta, estadoDeCuenta } from '@/composicion/cuentas';
import type { CampoAlta } from '@/dominio/cuentas/cuentas';

/** Acciones de la pantalla Cuentas. Las claves de idempotencia (`web:<uuid>`) las manda el formulario. La guarda de socio y los permisos van dentro de la composicion y de la base. */
export async function altaCuentaAccion(clave: string, entrada: { correo: string; tipo: string; nombre: string }): Promise<ResultadoCuentas<CampoAlta>> {
  if (typeof entrada?.correo !== 'string' || typeof entrada?.tipo !== 'string' || typeof entrada?.nombre !== 'string') return { ok: false, mensaje: 'Datos inválidos.', errores: {} };
  return altaDeCuenta(clave, { correo: entrada.correo.slice(0, 300), tipo: entrada.tipo.slice(0, 40), nombre: entrada.nombre.slice(0, 120) });
}

export async function estadoCuentaAccion(clave: string, correo: string, activo: boolean, motivo: string | null): Promise<ResultadoCuentas> {
  if (typeof correo !== 'string' || typeof activo !== 'boolean') return { ok: false, mensaje: 'Datos inválidos.', errores: {} };
  return estadoDeCuenta(clave, correo.slice(0, 300), activo, typeof motivo === 'string' ? motivo : null);
}

export async function cambiarCorreoAccion(clave: string, actual: string, nuevo: string, motivo: string | null): Promise<ResultadoCuentas> {
  if (typeof actual !== 'string' || typeof nuevo !== 'string') return { ok: false, mensaje: 'Datos inválidos.', errores: {} };
  return correoDeCuenta(clave, actual.slice(0, 300), nuevo.slice(0, 300), typeof motivo === 'string' ? motivo : null);
}
