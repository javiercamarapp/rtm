import type {
  ConciliaInventario, DetalleConteo, DocumentoGuardado, DocumentoReservado, ExplicacionConteo, HojaConteoSku, InventarioCompleto, Kardex, ParametrosInventario, PrevisualizacionConteo,
  ResultadoAltaSabor, ResumenConteo, ResumenDocumento, SnapshotInventario, VersionInventario,
} from '@/dominio/inventario/tipos';

/** Lo que la web lee del inventario. Cada lectura es una funcion de la base; la interfaz no calcula dinero ni cobertura. */
export interface LectorInventario {
  completo(): Promise<InventarioCompleto>;
  kardex(modeloId: number, skuId: number | null, ini: string | null, fin: string | null, limite: number): Promise<Kardex | null>;
  conteoHoja(ubicacion: string): Promise<HojaConteoSku[]>;
  concilia(): Promise<ConciliaInventario>;
  conteoPrevisualizar(ubicacion: string, lineas: { sku_id: number; contado: number }[]): Promise<PrevisualizacionConteo>;
  conteos(): Promise<ResumenConteo[]>;
  conteo(id: number): Promise<DetalleConteo | null>;
  documento(id: number): Promise<DocumentoGuardado | null>;
  documentos(): Promise<ResumenDocumento[]>;
}

export interface EscritorInventario {
  abrirConteo(claveIdem: string, ubicacion: string, tipo: 'semanal' | 'recepcion' | 'cuadre_inicial', contadoAt: string): Promise<{ conteo_id: number }>;
  cerrarConteo(claveIdem: string, conteoId: number, lineas: { sku_id: number; contado: number; explicacion_tipo?: ExplicacionConteo | null; explicacion_ref?: string | null }[]): Promise<{ conteo_id: number; ajustes: number }>;
  agregarSabor(claveIdem: string, modeloId: number, sabor: string, confirmar: boolean): Promise<ResultadoAltaSabor>;
  reservarDocumento(claveIdem: string, version: VersionInventario, params: Partial<ParametrosInventario>): Promise<DocumentoReservado>;
  completarDocumento(id: number, sha256: string, bytes: Uint8Array): Promise<void>;
}

export interface GeneradorPdfInventario {
  generar(snapshot: SnapshotInventario, folio: string, huella: string): Promise<Uint8Array>;
  huella(bytes: Uint8Array): string;
}
