// Puertos del motor de reportes. La base, Chromium, Telegram y el correo viven detras de estas interfaces; el dominio y el caso de uso
// no importan nada concreto. Las implementaciones en memoria (tests) y la de Chromium (infra) cumplen el mismo contrato.
import type { InsumosMensual, InsumosSemanal } from '@/dominio/reportes/insumos';

export interface PeriodoSolicitado {
  readonly tipo: 'semanal' | 'mensual';
  /** AAAA-MM-DD del lunes (semanal) o del dia 1 (mensual). */
  readonly inicio: string;
}

/** Lo que la base entrega para armar el paquete (lecturas de las funciones STABLE de contabilidad). */
export interface FuenteInsumos {
  semanal(inicio: string): Promise<InsumosSemanal>;
  mensual(inicio: string): Promise<InsumosMensual>;
}

export interface PdfRenderizado {
  readonly bytes: Uint8Array;
  readonly paginas: number;
  /** Indices (desde 1) de paginas cuyo contenido desborda la hoja Carta. */
  readonly paginasConDesborde: readonly number[];
  readonly fuentesIncrustadas: readonly string[];
}

/** Render a PDF detras de un puerto: la implementacion de produccion imprime HTML con el Chromium de Playwright, un trabajo a la vez. */
export interface RenderizadorPdf {
  renderizar(html: string): Promise<PdfRenderizado>;
}

export type EstadoPublicacion = 'publicado' | 'borrador';

export interface ReportePublicado {
  readonly clave: string;
  readonly version: number;
  readonly folio: string;
  readonly huella: string;
  readonly estado: EstadoPublicacion;
  readonly etiquetas: readonly string[];
  readonly sha256Pdf: string | null;
  readonly entregas: { readonly telegram: boolean; readonly correo: boolean };
}

/** Un reporte publicado no se regenera: se reemite como version nueva y se conserva la anterior. */
export interface RepositorioReportes {
  versiones(clave: string): Promise<readonly ReportePublicado[]>;
  guardar(r: ReportePublicado, pdf: Uint8Array | null, html: string): Promise<void>;
  marcarEntrega(clave: string, version: number, canal: 'telegram' | 'correo'): Promise<void>;
  pdf(clave: string, version: number): Promise<Uint8Array | null>;
}

export interface EntregaReportes {
  /** Grupo de socios: nunca el chat de Omar. */
  telegramSocios(texto: string, adjunto: { nombre: string; bytes: Uint8Array } | null): Promise<void>;
  /** A los dos dueños; nunca a Omar. */
  correoDuenos(correo: { asunto: string; cuerpo: string }, adjunto: { nombre: string; bytes: Uint8Array }): Promise<void>;
}
