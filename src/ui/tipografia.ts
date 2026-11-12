// Tipografias autoalojadas (archivos locales en src/fuentes). Ninguna se pide por red: next/font/local las emite como parte del build.
// Una sola familia sans premium (Geist, SIL OFL 1.1) para toda la interfaz, con cifras tabulares; Geist Mono solo para folios, claves y huellas.
import localFont from 'next/font/local';

export const geist = localFont({
  src: '../fuentes/geist-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-geist',
});

export const geistMono = localFont({
  src: '../fuentes/geist-mono-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-geist-mono',
});

export const clasesTipografia = `${geist.variable} ${geistMono.variable}`;
