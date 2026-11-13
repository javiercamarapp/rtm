# Carril puente-efectivo: informe

Rama `lane/puente-efectivo` (base `rediseno/premium`), worktree `~/rtm-lane-puente`. Sin push, sin Vercel, sin nube; instancia Supabase propia `rtm-puente` (puertos 573xx, `config.toml` solo en el arbol de trabajo, no versionado).

## Que se hizo
1. Merge de `feat/puente-efectivo-asientos`; migracion renumerada a 20261112400000; conflictos en `acciones.ts` (se agrego `conta:efectivo`) y en la pagina densa de Comprobaciones (se conserva el rediseno y la fila C23 abre la explicacion de la diferencia).
2. C24 y `contabilidad.efectivo_por_caja()` (caja por persona contra 1101 con dimension); retag de la dimension de 1101 en `lineas_de_evento`.
3. Migracion 20261112400100: cobro en efectivo, pago a proveedor, pago de Omar, entrega de socio, reembolso del acta y caja de la apertura crean su renglon en el libro de efectivo (disparadores; apertura.publicar y apertura.reversar redefinidas con el mismo cuerpo mas el renglon).
4. Pruebas pgTAP 028 (flujos y cajas, mutaciones, identidad) y 029 (apertura y acta con compensacion y contra-acta); 025 actualizada (27 comprobaciones).
5. Decisiones para Javier: ver docs/puente-efectivo-asientos.md.

## Comandos y resultados reales
- `supabase db reset --local`: aplica todas las migraciones sin error.
- `supabase test db --local`: 49 archivos, 2392 pruebas; unica falla 024_omar_cuenta_sin_folio #13, preexistente (usa fechas fijas del 10 y 11 de noviembre y falla desde el 12; ya anotada en docs/union-produccion.md). 028 y 029 en verde.
- `npx tsc --noEmit`: sin errores. `npm run lint`: sin salida de errores. `node scripts/ci/guardas.mjs`: 0 violaciones.
- `npx vitest run`: 112 archivos, 1715 pruebas pasan, 2 fallas esperadas.
- Playwright: no corrido. Capturas: ninguna (no hay pantalla nueva; solo la fila C24 aparece en la tabla de Comprobaciones, verificada por SQL, no visualmente).

## Pendientes
Ver el documento de reglas: decisiones 1 a 5 y pendientes. Para fusionar con el rediseno: la migracion usa prefijos 20261112400000 y 20261112400100, posteriores a las de a2 y a3 (20261112200000, 20261112300000).
