// Formas que devuelven las funciones api.apertura_*. Los montos `*_cent` llegan como bigint (centavosABigint); la interfaz solo los formatea.
export type Cent = bigint;

export interface CategoriaApertura {
  codigo: string;
  paso: number;
  nombre: string;
  sentido: 'D' | 'H';
  req_socio: boolean;
  req_cliente: boolean;
  req_proveedor: boolean;
  req_fecha: boolean;
  ayuda: string;
}

export interface PartidaApertura {
  id: number;
  categoria: string;
  paso: number;
  nombre: string;
  cuenta: string;
  sentido: 'D' | 'H';
  monto_cent: Cent;
  socio: string | null;
  cliente_id: number | null;
  cliente: string | null;
  proveedor: string | null;
  modelo: string | null;
  sabor: string | null;
  sku_id: number | null;
  piezas: number | null;
  costo_unit_cent: Cent | null;
  fecha_ref: string | null;
  descripcion: string | null;
}

export type EstadoSesion = 'borrador' | 'en_firma' | 'firmada' | 'reversada';
export type ResolucionPuente = 'mantener' | 'capital_50_50';

export interface SesionApertura {
  id: number;
  fecha_corte: string;
  estado: EstadoSesion;
  resolucion: ResolucionPuente;
  justificacion: string | null;
  nota: string | null;
  firmada_at: string | null;
  hash_firmado: string | null;
}

export interface PasoValidacion {
  paso: number;
  nombre: string;
  partidas: number;
  monto_cent: Cent;
  estado: 'con_datos' | 'vacio';
}

export interface ValidacionApertura {
  sesion_id: number;
  fecha_corte: string;
  partidas: number;
  activo_cent: Cent;
  pasivo_cent: Cent;
  capital_cent: Cent;
  puente_cent: Cent;
  identidad_cent: Cent;
  umbral_justificacion_cent: Cent;
  exige_justificacion: boolean;
  resolucion: ResolucionPuente;
  justificacion: string | null;
  pasos: PasoValidacion[];
  alertas: string[];
  listo_para_firma: boolean;
  huella: string;
}

export interface FirmaApertura {
  socio: string;
  firmada_at: string;
  hash: string;
}

export interface HistorialApertura {
  id: number;
  fecha_corte: string;
  estado: EstadoSesion;
  firmada_at: string | null;
  reversada_at: string | null;
  motivo_reversa: string | null;
}

export interface EstadoApertura {
  categorias: CategoriaApertura[];
  historial: HistorialApertura[];
  sesion: SesionApertura | null;
  partidas: PartidaApertura[];
  firmas: FirmaApertura[];
  yo: string | null;
  validacion: ValidacionApertura | null;
}

export interface ModeloApertura {
  modelo_id: number;
  modelo: string;
  marca: string;
  sabores: { sku_id: number; sabor: string }[];
}

export interface CatalogosApertura {
  modelos: ModeloApertura[];
  clientes: { id: number; nombre: string }[];
  proveedores: { id: number; nombre: string }[];
}

export interface LineaAsiento {
  cuenta: string;
  debe_cent?: Cent;
  haber_cent?: Cent;
  nota?: string;
}

export interface EfectoCuenta {
  cuenta: string;
  nombre: string;
  naturaleza: 'D' | 'A';
  antes_cent: Cent;
  apertura_cent: Cent;
  despues_cent: Cent;
}

export interface VistaPreviaApertura {
  sesion_id: number;
  lineas: LineaAsiento[];
  debe_cent: Cent;
  haber_cent: Cent;
  cuadra: boolean;
  efecto: EfectoCuenta[];
  escribe: false;
}

export interface EnsayoApertura {
  escribe: false;
  puente_3990_cent: Cent;
  comprobaciones_en_rojo: { codigo: string; nombre: string; bloqueante: boolean; via_a_cent: Cent; via_b_cent: Cent }[];
  bloqueantes_en_rojo: number;
  auxiliares_en_rojo: { clave: string; libro_cent: Cent; auxiliar_cent: Cent }[];
  asientos: number;
  cadena_ok: boolean;
  inventario_1310_cent: Cent;
  inventario_kardex_cent: Cent;
}
