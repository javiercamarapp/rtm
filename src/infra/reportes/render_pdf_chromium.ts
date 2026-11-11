// Render a PDF con el Chromium de Playwright imprimiendo el HTML del reporte (spec 16, 3.2).
// Un solo PDF a la vez (candado global: la memoria de la Mac no aguanta varios Chromium), sin red (toda peticion fuera de data: se aborta),
// fuentes locales embebidas y posproceso que fija fecha, /ID y producer para un hash estable con reloj fijo.
import type { PdfRenderizado, RenderizadorPdf } from '@/aplicacion/reportes/puertos';
import { ErrorReporte } from '@/dominio/reportes/tipos';
import { inspeccionarPdf, normalizarPdf } from './posproceso_pdf';

let cola: Promise<unknown> = Promise.resolve();

/** Ejecuta `tarea` despues de que termine la anterior, aunque la anterior haya fallado. */
export function exclusivo<T>(tarea: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(tarea, tarea);
  cola = siguiente.catch(() => undefined);
  return siguiente;
}

export interface OpcionesChromium {
  /** Fecha fija de los metadatos del PDF (AAAAMMDDHHMMSS): normalmente el cierre del periodo. */
  readonly fecha14: string;
  readonly timeoutMs?: number;
}

export class RenderizadorChromium implements RenderizadorPdf {
  constructor(private readonly opciones: OpcionesChromium) {}

  renderizar(html: string): Promise<PdfRenderizado> {
    return exclusivo(() => this.imprimir(html));
  }

  private async imprimir(html: string): Promise<PdfRenderizado> {
    let chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
    } catch (e) {
      throw new ErrorReporte('RENDER_PDF', 'Playwright no esta disponible', [String(e)]);
    }
    const navegador = await chromium.launch({ headless: true }).catch((e: unknown) => {
      throw new ErrorReporte('RENDER_PDF', 'no se pudo abrir Chromium', [String(e)]);
    });
    try {
      const contexto = await navegador.newContext({ offline: true });
      const pagina = await contexto.newPage();
      await pagina.route('**/*', (r) => (r.request().url().startsWith('data:') || r.request().url() === 'about:blank' ? r.continue() : r.abort()));
      await pagina.setContent(html, { waitUntil: 'load', timeout: this.opciones.timeoutMs ?? 60_000 });
      await pagina.evaluate(() => document.fonts.ready.then(() => true));
      const medida = await pagina.evaluate(() => {
        const hojas = Array.from(document.querySelectorAll('.pagina'));
        return { n: hojas.length, desborde: hojas.map((h, i) => (h.scrollHeight > h.clientHeight + 1 ? i + 1 : 0)).filter((x) => x > 0) };
      });
      const crudo = await pagina.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      const bytes = normalizarPdf(new Uint8Array(crudo), { fecha14: this.opciones.fecha14 });
      const info = inspeccionarPdf(bytes);
      return { bytes, paginas: info.paginas, paginasConDesborde: medida.desborde, fuentesIncrustadas: info.fuentesIncrustadas };
    } finally {
      await navegador.close();
    }
  }
}
