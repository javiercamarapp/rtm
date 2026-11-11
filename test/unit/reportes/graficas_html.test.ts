import { describe, it, expect } from 'vitest';
import { armarPaquete } from '@/dominio/reportes/paquete';
import * as svg from '@/dominio/reportes/svg';
import { calcularPuente } from '@/dominio/reportes/puente';
import { construirReporte } from '@/dominio/reportes/paginas';
import { CSS_BASE, renderHtml, textoVisibleHtml } from '@/dominio/reportes/html';
import { inspeccionarPdf, normalizarPdf } from '@/infra/reportes/posproceso_pdf';
import { exclusivo } from '@/infra/reportes/render_pdf_chromium';
import { insumosMensualDorado, insumosSemanalDorado, PEDIDOS_SEMANA, PEDIDOS_SEMANA_ANTERIOR } from '../../fixtures/reportes/datos';
import { agregarPorModelo } from '@/dominio/reportes/puente';
import { sha256BytesHex } from '@/dominio/reportes/util';

const sem = armarPaquete(insumosSemanalDorado());
const mes = armarPaquete(insumosMensualDorado());
const g = mes.graficas;

const todas: [string, string][] = [
  ['puente', svg.svgPuente(g.puente!)],
  ['cascada', svg.svgCascada(g.cascada)],
  ['pareto', svg.svgPareto(g.pareto!.items, g.pareto!.totalCent)],
  ['cobertura', svg.svgCobertura(g.cobertura)],
  ['antiguedad', svg.svgAntiguedad(g.antiguedad)],
  ['flujo', svg.svgFlujo(g.flujo!)],
  ['barra segmentada', svg.svgBarraSegmentada(g.gastos.segmentos)],
  ['bullet', svg.svgBullet('Plataforma', g.gastos.plataforma!.gastoCent, g.gastos.plataforma!.topeCent)],
  ['divergente', svg.svgDivergente(g.socios!.pasos)],
  ['calor', svg.svgCalor(g.calor!)],
  ['bump', svg.svgBump(g.bump!)],
  ['burbujas', svg.svgBurbujas(g.burbujas!)],
  ['mancuernas', svg.svgMancuernas(g.mancuernas)],
  ['tendencia', svg.svgTendencia(g.tendencia!)],
  ['tornado', svg.svgTornado(g.tornado)],
  ['sparkline', svg.svgSparkline('Cartera', g.tendenciaCartera)],
];

describe('graficas SVG en blanco y negro', () => {
  it.each(todas)('%s: accesible (role img, titulo y descripcion) y solo grises', (_n, s) => {
    expect(s.length).toBeGreaterThan(100);
    expect(s).toMatch(/^<svg role="img" aria-labelledby="(\S+)t \1d"/);
    expect(s).toMatch(/<title id="\S+">[^<]+<\/title><desc id="\S+">[^<]+<\/desc>/);
    // Todo fill/stroke es una variable de gris, una trama del documento o none; ningun color literal.
    for (const m of s.matchAll(/(?:fill|stroke)="([^"]+)"/g)) expect(m[1], m[0]).toMatch(/^(var\(--rep-g[0-4]\)|url\(#rep-[a-z-]+\)|none)$/);
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
    expect(s).not.toMatch(/<script|onload=|href=/);
  });
  it('el puente no se dibuja si no suma: inicio + pasos = fin', () => {
    const p = calcularPuente(agregarPorModelo(PEDIDOS_SEMANA_ANTERIOR), agregarPorModelo(PEDIDOS_SEMANA))!;
    expect(svg.svgPuente(p)).not.toBe('');
    expect(svg.svgPuente({ ...p, finCent: p.finCent + 1n })).toBe('');
  });
  it('los datos vacios no dibujan nada (sin graficas fantasma)', () => {
    expect(svg.svgCascada([])).toBe('');
    expect(svg.svgPareto([], 0n)).toBe('');
    expect(svg.svgCobertura([])).toBe('');
    expect(svg.svgCobertura([{ modelo: 'X', dias: null, lo: null, hi: null, existencia: 0, sinVentaDias: 0 }])).toBe('');
    expect(svg.svgAntiguedad([])).toBe('');
    expect(svg.svgFlujo({ semanas: [], saldoMinimoCent: 0n, origenCobros: 'historia' })).toBe('');
    expect(svg.svgBarraSegmentada([])).toBe('');
    expect(svg.svgBullet('x', 1n, 0n)).toBe('');
    expect(svg.svgDivergente([])).toBe('');
    expect(svg.svgMancuernas([])).toBe('');
    expect(svg.svgTornado([])).toBe('');
    expect(svg.svgSparkline('x', [1n])).toBe('');
  });
  it('el escape de texto impide inyectar marcado desde un nombre de cliente', () => {
    expect(svg.esc('<img src=x onerror=alert(1)> & "q"')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
    const s = svg.svgPareto([{ id: 'a', etiqueta: '<b>x</b>', valorCent: 100n, pctAcumBp: 10_000n }], 100n);
    expect(s).not.toContain('<b>');
  });
  it('las barras negras marcan lo extremo: cobertura < 7 d o > 56 d', () => {
    const s = svg.svgCobertura([
      { modelo: 'A', dias: 6, lo: 5, hi: 7, existencia: 312, sinVentaDias: 0 },
      { modelo: 'B', dias: 20, lo: 15, hi: 25, existencia: 100, sinVentaDias: 0 },
      { modelo: 'C', dias: 60, lo: 50, hi: 70, existencia: 100, sinVentaDias: 0 },
    ]);
    const negras = (s.match(/fill="var\(--rep-g4\)"/g) ?? []).length;
    expect(negras).toBeGreaterThanOrEqual(2);
  });
  it('tramas definidas una vez por documento', () => {
    expect(svg.defsTramas()).toContain('id="rep-rayado"');
    expect(svg.defsTramas()).toContain('aria-hidden="true"');
  });
});

describe('plantilla HTML', () => {
  it('sin color: solo grises; carta con margenes de 48; una pagina por seccion', () => {
    expect(CSS_BASE).toContain('size:Letter');
    expect(CSS_BASE).toContain('width:612pt;height:792pt;padding:48pt');
    expect(CSS_BASE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const html = renderHtml(construirReporte(sem), { cssFuentes: '' });
    expect((html.match(/<section class="pagina/g) ?? []).length).toBe(8);
    expect(html).toContain('id="p-7"');
    expect(html).toContain('id="anexo"');
  });
  it('definitivo: sin marca de agua ni banda', () => {
    const html = renderHtml(construirReporte(sem), { cssFuentes: '' });
    expect(html).not.toContain('class="marca"');
    expect(html).not.toContain('class="banda"');
  });
  it('preliminar: banda en el encabezado y marca de agua en cada pagina', () => {
    const pre = armarPaquete(insumosSemanalDorado({ aprobadoEn: undefined }));
    const html = renderHtml(construirReporte(pre), { cssFuentes: '' });
    expect((html.match(/class="marca"/g) ?? []).length).toBe(7);
    expect(html).toContain('PRELIMINAR');
    expect((html.match(/class="banda"/g) ?? []).length).toBe(7);
  });
  it('el texto de un cliente con marcado se escapa en el HTML', () => {
    const malo = insumosSemanalDorado({ pedidos: PEDIDOS_SEMANA.map((p, i) => (i === 0 ? { ...p, cliente: '<script>alert(1)</script>' } : p)) });
    const html = renderHtml(construirReporte(armarPaquete(malo)), { cssFuentes: '' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('el texto visible quita estilos y etiquetas', () => {
    expect(textoVisibleHtml('<style>a{}</style><p>Hola &amp; <b>mundo</b></p><title>x</title>')).toBe('Hola & mundo');
  });
  it('cada pagina cierra con Implicacion y Siguiente paso', () => {
    const html = renderHtml(construirReporte(mes), { cssFuentes: '' });
    expect((html.match(/<b>Implicación\.<\/b>/g) ?? []).length).toBe(12);
    expect((html.match(/<b>Siguiente paso\.<\/b>/g) ?? []).length).toBe(12);
  });
});

describe('posproceso del PDF: fecha, ID y producer fijos', () => {
  const sintetico = (fecha: string, id: string, producer: string): Uint8Array => new Uint8Array(Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Producer (${producer}) /CreationDate (D:${fecha}+00'00') /ModDate (D:${fecha}+00'00') /Creator (Chromium) >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n3 0 obj\n<< /Type /Pages >>\nendobj\n/ID [<${id}> <${id}>]\n%%EOF`, 'latin1'));
  it('misma fecha fija y mismo contenido: bytes identicos aunque cambie lo que puso el navegador, y misma longitud', () => {
    const a = sintetico('20261111033920', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Skia/PDF m147');
    const b = sintetico('20261111034001', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Skia/PDF m147');
    const na = normalizarPdf(a, { fecha14: '20261110000000' });
    const nb = normalizarPdf(b, { fecha14: '20261110000000' });
    expect(na.length).toBe(a.length);
    expect(sha256BytesHex(na)).toBe(sha256BytesHex(nb));
    expect(Buffer.from(na).toString('latin1')).toContain('/CreationDate (D:20261110000000+00\'00\')');
    expect(Buffer.from(na).toString('latin1')).toContain('/Producer (RTM          )');
  });
  it('rechaza una fecha mal formada y cuenta paginas sin confundir /Pages', () => {
    expect(() => normalizarPdf(new Uint8Array(), { fecha14: '2026' })).toThrow(RangeError);
    expect(inspeccionarPdf(sintetico('20261111033920', 'aa', 'x')).paginas).toBe(1);
  });
  it('inspecciona fuentes incrustadas con prefijo de subconjunto', () => {
    const b = new Uint8Array(Buffer.from('/BaseFont /ABCDEF+Figtree-Regular /FontName /GHIJKL+EBGaramond /Name /Helvetica', 'latin1'));
    expect(inspeccionarPdf(b).fuentesIncrustadas).toEqual(['ABCDEF+Figtree-Regular', 'GHIJKL+EBGaramond']);
  });
});

describe('candado: un PDF a la vez', () => {
  it('las tareas exclusivas se ejecutan en serie aunque una falle', async () => {
    const log: string[] = [];
    const t = (n: string, ms: number, falla = false) =>
      exclusivo(async () => {
        log.push(`ini ${n}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`fin ${n}`);
        if (falla) throw new Error(n);
        return n;
      });
    const r = await Promise.allSettled([t('a', 30, true), t('b', 5), t('c', 1)]);
    expect(log).toEqual(['ini a', 'fin a', 'ini b', 'fin b', 'ini c', 'fin c']);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });
});
