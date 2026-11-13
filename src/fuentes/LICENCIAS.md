Una sola familia en toda la aplicacion, el login y los PDF: Geist (y Geist Mono para folios, claves, huellas y el arte del login).
Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font), SIL Open Font License 1.1. Obtenidas del registro npm (@fontsource, @fontsource-variable; copiadas una vez, no son dependencia del proyecto).

Archivos:
- geist-latin-wght-normal.woff2 y geist-mono-latin-wght-normal.woff2 (variables): interfaz (src/ui/tipografia.ts), login y reportes en PDF (Chromium las incrusta, src/infra/reportes/fuentes_css.ts).
- geist-latin-400-normal.woff y geist-latin-600-normal.woff (estaticas, WOFF 1): solo para incrustar en los PDF de notas, actas e inventarios (src/infra/pdf/nota.ts); fontkit no subconjunta bien las variables.

Licencia y PDF: la OFL 1.1 permite usar, estudiar, copiar, incrustar y redistribuir la fuente (incluido su subconjunto dentro de un documento) y usarla en documentos comerciales; solo prohibe vender la fuente por si sola y exige conservar el aviso de copyright y la licencia con la fuente. Por eso este archivo viaja con ellas. No se usa el nombre reservado en ninguna version modificada (no se modifica ningun archivo).

Retiradas el 13-nov (decision del dueno de usar Geist en login y PDF): Figtree, EB Garamond, JetBrains Mono, Fraunces, Instrument Sans e IBM Plex Mono.
