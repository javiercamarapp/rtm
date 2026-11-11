'use server';

import { operacionDeSocio } from '@/composicion/operacion';
import type { AmbitoHoja } from '@/dominio/operacion/tipos';

/** Lecturas que la interfaz pide bajo demanda (texto para copiar). Siempre con sesion de socio; la base calcula todo. */
export async function textoCobroAccion(clienteId: number): Promise<string | null> {
  if (!Number.isInteger(clienteId) || clienteId <= 0) throw new Error('cliente invalido');
  return (await (await operacionDeSocio()).textoCobro(clienteId)).texto;
}

export async function notaProveedorAccion(proveedor: string, semana: string | null, ambito: AmbitoHoja): Promise<string> {
  if (proveedor !== 'Isaac' && proveedor !== 'Karen') throw new Error('proveedor invalido');
  if (ambito !== 'sociedad' && ambito !== 'todo') throw new Error('ambito invalido');
  if (semana !== null && !/^\d{4}-\d{2}-\d{2}$/.test(semana)) throw new Error('semana invalida');
  return (await (await operacionDeSocio()).notaProveedor(proveedor, semana, ambito)).texto;
}
