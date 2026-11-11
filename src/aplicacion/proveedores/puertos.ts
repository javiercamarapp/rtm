// Puertos del inventario actual de proveedores. La lectura es inyectable: las pruebas usan un simulador y nunca tocan la red.
// Las implementaciones concretas viven en infra (memoria, lector HTTP) y, cuando exista el esquema, en Postgres (ver docs/lanes).

import type { RespuestaCruda } from '@/dominio/proveedores/catalogo_json';
import type { PresupuestoDia } from '@/dominio/proveedores/fuente';
import type { ExistenciaPropiaParaLista } from '@/dominio/proveedores/lista_cliente';
import type { ContextoSocios } from '@/dominio/proveedores/detector';
import type { ContextoNormalizacion } from '@/dominio/proveedores/normalizador';
import type { EstadoProveedor, EventoCambio, SolicitudAviso } from '@/dominio/proveedores/tipos';

/** Lectura de la fuente. La direccion vive solo dentro de la implementacion (variable de entorno privada). */
export interface PuertoLecturaProveedor {
  /** Pagina 1 del catalogo de datos (hasta 250 productos). */
  leerCatalogo(pagina: number): Promise<RespuestaCruda>;
  /** HTML de inicio, donde se publican las promociones. */
  leerInicio(): Promise<RespuestaCruda>;
  /** JSON de una coleccion de campana. */
  leerColeccion(handle: string): Promise<RespuestaCruda>;
  leerRobots(): Promise<RespuestaCruda>;
}

export interface FilaFoto {
  varianteId: string;
  disponible: boolean;
}

export interface RepositorioInventarioProveedor {
  cargarEstado(): Promise<EstadoProveedor>;
  /** Guarda el estado vigente y agrega los eventos; un evento con la misma `clave` no se duplica. Nunca recibe importes. */
  guardarEstado(estado: EstadoProveedor, eventos: EventoCambio[]): Promise<void>;
  cargarPresupuesto(dia: string): Promise<PresupuestoDia | null>;
  guardarPresupuesto(p: PresupuestoDia): Promise<void>;
  /** Foto diaria de variantes (idempotente por dia). */
  guardarFotoDiaria(dia: string, filas: FilaFoto[]): Promise<void>;
}

/** Catalogo propio, alias confirmados y que modelos o sabores venden los socios. Lo provee el modulo de catalogo e inventario. */
export interface PuertoContextoNegocio {
  normalizacion(): Promise<ContextoNormalizacion>;
  socios(): Promise<ContextoSocios>;
}

/** Salida de avisos. La implementacion real es `notificacion.emitir` (otro modulo); debe ser idempotente por `claveDedupe`. */
export interface PuertoAvisos {
  emitir(aviso: SolicitudAviso): Promise<void>;
  /** El aviso con esa clave deja de ser cierto ("resuelto solo"). */
  resolver(claveDedupe: string): Promise<void>;
}

/** Lo que la lista para clientes necesita de otros modulos. */
export interface PuertoDatosLista {
  /** Precio del tabulador del cliente para un modelo del catalogo propio, en centavos. Nunca el costo. */
  precioDeTabulador(clienteId: string, modeloCanonicoId: string): Promise<bigint | null>;
  existenciaPropia(): Promise<ExistenciaPropiaParaLista[]>;
}

export type Reloj = () => Date;
