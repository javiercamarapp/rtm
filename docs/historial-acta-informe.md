# Carril historial-acta: Historial personal por socio y UI del acta de corte

Rama `lane/historial-acta` (base `rediseno/premium`), worktree `~/rtm-lane-historial`. Sin push, sin Vercel, sin nube, sin datos reales (todo lo sembrado es ilustrativo: `scripts/capturas/datos-demo-historial.mjs`).

## Lo que ya existia (no se duplico)
SQL: cascada, `proponer/firmar/anular/contra_acta`, candado de periodo, reinversion como aportacion de capital, `api.cierres_reparto`. TS: tipo `CierreReparto`, `pdfActaCorte` (sin conectar a ninguna ruta), pagina de cascada (proponia el acta SIN decisiones por socio).

## Lo que se anadio
- Migracion `20261112400000_historial_acta.sql` (aditiva): sello inmutable del acta (`operacion.acta_sello`, disparador diferido, huella SHA-256: capital contable, valor de cada participacion, fondos en poder, compensaciones, invertido); `api.acta_periodo_sugerido`, `api.acta_detalle`, `api.historial_socio` (cabecera, flujos, linea de tiempo, series dia/semana/mes, por cliente, por modelo), `api.explicar_historial` (dos vias; funcion propia, no toca la cadena de `explicar_cifra`). Solo rol socio.
- Migracion `20261112400100_conta_reinversion_acta.sql`: CORRECCION de un defecto real. Firmar un acta con reinversion fallaba al confirmar ("el evento cierre_reparto_firmado no cuadra": debe 1,422,100 contra haber 2,222,100 en la prueba) porque `contabilidad.lineas_de_evento` no tenia cuenta para el libro `reinversion`. Se agrega la rama `reinversion -> 3310` (copia de la definicion vigente con una sola rama nueva).
- Dominio puro `src/dominio/historial/ratios.ts` (ROI, ROI anualizado, multiplo, TIR/XIRR, payback, reinversion, payout, retiro mensual, margen, utilidad por pieza, cobertura de caja, participaciones, rachas, mejores/peores, promedio movil, estacionalidad semanal, proyeccion a 3 meses con banda que se estrecha). Sin IA; "Sin dato" cuando falta base.
- Pantallas: `/socios/[socio]/historial` (+ `/pdf`), `/socios/actas/[id]` (+ `/pdf`), formulario de acta con retiro y reinversion por socio en `/socios/cascada`, corte mensual sugerido, enlaces desde Cuenta de socios y Estado de cuenta. "Explicar este numero" en invertido, retirado, utilidad recibida, valor, cuenta y disponible por acta.
- `pdfActaCorte` ahora incluye el sello; nuevo `pdfHistorialSocio`.
- Hallazgos corregidos en el camino: (1) `decisiones` del acta (`retira`/`reinvierte`) llegaba como number aunque el tipo decia bigint (se convierte en `decisionesABigint`; habria roto el PDF existente); (2) `.rtm-region { display: contents }` en `premium.css` (heredado de la etapa 4) rompia el armazon: el panel caia bajo el sidebar a 216 px en cualquier pagina. Se quito esa linea.

## Comandos y resultados reales
- `npx tsc --noEmit`: sin errores. `npx eslint src scripts test`: sin errores. `npm run guardas`: 0 violaciones.
- `npx vitest run`: 115 archivos, 1747 pruebas pasan (2 expected fail preexistentes). Nuevas: `test/unit/historial/{ratios,tipos,pdf}.test.ts` (32 pruebas).
- `supabase test db` completo (47 archivos): todo pasa excepto `024_omar_cuenta_sin_folio` prueba 13 ("ajuste de -60.00", tiene -10000), que FALLA IGUAL en la base sin mis migraciones (preexistente, no es de este carril). Nueva `028_historial_acta.test.sql`: 77 pruebas pasan; incluye el cuadre contable al cerrar el acta con las restricciones diferidas inmediatas.
- Playwright `playwright.historial.config.ts` (5 pruebas, Chromium, servidor `next start` en 3184, base propia): sin sesion redirige; propone el acta con retiro y reinversion; firman Angelo y Javier; sello y PDF; historial con ratios, linea de tiempo, vistas semana/dia, explicar cuadra, PDF, historial del otro socio; movil 390 sin scroll horizontal. 5/5.
- Capturas: `docs/capturas/historial-acta/` (28: 1440 y 390, claro y oscuro; ninguna con scroll horizontal). Se revisaron a mano; defectos vistos y corregidos: armazon roto, KPI cortado, columnas truncadas, cifras partidas en tarjetas moviles.

## Aislamiento
Proyecto Supabase `rtm-lane-hist`, puertos 633xx (solo local), servidor en 3184. Otras sesiones tumbaron una vez mi base y mi servidor (se reiniciaron). `supabase/config.toml` vuelve a los puertos del repo en el ultimo commit.

## Pendientes
- Firma por boton de Telegram y envio del PDF del acta por correo a los socios: pertenecen a los carriles agente-telegram y reportes (aqui solo estan la web y el PDF).
- Estimado del valor personal = valor en libros (rango: sin contar por cobrar a clientes); supuestos editables y flujo descontado quedan para la pagina Valuacion.
- Etiqueta movil "Valor de su participacion" se parte en dos lineas.
- Integracion: dos migraciones nuevas (prefijo 20261112400000 y 400100) y la linea de `.rtm-region`; si otro carril quita la misma linea de CSS el merge es identico.
- Sin datos reales cargados: el historial estara en "Sin dato" hasta los datos de apertura.
