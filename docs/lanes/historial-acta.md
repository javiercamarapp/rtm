# Carril historial-acta

Rama `lane/historial-acta` (base `rediseno/premium`), worktree `~/rtm-lane-historial`. 0 builds de Vercel, 0 despliegues, sin push, sin tocar `~/rtm`, Vercel ni Supabase en la nube. Base local propia: proyecto `rtm-lane-hist`, puertos 633xx (cambio en `supabase/config.toml` solo para este carril: NO integrar ese archivo).

## Que ya existia (no se duplico)
Cascada, propuesta/firma/anulacion/contra-acta, candado de periodo, reinversion como capital, `api.cierres_reparto`, PDF del acta, valuacion contable (`contabilidad.valuacion`) y su serie.

## Que se agrego
- Migracion `20261113200000_historial_acta.sql` (aditiva): `operacion.acta_sello` (foto inmutable al cerrarse el acta, huella SHA-256, trigger diferido), `api.historial_socio`, `api.acta_detalle`, `api.acta_periodo_sugerido`, `api.explicar_historial` (dos vias), regla unica de redondeo `mitad_socio`.
- Migracion `20261113200100_conta_reinversion_acta.sql`: correccion de un defecto real. Firmar un acta con reinversion fallaba al confirmar ("el evento no cuadra") porque `contabilidad.lineas_de_evento` no tenia la rama `reinversion` (3310). La prueba 016 existente no lo detectaba.
- pgTAP `028_historial_acta.test.sql` (77 pruebas, PASS en base limpia); 016 siguio en PASS (51).
- Dominio puro `src/dominio/historial/ratios.ts` (ROI, anualizado, multiplo, TIR/XIRR, payback, payout, reinversion, cobertura, margen, por pieza, mejores/peores meses, promedio movil, rachas, estacionalidad, proyeccion a 3 meses con banda que se estrecha; sin dato en vez de cero). 32 pruebas vitest PASS.
- Pantallas: `/socios/[socio]/historial` (cabecera con Explicar este numero, ratios, linea de tiempo por ano, series por mes/semana/dia, por cliente y modelo, proyeccion personal), `/socios/actas/[id]` (decisiones, firmas, sello), formulario de acta con retiro/reinversion por socio en `/socios/cascada` y corte mensual sugerido, PDF del acta con sello y estado de cuenta personal en PDF. Enlaces desde `/socios` y estado de cuenta.
- e2e `test/e2e/historial-acta.spec.ts`, capturas `test/capturas/historial.spec.ts`, demo ilustrativa `scripts/capturas/datos-demo-historial.mjs`.

## Verificacion con resultado real
- `tsc --noEmit`, `eslint src test`, `npm run guardas`: limpios.
- vitest `test/unit/historial`: 32/32.
- pgTAP 028: 77/77; 016: 51/51.
- e2e: en la ultima corrida pasaron 1-3 (proponer, firmar los dos, sello, PDF, Explicar); la 4 fallo por un bug (piezas BigInt) ya corregido y commiteado; NO se pudo volver a correr la 4 y la 5 (movil 390) ni tomar capturas, porque el coordinador pidio detener suites pesadas por carga de 120+ y la carga no bajo de 40 a tiempo.

## Pendientes
1. Reiniciar base propia (`supabase start`, `db reset`, demo), `next dev -p 3184`, correr `playwright.historial.config.ts` (tests 4 y 5) y `playwright.capturas-historial.config.ts`; revisar los PNG con Read.
2. Corre vitest completo y pgTAP completo una vez en solitario.
3. No hay envio del PDF del acta por correo (el envio de reportes por correo es de otro carril).
4. Al integrar, excluir el cambio de puertos de `supabase/config.toml`.
