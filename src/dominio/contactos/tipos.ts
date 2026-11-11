// Tipos del modulo de contactos de menudeo. Ningun tipo del informe lleva datos personales.

export type TipoFuente = 'google' | 'meta' | 'toocloudy' | 'vapeunion';

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
  sin_lada: number;
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
}

export interface InformeContactos {
  por_archivo: Array<{ archivo: string; tipo: TipoFuente; filas: number; con_telefono_valido: number; descartes: Descartes; extranjeros: number }>;
  totales: {
    filas: number;
    registros_validos: number;
    contactos_unicos: number;
    duplicados_eliminados: number;
    telefonos_unicos: number;
    con_correo: number;
    sin_correo: number;
    invalidos: number;
  };
  por_origen: Array<{ origen: string; contactos: number }>;
  por_anuncio: Array<{ anuncio: string; formulario: string | null; contactos: number }>;
  etiquetas: Array<{ etiqueta: string; contactos: number }>;
}
