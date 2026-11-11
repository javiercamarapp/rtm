// Tipos del importador. Todo dinero en centavos bigint.
export interface LineaPrecio {
  modelo: string;
  precio: bigint;
  costoDoc: bigint;
  margenDoc: bigint;
}
export interface ClienteAngelo {
  nombre: string;
  lineas: LineaPrecio[];
}
export interface ListaAngelo {
  costos: { modelo: string; costo: bigint }[];
  clientes: ClienteAngelo[];
  aliasCliente: { alias: string; destino: string }[];
  destinosCliente: { cliente: string; etiquetas: string[] }[];
  ocasionales: string[];
  fueraDeCatalogo: string[];
}

export interface PrecioJavier {
  modelo: string;
  precio: bigint;
}
export interface ClienteJavier {
  nombre: string;
  precios: PrecioJavier[];
  fuentes: string[];
  copiaDe: string | null;
  /** Alias dados junto al nombre, p. ej. "(alias Empire Vapes, \"el campechano\")". */
  alias: string[];
  /** Lista que el dueno marco como NO valida: no se importa como vigente; solo queda la nota. */
  descartada: string | null;
}
export interface ListaJavier {
  orden: string[];
  clientes: ClienteJavier[];
  nexa: { cliente: string; precio: bigint }[];
  archivoSinAsignar: string | null;
  /** Nombre del tabulador de un archivo, en el orden de `orden` (para el archivo sin asignar). */
  archivos: Record<string, PrecioJavier[]>;
  advertencias: string[];
}
export interface CostoKaren {
  modelo: string;
  costo: bigint;
}

export interface Decisiones {
  /** Nombre en la lista -> nombre completo decidido por el dueno (por ejemplo el cliente repetido). */
  nombre_completo: Record<string, string>;
  /** Cliente -> cliente de referencia cuyo tabulador se COPIA (con origen marcado); despues diverge por separado. */
  mismo_tabulador: Record<string, string>;
  /** Alias de cliente ya confirmados por el dueno: { alias, cliente }. */
  alias_confirmados: { alias: string; cliente: string }[];
  /** Equivalencias que el dueno decidio una por una (la regla general es NO inventar ninguna entre listas). */
  equivalencias: { nombre: string; modelo: string }[];
  /** Cliente que presta la bodega (una entidad, dos papeles). */
  persona_bodega: string | null;
}

export interface PlanModelo { marca: string; nombre: string; puffs: number | null; lista: 'angelo' | 'javier'; estado: 'disponible' | 'sin_disponibilidad' }
export interface PlanAlias { alias: string; destinos: string[]; porConfirmar: boolean; nota: string }
export interface PlanCliente { nombre: string; duenio: 'Angelo' | 'Javier'; tipo: 'mayoreo' | 'credito_interno' | 'ocasional'; nota: string | null }
export interface PlanCosto { proveedor: 'Isaac' | 'Karen'; modelo: string; centavos: bigint; desde: string; fuente: string; supuesto: boolean }
export interface PlanPrecio { cliente: string; modelo: string; centavos: bigint; desde: string; origen: 'documento' | 'lista_javier'; nota: string | null }
export interface PlanHistorico { cliente: string; modelo: string; centavos: bigint; origen: string; nota: string }

export interface Plan {
  modelos: PlanModelo[];
  aliasModelo: PlanAlias[];
  clientes: PlanCliente[];
  personaBodega: { cliente: string; nombre: string } | null;
  aliasCliente: PlanAlias[];
  destinos: { cliente: string; etiqueta: string; zona: 'merida' | 'fuera' }[];
  costos: PlanCosto[];
  precios: PlanPrecio[];
  historicos: PlanHistorico[];
  /** Listas de precios sin dueno: se guardan como referencia, no vigentes. */
  listasSinDuenio: { referencia: string; origen: string; filas: { modelo: string; centavos: bigint }[] }[];
  sinDisponibilidad: string[];
  conflictos: string[];
  advertencias: string[];
}
