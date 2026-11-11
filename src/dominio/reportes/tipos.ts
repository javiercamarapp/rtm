// Tipos del motor de reportes (spec 16). El paquete de cifras es inmutable: graficas, tablas, titulares e
// insights leen de el; nada se calcula al dibujar.

export type Clase = 'Observado' | 'Calculado' | 'Estimado' | 'Escenario' | 'Declarado';
export type Unidad = 'cent' | 'pz' | 'bp' | 'milesimas' | 'dias' | 'n';
export type EstadoCifra = 'ok' | 'sin_datos' | 'insuficiente';
export type FormatoCifra = 'entero' | 'centavos' | 'pct0' | 'pct1' | 'razon' | 'dias' | 'pz' | 'n';

export interface Comprobacion2Vias {
  readonly via1: bigint;
  readonly via2: bigint;
  readonly igual: boolean;
}

export interface Cifra {
  readonly id: string;
  readonly etiqueta: string;
  /** Valor en la unidad: cent = centavos; bp = centesimas de punto porcentual; milesimas = razon x 1000. */
  readonly valor: bigint;
  readonly unidad: Unidad;
  readonly formato?: FormatoCifra;
  readonly periodo: string;
  readonly fuente: string;
  readonly clase: Clase;
  readonly nMuestra: number;
  readonly comprobacion: Comprobacion2Vias;
  readonly estado: EstadoCifra;
  /** Para estimaciones: rango empirico al 80 %. */
  readonly rango?: { readonly lo: bigint; readonly hi: bigint };
  readonly metodo?: string;
}

export type Severidad = 'nota' | 'atencion' | 'alerta';

export interface ResultadoComprobacion {
  /** C1..C22 (externas, de contabilidad) o R.* (internas del paquete). */
  readonly id: string;
  readonly nombre: string;
  readonly via1: bigint;
  readonly via2: bigint;
  readonly ok: boolean;
  readonly detalle?: string;
  /** Unidad de via1 y via2 (por omision cuenta de elementos). Con 'cent' el aviso muestra la diferencia en pesos. */
  readonly unidad?: 'cent' | 'pz' | 'n';
}

export type EtiquetaEstado = 'DEFINITIVO' | 'PRELIMINAR' | 'PARCIAL';

export interface DecisionEstado {
  readonly sale: boolean;
  readonly etiquetas: readonly EtiquetaEstado[];
  /** Comprobaciones bloqueantes que fallaron (si hay alguna, no sale). */
  readonly bloqueantes: readonly string[];
  /** Comprobaciones no bloqueantes que fallaron (PRELIMINAR). */
  readonly fallas: readonly string[];
  readonly motivo: string;
}

export type CeldaTabla = { readonly t: 'texto'; readonly v: string } | { readonly t: 'cent'; readonly v: bigint; readonly f?: FormatoCifra } | { readonly t: 'pz'; readonly v: number } | { readonly t: 'bp'; readonly v: bigint; readonly f?: FormatoCifra } | { readonly t: 'n'; readonly v: number } | { readonly t: 'dias'; readonly v: number };

export interface Tabla {
  readonly id: string;
  readonly titulo: string;
  readonly columnas: readonly string[];
  readonly filas: readonly (readonly CeldaTabla[])[];
  /** Renglones omitidos por el limite de 8 ("resto"). */
  readonly nota?: string;
}

export type Periodicidad = 'semanal' | 'mensual';

export interface PeriodoReporte {
  readonly tipo: Periodicidad;
  readonly inicio: string;
  readonly fin: string;
  readonly etiqueta: string;
  readonly folio: string;
}

/** Codigos de error tipados del motor de reportes. */
export type CodigoErrorReporte = 'CIFRA_INEXISTENTE' | 'CIFRA_SIN_DATOS' | 'GUARDIA_NUMEROS' | 'PUENTE_NO_CUADRA' | 'COMPROBACION_BLOQUEANTE' | 'DATOS_INVALIDOS' | 'RENDER_PDF' | 'PDF_INVALIDO';

export class ErrorReporte extends Error {
  readonly codigo: CodigoErrorReporte;
  readonly detalle: readonly string[];
  constructor(codigo: CodigoErrorReporte, mensaje: string, detalle: readonly string[] = []) {
    super(mensaje);
    this.name = 'ErrorReporte';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}
