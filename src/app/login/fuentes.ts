// Las tres voces del login: Fraunces (titulares), Instrument Sans (cuerpo) e IBM Plex Mono (el arte). Archivos LOCALES (src/fuentes),
// nada por red. Se cargan aqui y no en el layout raiz para que viajen solo en /login.
import localFont from 'next/font/local';

export const fraunces = localFont({
  src: '../../fuentes/fraunces-latin-wght-normal.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-fraunces',
});

export const instrument = localFont({
  src: '../../fuentes/instrument-sans-latin-wght-normal.woff2',
  weight: '400 700',
  display: 'swap',
  variable: '--font-instrument',
});

export const plexMono = localFont({
  src: [
    { path: '../../fuentes/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../../fuentes/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plexmono',
});
