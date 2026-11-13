// CSS de fuentes para el PDF: los WOFF2 locales de src/fuentes embebidos como data URI (sin red, sin rutas file://).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Cara {
  readonly familia: string;
  readonly archivo: string;
  readonly peso: string;
  readonly estilo: 'normal' | 'italic';
}

// Una sola familia: Geist (la de la interfaz, SIL OFL 1.1, permite incrustarla en documentos) y Geist Mono para folios y huellas.
const CARAS: readonly Cara[] = [
  { familia: 'Geist', archivo: 'geist-latin-wght-normal.woff2', peso: '100 900', estilo: 'normal' },
  { familia: 'Geist Mono', archivo: 'geist-mono-latin-wght-normal.woff2', peso: '100 900', estilo: 'normal' },
];

export function cargarCssFuentes(dirFuentes: string): string {
  return CARAS.map((c) => {
    const b64 = readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dirFuentes, c.archivo)).toString('base64');
    return `@font-face{font-family:"${c.familia}";font-style:${c.estilo};font-weight:${c.peso};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  }).join('\n');
}
