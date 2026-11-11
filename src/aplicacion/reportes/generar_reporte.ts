// Caso de uso: preparar, verificar y enviar un reporte en una corrida (spec 16, sec. 8).
// Reglas: (1) el PDF NO sale si falla una comprobacion bloqueante: queda borrador con marca de agua, aviso de una linea y ningun envio;
// (2) idempotente por clave tipo+periodo: mismo paquete (misma huella) no regenera ni reenvia; un paquete distinto es version nueva;
// (3) el PDF se genera una vez y correo y Telegram envian el mismo archivo (un hash); (4) el PDF se verifica antes de entregarse.
import { entregaTelegramYCorreo } from './entrega';
import type { EntregaReportes, FuenteInsumos, PdfRenderizado, PeriodoSolicitado, RenderizadorPdf, ReportePublicado, RepositorioReportes } from './puertos';
import { construirAvisoNoSale } from '@/dominio/reportes/entrega';
import { renderHtml } from '@/dominio/reportes/html';
import { construirReporte } from '@/dominio/reportes/paginas';
import { armarPaquete, type Paquete } from '@/dominio/reportes/paquete';
import { ErrorReporte } from '@/dominio/reportes/tipos';
import { sha256BytesHex } from '@/dominio/reportes/util';

export interface DependenciasGenerar {
  readonly fuente: FuenteInsumos;
  readonly renderizador: RenderizadorPdf;
  readonly repositorio: RepositorioReportes;
  readonly entrega: EntregaReportes;
  /** Reglas @font-face con archivos locales; en pruebas puede ir vacio. */
  readonly cssFuentes: string;
}

export type ResultadoGenerar =
  | { readonly salio: true; readonly accion: 'emitido' | 'reemitido'; readonly reporte: ReportePublicado; readonly paquete: Paquete }
  | { readonly salio: true; readonly accion: 'sin_cambios'; readonly reporte: ReportePublicado }
  | { readonly salio: false; readonly aviso: string; readonly reporte: ReportePublicado; readonly paquete: Paquete };

export const claveReporte = (p: PeriodoSolicitado): string => `${p.tipo}:${p.inicio}`;

/** Verifica el PDF: una pagina por hoja del modelo (mas el anexo), ninguna con desborde, fuentes incrustadas. */
export function verificarPdf(pdf: PdfRenderizado, paginasEsperadas: number): void {
  const problemas: string[] = [];
  if (pdf.paginas !== paginasEsperadas) problemas.push(`paginas: se esperaban ${paginasEsperadas} y salieron ${pdf.paginas}`);
  if (pdf.paginasConDesborde.length > 0) problemas.push(`desborde en las paginas ${pdf.paginasConDesborde.join(', ')}`);
  if (pdf.fuentesIncrustadas.length === 0) problemas.push('sin fuentes incrustadas');
  if (problemas.length > 0) throw new ErrorReporte('PDF_INVALIDO', 'el PDF no paso la verificacion', problemas);
}

export async function generarReporte(solicitud: PeriodoSolicitado, d: DependenciasGenerar): Promise<ResultadoGenerar> {
  const clave = claveReporte(solicitud);
  const insumos = solicitud.tipo === 'semanal' ? await d.fuente.semanal(solicitud.inicio) : await d.fuente.mensual(solicitud.inicio);
  const paquete = armarPaquete(insumos);
  const previas = await d.repositorio.versiones(clave);
  const ultima = previas[previas.length - 1];

  // Idempotencia: el mismo paquete (misma huella) no se regenera ni se reenvia.
  if (ultima && ultima.huella === paquete.huella) {
    if (ultima.estado === 'publicado' && paquete.estado.sale) {
      // Si un canal quedo pendiente por un fallo, el reintento envia solo lo que falta.
      if (ultima.sha256Pdf && (!ultima.entregas.telegram || !ultima.entregas.correo)) {
        const pdfGuardado = await d.repositorio.pdf(clave, ultima.version);
        if (pdfGuardado) return { salio: true, accion: 'reemitido', reporte: await entregaTelegramYCorreo(paquete, ultima, pdfGuardado, d.entrega, d.repositorio), paquete };
      }
      return { salio: true, accion: 'sin_cambios', reporte: ultima };
    }
    if (ultima.estado === 'borrador' && !paquete.estado.sale && ultima.entregas.telegram) return { salio: false, aviso: construirAvisoNoSale(paquete), reporte: ultima, paquete };
  }

  const modelo = construirReporte(paquete);
  const html = renderHtml(modelo, { cssFuentes: d.cssFuentes });
  const version = (ultima?.version ?? 0) + 1;

  if (!paquete.estado.sale) {
    const reporte: ReportePublicado = { clave, version, folio: paquete.periodo.folio, huella: paquete.huella, estado: 'borrador', etiquetas: ['BORRADOR'], sha256Pdf: null, entregas: { telegram: false, correo: false } };
    await d.repositorio.guardar(reporte, null, html);
    const aviso = construirAvisoNoSale(paquete);
    // Solo el aviso de una linea al grupo de socios: sin PDF, sin correo.
    await d.entrega.telegramSocios(aviso, null);
    await d.repositorio.marcarEntrega(clave, version, 'telegram');
    return { salio: false, aviso, reporte: { ...reporte, entregas: { telegram: true, correo: false } }, paquete };
  }

  const pdf = await d.renderizador.renderizar(html);
  verificarPdf(pdf, modelo.paginas.length + 1);
  const sha = sha256BytesHex(pdf.bytes);
  const reporte: ReportePublicado = { clave, version, folio: paquete.periodo.folio, huella: paquete.huella, estado: 'publicado', etiquetas: paquete.estado.etiquetas, sha256Pdf: sha, entregas: { telegram: false, correo: false } };
  await d.repositorio.guardar(reporte, pdf.bytes, html);
  const entregado = await entregaTelegramYCorreo(paquete, reporte, pdf.bytes, d.entrega, d.repositorio);
  return { salio: true, accion: ultima ? 'reemitido' : 'emitido', reporte: entregado, paquete };
}
