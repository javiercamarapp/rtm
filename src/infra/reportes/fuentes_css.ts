// CSS de fuentes para el PDF: los WOFF2 locales de src/fuentes embebidos como data URI (sin red, sin rutas file://).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Cara {
  readonly familia: string;
  readonly archivo: string;
  readonly peso: string;
  readonly estilo: 'normal' | 'italic';
}

const CARAS: readonly Cara[] = [
  { familia: 'EB Garamond', archivo: 'eb-garamond-latin-400-normal.woff2', peso: '400', estilo: 'normal' },
  { familia: 'EB Garamond', archivo: 'eb-garamond-latin-400-italic.woff2', peso: '400', estilo: 'italic' },
  { familia: 'Figtree', archivo: 'figtree-latin-wght-normal.woff2', peso: '300 900', estilo: 'normal' },
  { familia: 'JetBrains Mono', archivo: 'jetbrains-mono-latin-400-normal.woff2', peso: '400', estilo: 'normal' },
];

export function cargarCssFuentes(dirFuentes: string): string {
  return CARAS.map((c) => {
    const b64 = readFileSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dirFuentes, c.archivo)).toString('base64');
    return `@font-face{font-family:"${c.familia}";font-style:${c.estilo};font-weight:${c.peso};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  }).join('\n');
}
