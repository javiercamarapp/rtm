Fuentes autoalojadas (subconjunto latino, WOFF2), obtenidas del registro npm (@fontsource) bajo SIL Open Font License 1.1:
Figtree, EB Garamond, JetBrains Mono, Fraunces, Instrument Sans, IBM Plex Mono.
Fraunces, Instrument Sans e IBM Plex Mono solo se cargan en /login.
Los archivos figtree-latin-400/600-normal.woff y eb-garamond-latin-400-normal.woff (WOFF 1, de @fontsource) se usan solo para incrustar fuentes en los PDF (fontkit no subconjunta bien WOFF2).

Geist y Geist Mono (geist-latin-wght-normal.woff2, geist-mono-latin-wght-normal.woff2): Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font), SIL Open Font License 1.1, obtenidas de @fontsource-variable/geist y @fontsource-variable/geist-mono (copiadas una vez; no son dependencia del proyecto). Son la tipografia de toda la interfaz; Geist Mono solo para folios, claves y huellas.
Figtree y EB Garamond (los .woff y .woff2 restantes) ya no se usan en la interfaz: solo el PDF de notas y reportes las incrusta (src/infra/pdf, src/infra/reportes).
