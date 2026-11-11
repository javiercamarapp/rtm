// UNA corrida real de Chromium a la vez (las pruebas de este archivo son secuenciales y el renderizador tiene candado global).
// Se omite si el navegador de Playwright no esta instalado en esta maquina.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { armarPaquete } from '@/dominio/reportes/paquete';
import { construirReporte, contextoGuardia } from '@/dominio/reportes/paginas';
import { renderHtml } from '@/dominio/reportes/html';
import { verificarTexto } from '@/dominio/reportes/guardia';
import { RenderizadorChromium } from '@/infra/reportes/render_pdf_chromium';
import { cargarCssFuentes } from '@/infra/reportes/fuentes_css';
import { verificarPdf } from '@/aplicacion/reportes/generar_reporte';
import { sha256BytesHex } from '@/dominio/reportes/util';
import { insumosMensualDorado, insumosSemanalDorado } from '../../fixtures/reportes/datos';

const FUENTES = join(__dirname, '../../../src/fuentes');
const hayChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
const hayPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const norm = (t: string) => t.replace(/\s+/g, ' ').replace(/−/g, '-').trim();
function textoPdf(bytes: Uint8Array, desde: number, hasta: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'rtm-pdf-'));
  try {
    const ruta = join(dir, 'r.pdf');
    writeFileSync(ruta, bytes);
    return execFileSync('pdftotext', ['-f', String(desde), '-l', String(hasta), ruta, '-'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!hayChromium)('PDF real con el Chromium de Playwright', () => {
  const render = new RenderizadorChromium({ fecha14: '20261110000000' });
  const css = cargarCssFuentes(FUENTES);
  const sem = armarPaquete(insumosSemanalDorado());
  const modeloSem = construirReporte(sem);
  const html = renderHtml(modeloSem, { cssFuentes: css });
  let bytes: Uint8Array;

  it('semanal: 7 paginas mas anexo, ninguna con desborde, fuentes incrustadas (Garamond, Figtree y mono)', async () => {
    const r = await render.renderizar(html);
    bytes = r.bytes;
    expect(r.paginasConDesborde).toEqual([]);
    expect(r.paginas).toBe(8);
    expect(r.fuentesIncrustadas.some((f) => /Figtree/.test(f))).toBe(true);
    expect(r.fuentesIncrustadas.some((f) => /EBGaramond/.test(f))).toBe(true);
    expect(r.fuentesIncrustadas.some((f) => /JetBrainsMono/.test(f))).toBe(true);
    expect(r.fuentesIncrustadas.some((f) => /Helvetica|Arial|Times/.test(f))).toBe(false);
    expect(() => verificarPdf(r, modeloSem.paginas.length + 1)).not.toThrow();
    expect(Buffer.from(r.bytes).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it.skipIf(!hayPdftotext)('semanal: el texto extraido del PDF trae las cifras esperadas y coincide con el modelo; ningun numero fuera del paquete', () => {
    const t = norm(textoPdf(bytes, 1, 7));
    for (const esperado of ['$40,422', '2,310 pz', '$17.50', '$463,900', '$183,400']) expect(t).toContain(norm(esperado));
    for (const pg of modeloSem.paginas) {
      expect(t, pg.id).toContain(norm(pg.titular));
      expect(t, pg.id).toContain(norm(pg.implicacion));
      expect(t, pg.id).toContain(norm(pg.siguiente));
      for (const h of pg.hallazgos) expect(t, h).toContain(norm(h));
    }
    expect(verificarTexto(textoPdf(bytes, 1, 7), contextoGuardia(sem)).violaciones).toEqual([]);
  });

  it('semanal: dos corridas con el mismo paquete dan el mismo sha256', async () => {
    const otra = await render.renderizar(html);
    expect(sha256BytesHex(otra.bytes)).toBe(sha256BytesHex(bytes));
  });

  it('mensual: 12 paginas mas anexo, sin desborde', async () => {
    const m = armarPaquete(insumosMensualDorado());
    const r = await render.renderizar(renderHtml(construirReporte(m), { cssFuentes: css }));
    expect(r.paginasConDesborde).toEqual([]);
    expect(r.paginas).toBe(13);
  });

  it('sin red: una peticion externa del HTML se aborta y el PDF sale igual', async () => {
    const minimo = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>x</title><style>@page{size:Letter;margin:0}.pagina{width:612pt;height:792pt}</style></head><body><section class="pagina"><img src="http://127.0.0.1:9/x.png" alt=""><p>Hola</p></section></body></html>';
    const r = await render.renderizar(minimo);
    expect(r.paginas).toBe(1);
  });
});
