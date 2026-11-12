'use server';

import { altaCliente, costoDeSolicitud, edicionCliente, precioDeSolicitud, type ResultadoAlta, type SolicitudCosto, type SolicitudPrecio } from '@/aplicacion/catalogo/alta';
import { altaDeSocio, lectorDeSocio } from '@/composicion/catalogo';
import type { CampoCliente, CampoCosto, CampoPrecio, EntradaCliente } from '@/dominio/catalogo/alta';

/** Acciones de alta y edicion. La clave de idempotencia (`web:<uuid>`) la manda el formulario y se renueva solo tras un exito. */
export async function crearClienteAccion(clave: string, entrada: EntradaCliente): Promise<ResultadoAlta<CampoCliente>> {
  return altaCliente(await altaDeSocio(), clave, entrada);
}

/** Se usa con `.bind(null, clienteId)` desde la pagina de edicion. */
export async function editarClienteAccion(clienteId: number, clave: string, entrada: EntradaCliente & { activo: boolean }): Promise<ResultadoAlta<CampoCliente>> {
  return edicionCliente(await altaDeSocio(), clave, clienteId, entrada);
}

export async function fijarPrecioAccion(clave: string, solicitud: SolicitudPrecio): Promise<ResultadoAlta<CampoPrecio>> {
  return precioDeSolicitud(await lectorDeSocio(), await altaDeSocio(), clave, solicitud);
}

export async function fijarCostoAccion(clave: string, solicitud: SolicitudCosto): Promise<ResultadoAlta<CampoCosto>> {
  return costoDeSolicitud(await lectorDeSocio(), await altaDeSocio(), clave, solicitud);
}
