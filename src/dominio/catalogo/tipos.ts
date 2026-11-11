// Tipos de lectura del catalogo, los clientes y el inventario (lo que la web recibe de las funciones api.*). Dinero en centavos bigint.
export type Disponibilidad = 'disponible' | 'sin_disponibilidad';

export interface CostoVigente {
  proveedor: 'Isaac' | 'Karen';
  costoCent: bigint;
  desde: string;
  supuesto: boolean;
  esLista: boolean;
  motivo: string | null;
  fuente: string;
}
export interface ModeloCatalogo {
  id: number;
  marca: string;
  nombre: string;
  puffs: number | null;
  estado: Disponibilidad;
  estadoDesde: string;
  lista: 'angelo' | 'javier' | 'ambas';
  costos: CostoVigente[];
  alias: string[];
  precios: { clientes: number; minCent: bigint | null; maxCent: bigint | null };
}
export interface MargenProveedor { proveedor: string; costoCent: bigint; margenCent: bigint; supuesto: boolean }
export interface PrecioDeModelo {
  clienteId: number;
  cliente: string;
  duenio: string;
  precioCent: bigint;
  desde: string;
  origen: string;
  nota: string | null;
  margenes: MargenProveedor[];
}
export interface AliasCliente { alias: string; porConfirmar: boolean }
export interface ClienteResumen {
  id: number;
  nombre: string;
  duenio: 'Angelo' | 'Javier';
  tipo: string;
  activo: boolean;
  precios: number;
  alias: AliasCliente[];
  esBodega: boolean;
}
export interface LineaTabulador {
  modeloId: number;
  modelo: string;
  estado: Disponibilidad;
  precioCent: bigint;
  desde: string;
  origen: string;
  nota: string | null;
  margenes: MargenProveedor[];
}
export interface EntradaHistorial {
  modelo: string;
  precioCent: bigint;
  desde: string;
  hasta: string | null;
  origen: string;
  vigente: boolean;
  externo: boolean;
  nota: string | null;
}
export interface ClienteFicha {
  id: number;
  nombre: string;
  duenio: string;
  tipo: string;
  activo: boolean;
  esBodega: boolean;
  nota: string | null;
  alias: { alias: string; porConfirmar: boolean; ambiguo: boolean }[];
  destinos: { etiqueta: string; zona: string }[];
  tabulador: LineaTabulador[];
  historial: EntradaHistorial[];
}
export interface ExistenciaModelo {
  modeloId: number;
  marca: string;
  modelo: string;
  estado: Disponibilidad;
  /** null = no hay movimientos: se muestra "Sin dato", nunca un cero inventado. */
  piezas: number | null;
  valorCent: bigint | null;
  costoPromCent: bigint | null;
  ultimoMovimiento: string | null;
}
export interface ExistenciaSabor { skuId: number; modeloId: number; sabor: string; ubicacion: string; ubicacionCodigo: string; piezas: number }
export interface Existencia { modelos: ExistenciaModelo[]; sabores: ExistenciaSabor[] }

export interface Explicacion {
  cifra: string;
  titulo: string;
  unidad: 'pz' | 'mxn';
  valor: number | null;
  comprobacion: { via1: string; via1Valor: number; via2: string; via2Valor: number; cuadra: boolean } | null;
  movimientos: {
    hora: string; fechaNeg: string; tipo: string; sabor: string; ubicacion: string; cantidad: number; saldo: number;
    valorCent: bigint; evento: string; canal: string; mensajeOrigen: string | null; autor: string | null;
  }[];
  precioCent: bigint | null;
  costos: { proveedor: string; costoCent: bigint; desde: string; supuesto: boolean; fuente: string; margenCent: bigint; cuadra: boolean }[];
  /** Cifras de dinero (F2): los renglones que forman la cifra, con saldo corrido cuando es un libro. */
  renglones: { concepto: string; montoCent: bigint; saldoCent: bigint | null; hora: string | null; fechaNeg: string | null; evento: string | null; canal: string | null; autor: string | null; mensajeOrigen: string | null }[];
}
