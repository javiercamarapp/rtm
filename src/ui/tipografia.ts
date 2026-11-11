// Tipografias autoalojadas (archivos locales en src/fuentes). Ninguna se pide por red: next/font/local las emite como parte del build.
import localFont from 'next/font/local';

export const figtree = localFont({
  src: '../fuentes/figtree-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-figtree',
});

export const garamond = localFont({
  src: [
    { path: '../fuentes/eb-garamond-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fuentes/eb-garamond-latin-400-italic.woff2', weight: '400', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-garamond',
});

export const jetbrains = localFont({
  src: '../fuentes/jetbrains-mono-latin-400-normal.woff2',
  weight: '400',
  display: 'swap',
  variable: '--font-jetbrains',
});

export const clasesTipografia = `${figtree.variable} ${garamond.variable} ${jetbrains.variable}`;
