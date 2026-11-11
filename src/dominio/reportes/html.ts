// Plantilla HTML del reporte (spec 16, 3.2): Carta 612 x 792 pt, margenes de 48, blanco y negro con grises, sin fondos oscuros ni cajas decorativas.
// Titulares y cifra heroe en EB Garamond; cuerpo y tablas en Figtree con cifras tabulares; folios y huellas en JetBrains Mono.
// Una funcion pura: el HTML es lo que imprime Chromium. Las fuentes llegan como CSS (@font-face con rutas locales) desde la infraestructura.
import { celdaATexto, type PaginaModelo, type ReporteModelo } from './paginas';
import { defsTramas, esc } from './svg';
import type { Tabla } from './tipos';

export interface OpcionesHtml {
  /** Reglas @font-face con archivos locales (nunca red). */
  readonly cssFuentes: string;
}

export const CSS_BASE = `
:root{--rep-g0:rgb(255 255 255);--rep-g1:rgb(222 222 222);--rep-g2:rgb(160 160 160);--rep-g3:rgb(96 96 96);--rep-g4:rgb(26 26 26)}
*{box-sizing:border-box}
@page{size:Letter;margin:0}
html,body{margin:0;padding:0;background:var(--rep-g0);color:var(--rep-g4);font-family:Figtree,"Helvetica Neue",Arial,sans-serif;font-size:9pt;line-height:1.35;font-variant-numeric:tabular-nums}
.pagina{position:relative;width:612pt;height:792pt;padding:48pt;overflow:hidden;page-break-after:always;break-after:page;display:flex;flex-direction:column;background:var(--rep-g0)}
.pagina:last-child{page-break-after:auto;break-after:auto}
.cab{display:flex;justify-content:space-between;align-items:baseline;border-bottom:0.75pt solid var(--rep-g4);padding-bottom:4pt;margin-bottom:10pt;font-size:8.5pt}
.cab .estado{font-weight:700;letter-spacing:0.04em}
.banda{border:1pt solid var(--rep-g4);padding:3pt 6pt;margin-bottom:8pt;font-weight:600;font-size:8.5pt;background:url(#rep-rayado-fino)}
h1{font-family:"EB Garamond",Georgia,serif;font-weight:400;font-size:19pt;line-height:1.15;margin:0 0 8pt 0;font-variant-numeric:lining-nums}
.heroe{margin:2pt 0 8pt 0}
.heroe .cifra{font-family:"EB Garamond",Georgia,serif;font-size:44pt;line-height:1;font-weight:400;font-variant-numeric:lining-nums}
.heroe .det{font-size:8.5pt;color:var(--rep-g3)}
.apoyo{display:grid;grid-template-columns:repeat(4,1fr);gap:8pt;border-top:0.5pt solid var(--rep-g2);border-bottom:0.5pt solid var(--rep-g2);padding:6pt 0;margin-bottom:8pt}
.apoyo .e{font-size:8pt;color:var(--rep-g3)}.apoyo .v{font-size:13pt;font-weight:600}.apoyo .c{font-size:8pt;color:var(--rep-g3)}
h2{font-size:8pt;letter-spacing:0.08em;text-transform:uppercase;margin:6pt 0 3pt 0;color:var(--rep-g3)}
ol,ul{margin:0 0 6pt 0;padding-left:14pt}li{margin-bottom:2pt}
.graf{margin:4pt 0;break-inside:avoid;page-break-inside:avoid}
table{width:100%;border-collapse:collapse;font-size:8.5pt;margin:4pt 0;break-inside:avoid}
caption{text-align:left;font-weight:600;padding-bottom:2pt}
th{text-align:left;font-weight:600;border-bottom:0.75pt solid var(--rep-g4);padding:2pt 3pt}
td{border-bottom:0.4pt solid var(--rep-g1);padding:2pt 3pt;vertical-align:top}
td.n,th.n{text-align:right}
.nota{font-size:8.5pt;color:var(--rep-g3)}
.pie-pagina{margin-top:auto}
.impl{border-top:0.75pt solid var(--rep-g4);padding-top:5pt;margin-top:6pt}
.impl p{margin:0 0 2pt 0}.impl b{font-weight:700}
.proc{font-size:8pt;color:var(--rep-g3);border-top:0.4pt solid var(--rep-g2);margin-top:6pt;padding-top:3pt}
.folio{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:8pt;display:flex;justify-content:space-between}
.marca{position:absolute;left:0;right:0;top:330pt;text-align:center;font-family:"EB Garamond",Georgia,serif;font-size:96pt;font-weight:400;letter-spacing:0.1em;color:var(--rep-g1);transform:rotate(-24deg);pointer-events:none;z-index:0;opacity:0.55}
.pagina>*:not(.marca){position:relative;z-index:1}
.anexo .cols{column-count:2;column-gap:14pt}.anexo h2{margin-top:6pt;break-after:avoid}.anexo p{margin:0 0 2pt 0;font-size:8pt;break-inside:avoid}
`;

function tablaHtml(t: Tabla): string {
  if (t.filas.length === 0) return `<p class="nota">${esc(t.nota ?? `Sin renglones en ${t.titulo.toLowerCase()}.`)}</p>`;
  const num = (c: string) => /^[−$\d]/.test(c) && !/[a-z]{3}/i.test(c.slice(0, 3));
  const cab = `<tr>${t.columnas.map((c, j) => `<th class="${j > 0 && t.filas[0] && num(celdaATexto(t.filas[0][j]!)) ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr>`;
  const filas = t.filas.map((f) => `<tr>${f.map((c) => `<td class="${c.t === 'texto' ? '' : 'n'}">${esc(celdaATexto(c))}</td>`).join('')}</tr>`).join('');
  return `<table><caption>${esc(t.titulo)}</caption><thead>${cab}</thead><tbody>${filas}</tbody></table>${t.nota ? `<p class="nota">${esc(t.nota)}</p>` : ''}`;
}

function paginaHtml(r: ReporteModelo, pg: PaginaModelo, i: number): string {
  const marca = !r.sale ? 'BORRADOR' : r.preliminar ? 'PRELIMINAR' : '';
  const banda = r.estado !== 'DEFINITIVO' ? `<div class="banda" role="note">${esc(r.estado)}${!r.sale ? ': no se publica; borrador con marca de agua' : r.preliminar ? ': no usar para decidir hasta que cuadren las comprobaciones' : ''}</div>` : '';
  const hallazgos = pg.hallazgos.length ? `<h2>Lo que encontramos</h2><ol>${pg.hallazgos.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : '';
  const acciones = pg.acciones.length ? `<h2>Qué hacer</h2><ol>${pg.acciones.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : '';
  const apoyo = pg.apoyo.length ? `<div class="apoyo">${pg.apoyo.map((t) => `<div><div class="e">${esc(t.etiqueta)}</div><div class="v">${esc(t.valor)}</div><div class="c">${esc(t.comparacion)}</div><div class="c">${esc(t.clase)}</div></div>`).join('')}</div>` : '';
  const heroe = pg.heroe ? `<div class="heroe"><div class="cifra">${esc(pg.heroe.valor)}</div><div class="det">${esc(pg.heroe.etiqueta)}${pg.heroe.detalle ? ` · ${esc(pg.heroe.detalle)}` : ''} · ${esc(pg.heroe.clase)}</div></div>` : '';
  return `<section class="pagina" id="p-${i + 1}" aria-label="Página ${i + 1}: ${esc(pg.id)}">
${marca ? `<div class="marca" aria-hidden="true">${marca}</div>` : ''}
<div class="cab"><span>${esc(r.encabezado)}</span><span class="estado">${esc(r.estado)}</span></div>
${banda}<h1>${esc(pg.titular)}</h1>${heroe}${apoyo}${hallazgos}${acciones}
${pg.graficas.map((g) => `<div class="graf">${g.svg}</div>`).join('')}
${pg.tablas.map(tablaHtml).join('')}
${pg.notas.map((n) => `<p class="nota">${esc(n)}</p>`).join('')}
<div class="pie-pagina"><div class="impl"><p><b>Implicación.</b> ${esc(pg.implicacion)}</p><p><b>Siguiente paso.</b> ${esc(pg.siguiente)}</p></div>
<div class="proc">${esc(pg.procedencia)}</div>
<div class="folio"><span>${esc(r.folio)}</span><span>p. ${i + 1}/${r.paginas.length}</span><span>huella ${esc(r.huella)}</span></div></div>
</section>`;
}

export function renderHtml(r: ReporteModelo, o: OpcionesHtml): string {
  const paginas = r.paginas.map((pg, i) => paginaHtml(r, pg, i)).join('\n');
  const anexo = `<section class="pagina anexo" id="anexo" aria-label="Anexo: método y control">
${!r.sale ? '<div class="marca" aria-hidden="true">BORRADOR</div>' : ''}
<div class="cab"><span>${esc(r.encabezado)}</span><span class="estado">${esc(r.estado)}</span></div>
<h1>Método y control</h1>
<div class="cols">${r.anexo.map((x) => `<h2>${esc(x.titulo)}</h2>${x.lineas.map((l) => `<p>${esc(l)}</p>`).join('')}`).join('')}</div>
<div class="pie-pagina"><div class="folio"><span>${esc(r.folio)}</span><span>anexo</span><span>huella ${esc(r.huella)}</span></div></div>
</section>`;
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.encabezado)} · ${esc(r.folio)}</title>
<style>${o.cssFuentes}${CSS_BASE}</style></head><body>
${defsTramas()}
<main>
${paginas}
${anexo}
</main></body></html>`;
}

/** Texto visible de un HTML (sin etiquetas ni estilos) para la comparacion con el texto extraido del PDF. */
export function textoVisibleHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<title>[\s\S]*?<\/title>/g, ' ')
    .replace(/<desc[\s\S]*?<\/desc>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
