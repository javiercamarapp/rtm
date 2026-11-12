import type { SentidoDelta } from './geo';

/** Observado = leido de un hecho registrado. Estimado = proyeccion con modelo. Inferido = deducido de un patron. */
export type Procedencia = 'observado' | 'estimado' | 'inferido';

export type EstadoGrafica = 'listo' | 'cargando' | 'error';

export interface ColumnaTabla { id: string; titulo: string; numerica?: boolean }
export interface FilaTabla { clave: string; celdas: readonly string[] }
/** La tabla alterna de una grafica: los MISMOS datos, en texto. */
export interface TablaAlterna { columnas: readonly ColumnaTabla[]; filas: readonly FilaTabla[] }

export interface MuestraMinima { actual: number; requerida: number; unidad: string }

export interface BaseGrafica {
  /** Titulo como pregunta o conclusion. */
  titulo: string;
  /** Resumen para lectores de pantalla (aria-label). */
  descripcion: string;
  estado?: EstadoGrafica;
  procedencia?: Procedencia;
  /** "Corte: 10 nov 19:12 · Fuente: libro de movimientos". */
  pie?: string;
  /** Sin muestra suficiente la grafica no se dibuja ni se anima: estado vacio honesto. */
  muestra?: MuestraMinima;
}

/** Cambio entre dos periodos. El texto ya viene formateado; el sentido se dice con flecha, signo y palabra (sin semaforo). */
export interface DeltaTexto { texto: string; sentido: SentidoDelta; /** Si el cambio es bueno o malo para el negocio; sin dato, el delta no usa semaforo. */ bueno?: boolean }

export type FormaMarcador = 'circulo' | 'cuadrado' | 'triangulo' | 'rombo';
export type NombrePatron = 'liso' | 'rayas' | 'puntos' | 'cuadros' | 'cruz';

export const PATRONES_SERIE: readonly NombrePatron[] = ['liso', 'rayas', 'puntos', 'cuadros', 'cruz'];
export const FORMAS_SERIE: readonly FormaMarcador[] = ['circulo', 'cuadrado', 'triangulo', 'rombo'];

/** Tramos de antiguedad de saldos por omision (adenda 22, que corrige la spec: 0 a 7, 8 a 14, 15 a 30 y mas de 30 dias). */
export const TRAMOS_ANTIGUEDAD = ['0 a 7 d', '8 a 14 d', '15 a 30 d', 'Más de 30 d'] as const;
