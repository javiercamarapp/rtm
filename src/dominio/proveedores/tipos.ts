// Inventario actual de proveedores (seccion "Inventario de Karen"): tipos del dominio.
// Regla de oro de este modulo: SOLO se guarda estado vigente, eventos de cambio y, de las promociones, bandera, tipo,
// porcentaje entero, modelos y fechas. Jamas un importe, un precio de comparacion ni texto de mercadotecnia.
// Los identificadores del proveedor se tratan como texto (pueden exceder 2^53).

/** Instante en formato ISO 8601 (UTC). El reloj siempre entra como parametro. */
export type Instante = string;

// ---------------------------------------------------------------- lectura (ya filtrada: sin precios)

export interface VarianteLeida {
  id: string;
  productoId: string;
  sabor: string;
  disponible: boolean;
}

export interface ProductoLeido {
  id: string;
  handle: string;
  titulo: string;
  variantes: VarianteLeida[];
}

export interface LecturaCatalogo {
  productos: ProductoLeido[];
}

// ---------------------------------------------------------------- estado vigente

export type EstadoMapeo = 'pendiente' | 'auto' | 'confirmado';

export interface ModeloProveedor {
  id: string;
  handle: string;
  titulo: string;
  tituloNorm: string;
  /** Titulos anteriores, para no perder el vinculo tras un renombrado. */
  aliasTitulos: string[];
  marca: string;
  puffs: number | null;
  estado: 'activo' | 'no_visto' | 'descontinuado';
  primeraVez: Instante;
  ultimaVez: Instante;
  ausencias: number;
  primeraAusencia: Instante | null;
  /** Verdadero cuando ningun sabor esta disponible. */
  sinSabores: boolean;
  /** Se agrego solo al inventario del proveedor: falta el costo que da Javier y la confirmacion de un socio. */
  nuevoSinCosto: boolean;
  mapeo: EstadoMapeo;
  canonicoId: string | null;
  /** Alias que apunta a un grupo (por ejemplo "Waka 50"): se muestran todos, no se elige uno. */
  gruposCandidatos: string[];
}

export interface VarianteProveedor {
  id: string;
  productoId: string;
  saborOriginal: string;
  saborNorm: string;
  disponible: boolean;
  estado: 'activa' | 'no_vista' | 'descontinuada';
  ausencias: number;
  primeraAusencia: Instante | null;
  mapeo: EstadoMapeo;
  saborCanonicoId: string | null;
  /** Instantes de los cambios confirmados de las ultimas 24 horas (para detectar parpadeo sostenido). */
  cambios: Instante[];
  inestableHasta: Instante | null;
  primeraVez: Instante;
  ultimaVez: Instante;
}

export type TipoCandidato = 'modelo_nuevo' | 'sabor_nuevo' | 'agotado' | 'regreso' | 'renombrado_modelo' | 'renombrado_sabor';

/** Un cambio visto una vez. Solo se notifica cuando una lectura valida posterior lo confirma. */
export interface Candidato {
  clave: string;
  tipo: TipoCandidato;
  entidadId: string;
  productoId: string;
  valor: string;
  primeraVista: Instante;
  lecturasVistas: number;
  ultimaLectura: string;
}

export interface ElementoCola {
  tipo: 'modelo' | 'sabor';
  textoOriginal: string;
  textoNorm: string;
  sugerenciaId: string | null;
  similitud: number | null;
  creada: Instante;
}

export interface LecturaRetenida {
  desde: Instante;
  veces: number;
  razon: string;
  avisado: boolean;
  clave: string;
  lectura: LecturaCatalogo;
}

export interface PuntoVariedad {
  dia: string;
  n: number;
}

export interface EstadoVariedad {
  lecturasBajas: number;
  lecturasAltas: number;
  activa: boolean;
  rearmaEn: Instante | null;
}

export type TipoIncidente = 'sin_lectura' | 'bloqueada' | 'formato' | 'vacia';

export interface Incidente {
  tipo: TipoIncidente;
  desde: Instante;
  avisadoEn: Instante;
  recordatorioEn: Instante | null;
}

export interface SaludFuente {
  ultimaLecturaOk: Instante | null;
  ultimoIntento: Instante | null;
  fallosSeguidos: number;
  bloqueada: boolean;
  incidente: Incidente | null;
}

export type TipoPromocion = 'porcentaje' | 'multicompra' | 'campana';
export type EstadoPromocion = 'candidata' | 'activa' | 'anunciada' | 'terminada';

/** Promocion: bandera, tipo, porcentaje entero, modelos y fechas. Nunca importes ni texto de mercadotecnia. */
export interface Promocion {
  clave: string;
  tipo: TipoPromocion;
  pct: number | null;
  /** Etiqueta corta redactada por el sistema ("15 % en 3 modelos", "Campana 3x2"). */
  etiqueta: string;
  /** Identificadores de producto del proveedor. */
  alcance: string[];
  inicio: Instante | null;
  fin: Instante | null;
  primeraVista: Instante;
  ultimaVista: Instante;
  lecturasAusente: number;
  estado: EstadoPromocion;
  avisoPorTerminar: boolean;
  /** Identificador corto de la coleccion de campana (no es una direccion). */
  coleccion: string | null;
}

export interface EstadoProveedor {
  version: 1;
  inicializado: boolean;
  modelos: Record<string, ModeloProveedor>;
  variantes: Record<string, VarianteProveedor>;
  candidatos: Record<string, Candidato>;
  retenida: LecturaRetenida | null;
  promociones: Record<string, Promocion>;
  /** Tarjetas vistas en la ultima lectura de promociones valida (para descartar plantillas rotas). */
  tarjetasPromo: number;
  cola: ElementoCola[];
  historialVariedad: Record<string, PuntoVariedad[]>;
  variedad: Record<string, EstadoVariedad>;
  salud: SaludFuente;
  /** Claves `fuente|fecha|hora` ya procesadas con exito (idempotencia). */
  lecturasProcesadas: string[];
}

export function estadoVacio(): EstadoProveedor {
  return {
    version: 1,
    inicializado: false,
    modelos: {},
    variantes: {},
    candidatos: {},
    retenida: null,
    promociones: {},
    tarjetasPromo: 0,
    cola: [],
    historialVariedad: {},
    variedad: {},
    salud: { ultimaLecturaOk: null, ultimoIntento: null, fallosSeguidos: 0, bloqueada: false, incidente: null },
    lecturasProcesadas: [],
  };
}

// ---------------------------------------------------------------- eventos y avisos

export type TipoEvento =
  | 'modelo_nuevo'
  | 'sabor_nuevo'
  | 'sabor_agotado'
  | 'sabor_regreso'
  | 'modelo_agotado'
  | 'renombrado'
  | 'modelo_descontinuado'
  | 'sabor_descontinuado'
  | 'modelo_regreso_catalogo'
  | 'inestable'
  | 'poca_variedad'
  | 'variedad_recuperada'
  | 'promocion_nueva'
  | 'promocion_anunciada'
  | 'promocion_por_terminar'
  | 'promocion_terminada'
  | 'lectura_retenida';

export type DatoEvento = string | number | boolean | null | string[];

export interface EventoCambio {
  /** Unica por tipo, entidad y lectura: reprocesar una lectura no duplica eventos. */
  clave: string;
  tipo: TipoEvento;
  productoId: string | null;
  varianteId: string | null;
  lectura: string;
  en: Instante;
  antes: string | null;
  despues: string | null;
  datos: Record<string, DatoEvento>;
}

export type CodigoAviso =
  | 'P-01'
  | 'P-02'
  | 'P-03'
  | 'P-04'
  | 'P-05'
  | 'P-07'
  | 'P-08'
  | 'P-09'
  | 'P-10'
  | 'P-11'
  | 'P-12'
  | 'P-17'
  | 'P-18'
  | 'P-19'
  | 'P-20'
  | 'V-1';

export type Severidad = 'alta' | 'media' | 'baja';

export interface SolicitudAviso {
  codigo: CodigoAviso;
  severidad: Severidad;
  /** `inmediato` va a la campana y a Telegram; `resumen` solo a la campana y al resumen de las 20:00. */
  destino: 'inmediato' | 'resumen';
  claveDedupe: string;
  entidadTipo: 'modelo' | 'promocion' | 'fuente' | 'cola';
  entidadId: string;
  /** Referencias y nombres de modelo y sabor. Nunca importes ni la direccion de la fuente. */
  payload: Record<string, DatoEvento>;
  creada: Instante;
}

// ---------------------------------------------------------------- utilidades de tiempo

export const MS_HORA = 3_600_000;

export function sumarMs(iso: Instante, ms: number): Instante {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`instante invalido: ${iso}`);
  return new Date(t + ms).toISOString();
}

export function horasEntre(desde: Instante, hasta: Instante): number {
  return (Date.parse(hasta) - Date.parse(desde)) / MS_HORA;
}

export function minutosEntre(desde: Instante, hasta: Instante): number {
  return (Date.parse(hasta) - Date.parse(desde)) / 60_000;
}
