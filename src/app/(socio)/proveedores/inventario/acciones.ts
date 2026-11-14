'use server';

import { actualizarAhoraDeSocio, listaParaClienteDeSocio, type ResultadoActualizar } from '@/composicion/proveedores';
import type { ResultadoLista } from '@/dominio/proveedores/lista_cliente';

export interface OpcionesListaWeb {
  marca: string | null;
  soloSocios: boolean;
  mostrarCaladas: boolean;
  clienteId: number | null;
  combinarExistencia: boolean;
}

/** Cada accion exige sesion de socio antes de tocar la base. Las opciones se validan: nada llega a la base sin forma. */
export async function prepararLista(o: OpcionesListaWeb): Promise<ResultadoLista> {
  if (o.clienteId !== null && !Number.isSafeInteger(o.clienteId)) throw new Error('cliente invalido');
  return listaParaClienteDeSocio({
    ...(o.clienteId !== null ? { clienteId: String(o.clienteId) } : {}),
    combinarExistenciaPropia: o.combinarExistencia,
    opciones: { ...(o.marca ? { marcas: [o.marca] } : {}), soloSocios: o.soloSocios, mostrarCaladas: o.mostrarCaladas, conPrecios: o.clienteId !== null },
  });
}

/** Boton "Actualizar ahora". La accion exige sesion de socio y repite las comprobaciones del tope y del interruptor. */
export async function actualizarAhora(): Promise<ResultadoActualizar> {
  try {
    return await actualizarAhoraDeSocio();
  } catch {
    return { estado: 'error' };
  }
}
