// Tipos del modulo de contactos de menudeo. Ningun tipo del informe lleva datos personales.

export type TipoFuente = 'google' | 'vcf' | 'plano' | 'meta' | 'toocloudy' | 'vapeunion';

export interface FuenteTabla {
  /** Identificador estable del archivo (nombre de archivo sin ruta). */
  archivo: string;
  tipo: TipoFuente;
}

/** Origen de un contacto: 'meta' (con anuncio y formulario), 'toocloudy', 'vapeunion' o 'google-lote:<etiqueta>'. */
export interface OrigenContacto {
  origen: string;
  anuncio: string | null;
  formulario: string | null;
  campana: string | null;
}

export interface RegistroLeido {
  archivo: string;
  nombre: string;
  /** E.164, ordenados. */
  telefonos: string[];
  correos: string[];
  etiquetas: string[];
  origenes: OrigenContacto[];
}

export interface Descartes {
  fila_vacia: number;
  sin_telefono: number;
  telefono_vacio: number;
  corto: number;
  largo: number;
  patron_falso: number;
  correo_invalido: number;
}

export interface ResultadoLectura {
  archivo: string;
  tipo: TipoFuente;
  filas: number;
  registros: RegistroLeido[];
  descartes: Descartes;
  columnas_telefono: number;
  extranjeros: number;
  /** Telefonos sin lada conservados (7 u 8 digitos, `sl:<digitos>`). */
  sin_lada: number;
  etiquetas_vistas: string[];
}

export interface ContactoConsolidado {
  /** Telefono principal (el menor en orden) y llave natural del contacto. */
  telefono: string;
  nombre: string;
  telefonos: string[];
  correos: string[];
  etiquetas: string[];
  lotes: string[];
  origenes: OrigenContacto[];
  tipo: 'menudeo';
  /** Comparte un correo con otro contacto de nombre distinto: no se unieron; queda para revision. */
  correo_compartido: boolean;
}

export interface InformeContactos {
  por_archivo: Array<{ archivo: string; tipo: TipoFuente; filas: number; con_telefono_valido: number; descartes: Descartes; extranjeros: number; sin_lada: number }>;
  totales: {
    filas: number;
    registros_validos: number;
    contactos_unicos: number;
    duplicados_eliminados: number;
    telefonos_unicos: number;
    con_correo: number;
    sin_correo: number;
    invalidos: number;
    telefonos_sin_lada: number;
    unidos_por_correo_y_nombre: number;
    correo_compartido_nombre_distinto: number;
  };
  por_origen: Array<{ origen: string; contactos: number }>;
  por_anuncio: Array<{ anuncio: string; formulario: string | null; contactos: number }>;
  etiquetas: Array<{ etiqueta: string; contactos: number }>;
}
