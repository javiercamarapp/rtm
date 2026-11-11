import type { ClienteFicha, ClienteResumen, Disponibilidad, Existencia, Explicacion, ModeloCatalogo, PrecioDeModelo } from '@/dominio/catalogo/tipos';

/** Lo que la web lee del catalogo, los clientes y el inventario. Cada lectura es una funcion de la base; la interfaz no calcula dinero. */
export interface LectorCatalogo {
  modelos(): Promise<ModeloCatalogo[]>;
  preciosDeModelo(modeloId: number): Promise<PrecioDeModelo[]>;
  clientes(): Promise<ClienteResumen[]>;
  ficha(clienteId: number): Promise<ClienteFicha | null>;
  existencia(): Promise<Existencia>;
  explicar(cifra: string): Promise<Explicacion>;
}

export interface EscritorCatalogo {
  fijarDisponibilidad(claveIdem: string, modeloId: number, estado: Disponibilidad): Promise<void>;
}
