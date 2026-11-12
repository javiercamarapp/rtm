// Raiz de composicion de la pagina Inventario actual de proveedores (sesion del socio; solo lectura). Las escrituras del modulo son de las tareas programadas.
import { prepararListaParaCliente, type PeticionLista } from '@/aplicacion/proveedores/lista';
import type { ResultadoLista } from '@/dominio/proveedores/lista_cliente';
import { ContextoNegocioDb, DatosListaDb, RepositorioProveedorDb } from '@/infra/proveedores/postgres';
import { llamadaProveedoresSocio, pantallaProveedores, type PantallaProveedores } from '@/infra/supabase/proveedores';
import { exigirSocio } from './acceso';

export async function proveedoresDeSocio(): Promise<PantallaProveedores> {
  await exigirSocio();
  return pantallaProveedores();
}

/** "Copiar lista para cliente": texto para pegar en WhatsApp. Lo prepara el sistema; jamas se envia desde aqui. Se bloquea con dato de mas de 3 horas. */
export async function listaParaClienteDeSocio(peticion: PeticionLista): Promise<ResultadoLista> {
  await exigirSocio();
  const db = await llamadaProveedoresSocio();
  return prepararListaParaCliente({ repo: new RepositorioProveedorDb(db), contexto: new ContextoNegocioDb(db), datos: new DatosListaDb(db), reloj: () => new Date() }, peticion);
}
