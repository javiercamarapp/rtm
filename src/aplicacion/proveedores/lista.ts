// Caso de uso "Copiar lista para cliente": arma el texto de disponibilidad desde el estado vigente del inventario de proveedores.
// El agente prepara el texto; nunca lo envia a clientes. Solo se leen datos que pueden verse en una lista de cliente:
// modelo, sabor, disponibilidad y, si se pide, el precio del tabulador del cliente elegido. El costo no entra por ningun puerto.

import { generarListaDisponibilidad } from '@/dominio/proveedores/lista_cliente';
import type { ModeloParaLista, OpcionesLista, ResultadoLista } from '@/dominio/proveedores/lista_cliente';
import type { EstadoProveedor } from '@/dominio/proveedores/tipos';
import type { PuertoContextoNegocio, PuertoDatosLista, Reloj, RepositorioInventarioProveedor } from './puertos';

export interface DepsLista {
  repo: RepositorioInventarioProveedor;
  contexto: PuertoContextoNegocio;
  datos: PuertoDatosLista;
  reloj: Reloj;
  /** Origen privado configurado (solo para comprobar que el texto no lo contenga). */
  origenPrivado?: string;
}

export interface PeticionLista {
  /** Cliente cuyo tabulador se usa con `conPrecios`. */
  clienteId?: string;
  opciones?: Omit<OpcionesLista, 'existenciaPropia'>;
  combinarExistenciaPropia?: boolean;
}

export async function prepararListaParaCliente(deps: DepsLista, peticion: PeticionLista = {}): Promise<ResultadoLista> {
  const estado: EstadoProveedor = await deps.repo.cargarEstado();
  const socios = await deps.contexto.socios();
  const opciones = peticion.opciones ?? {};
  const modelos: ModeloParaLista[] = [];
  for (const m of Object.values(estado.modelos)) {
    if (m.estado !== 'activo') continue;
    const sabores = Object.values(estado.variantes)
      .filter((v) => v.productoId === m.id && v.estado === 'activa')
      .map((v) => ({ nombre: v.saborOriginal, disponible: v.disponible }));
    let precioCliente: bigint | null = null;
    if (opciones.conPrecios && peticion.clienteId && m.canonicoId) precioCliente = await deps.datos.precioDeTabulador(peticion.clienteId, m.canonicoId);
    modelos.push({
      id: m.id,
      marca: m.marca,
      nombre: m.titulo,
      sabores,
      deSocios: socios.modeloActivo(m),
      precioCliente,
    });
  }
  const existenciaPropia = peticion.combinarExistenciaPropia ? await deps.datos.existenciaPropia() : undefined;
  return generarListaDisponibilidad({
    ahora: deps.reloj().toISOString(),
    ultimaLectura: estado.salud.ultimaLecturaOk,
    modelos,
    opciones: { ...opciones, ...(existenciaPropia ? { existenciaPropia } : {}) },
    ...(deps.origenPrivado ? { origenPrivado: deps.origenPrivado } : {}),
  });
}
