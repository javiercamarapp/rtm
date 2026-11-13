# Carril historial-acta: Historial personal por socio y UI del acta de corte

Rama `lane/historial-acta` (base `rediseno/premium`), worktree `~/rtm-lane-historial`. Sin push, sin Vercel, sin nube, sin datos reales (todo lo sembrado es ilustrativo: `scripts/capturas/datos-demo-historial.mjs`).

## Lo que ya existia (no se duplico)
SQL: cascada, `proponer/firmar/anular/contra_acta`, candado de periodo, reinversion como aportacion de capital, `api.cierres_reparto`. TS: tipo `CierreReparto`, `pdfActaCorte` (sin conectar a ninguna ruta), pagina de cascada (proponia el acta SIN decisiones por socio).

## Lo que se anadio
- Migracion `20261113200000_historial_acta.sql` (aditiva): sello inmutable del acta (`operacion.acta_sello`, disparador diferido, huella SHA-256: capital contable, valor de cada participacion, fondos en poder, compensaciones, invertido); `api.acta_periodo_sugerido`, `api.acta_detalle`, `api.historial_socio` (cabecera, flujos, linea de tiempo, series dia/semana/mes, por cliente, por modelo), `api.explicar_historial` (dos vias; funcion propia, no toca la cadena de `explicar_cifra`). Solo rol socio.
- Migracion `20261113200100_conta_reinversion_acta.sql`: CORRECCION de un defecto real. Firmar un acta con reinversion fallaba al confirmar ("el evento cierre_reparto_firmado no cuadra": debe 1,422,100 contra haber 2,222,100 en la prueba) porque `contabilidad.lineas_de_evento` no tenia cuenta para el libro `reinversion`. Ya no se copia la funcion: se renombra la vigente a `lineas_de_evento_hist_base` y se envuelve completando la cuenta 3310 de la linea `Libro del socio: reinversion` (compone con cualquier version previa, incluidas las de puente de efectivo y devolucion parcial; debe aplicarse al final de la cadena).
- Dominio puro `src/dominio/historial/ratios.ts` (ROI, ROI anualizado, multiplo, TIR/XIRR, payback, reinversion, payout, retiro mensual, margen, utilidad por pieza, cobertura de caja, participaciones, rachas, mejores/peores, promedio movil, estacionalidad semanal, proyeccion a 3 meses con banda que se estrecha). Sin IA; "Sin dato" cuando falta base.
- Pantallas: `/socios/[socio]/historial` (+ `/pdf`), `/socios/actas/[id]` (+ `/pdf`), formulario de acta con retiro y reinversion por socio en `/socios/cascada`, corte mensual sugerido, enlaces desde Cuenta de socios y Estado de cuenta. "Explicar este numero" en invertido, retirado, utilidad recibida, valor, cuenta y disponible por acta.
- `pdfActaCorte` ahora incluye el sello; nuevo `pdfHistorialSocio`.
- Hallazgos corregidos en el camino: (1) `decisiones` del acta (`retira`/`reinvierte`) llegaba como number aunque el tipo decia bigint (se convierte en `decisionesABigint`; habria roto el PDF existente); (2) `.rtm-region { display: contents }` en `premium.css` (heredado de la etapa 4) rompia el armazon: el panel caia bajo el sidebar a 216 px en cualquier pagina. Se quito esa linea.

## Comandos y resultados reales
- `npx tsc --noEmit`: sin errores. `npx eslint src scripts test`: sin errores. `npm run guardas`: 0 violaciones.
- `npx vitest run` (primera vuelta): 115 archivos, 1747 pruebas pasan (2 expected fail preexistentes). Nuevas: `test/unit/historial/{ratios,tipos,pdf}.test.ts` (32 pruebas).
- `supabase test db` completo (primera vuelta; 45 migraciones y 47 archivos de prueba): todo pasa excepto `024_omar_cuenta_sin_folio` prueba 13 ("ajuste de -60.00", tiene -10000), que FALLA IGUAL en la base sin mis migraciones (preexistente, no es de este carril). Nueva `028_historial_acta.test.sql` (77 pruebas en esa vuelta); incluye el cuadre contable al cerrar el acta con las restricciones diferidas inmediatas.
- Playwright `playwright.historial.config.ts` (5 pruebas, Chromium; ver la tercera vuelta: solo pasa 5/5 en base recien sembrada): sin sesion redirige; propone el acta con retiro y reinversion; firman Angelo y Javier; sello y PDF; historial con ratios, linea de tiempo, vistas semana/dia, explicar cuadra, PDF, historial del otro socio; movil 390 sin scroll horizontal. 5/5 solo con base recien sembrada.
- Capturas: `docs/capturas/historial-acta/` (28: 1440 y 390, claro y oscuro; ninguna con scroll horizontal). Se revisaron a mano; defectos vistos y corregidos: armazon roto, KPI cortado, columnas truncadas, cifras partidas en tarjetas moviles.

## Reparaciones tras el verificador (segunda vuelta)
1. Valor de la participacion (MEDIO): ya no es la mitad plana del capital contable. Decision: valor = su cuenta de capital (aportaciones y reinversiones + utilidad recibida en actas - retiros) + su 50 % de la utilidad que aun no pasa por un acta (regla F). La suma de los dos socios es exactamente el capital contable. ROI, multiplo y TIR descansan en ese valor. `operacion.capital_socio`, `valor_socio`, `cuenta_socio`; sello y cabecera las usan; `explicar_historial:valor` comprueba contra el capital por cuentas (I-1) menos el valor del otro socio.
2. Deuda o credito con la sociedad (MEDIO): ahora = reembolsos por cobrar menos fondos en su poder (adenda 33), ya no la posicion neta. Dos vias reales (posicion neta menos cuenta de capital). La cabecera trae `comprobaciones` (misma funcion que "Explicar este numero") y la pagina ya no fija `comprobacion="cuadra"`.
3. Movil 390 (MEDIO): pastilla de firmas, etiquetas de tarjeta y 'COMPENSACIONES'/'VALOR DE SU PARTICIPACION' corregidos; capturas 390 y 1440 regeneradas y revisadas.
4. Proyeccion (BAJO-MEDIO): payout 0 % o nulo ya no emite un retiro esperado de cero; proyecta la parte y lo dice. Columnas 'Retira (decision)' y 'Reinvierte (decision)' con un pie que explica la diferencia con 'Retirado total'.
5. Integracion: migraciones renumeradas a 20261113200000 y 20261113200100 (por encima de la ultima de las ramas, 20261113100000). La correccion de reinversion ya no copia `lineas_de_evento`: la envuelve (renombra la vigente a `lineas_de_evento_hist_base` y agrega la linea 3310 solo cuando el asiento queda descuadrado por ese monto), asi compone con puente de efectivo, devolucion parcial y paquete perdido. Verificado solo contra la cadena de esta rama; al integrar con las otras ramas hay que repetir pgTAP 016 y 028.
6. La UI ya no resta dinero (BAJO): `api.acta_detalle` trae `por_socio_acta` (disponible, queda por distribuir) y `api.acta_disponible(ini, fin)` alimenta el formulario. El centavo suelto por cubeta sigue sin reproducirse con la demo (cifras pares): pendiente.

### Comandos corridos en esta vuelta y resultado real
- `npx tsc --noEmit`: exit 0. `npx eslint src scripts test`: exit 0. `npm run guardas`: 0 violaciones. `npm run secretos`: 0 hallazgos (3125 archivos).
- `npx vitest run`: 115 archivos, 1748 pasan y 2 expected fail.
- pgTAP en base nueva (proyecto aparte `rtm-hist-v`, puertos 653xx; `supabase start` y `supabase db reset` aplicaron las migraciones sin error; son 45 archivos de migracion, 47 son archivos de prueba): `supabase test db`: 47 archivos, 2294 pruebas; 016 (51) y 028 (88) pasan por separado; solo falla 024 prueba 13 ('ajuste de -60.00'), preexistente y ajena. En el camino, 028 detecto que la primera version de la envoltura de `lineas_de_evento` no corregia el acta con reinversion (debe 1,422,100 contra haber 2,222,100); se corrigio y quedo en verde.
- Playwright `playwright.historial.config.ts` contra `next dev -p 3184` y la base propia `rtm-lane-hist`: pasan 'sin sesion' (1), 'Historial personal' (4) y 'movil 390 sin scroll horizontal' (5). La prueba 2 (proponer octubre con retiro y reinversion) falla porque CR-0003 ya consumio octubre en esa base y las pruebas 2 y 3 (firma, sello, PDF) dependen de ella: NO REPRODUCIDO en e2e; la cobertura equivalente son pgTAP 016 y 028.
- Capturas: `playwright.capturas-historial.config.ts` (390 y 1440, claro y oscuro): revisadas a ojo 390-oscuro-historial-angelo, 390-claro-acta y 1440-claro-historial-javier.

### Limitaciones conocidas
- Las actas ya selladas en la base de demostracion (CR-0001 a CR-0003) conservan el valor plano con que se sellaron (el sello es inmutable): la columna 'Valor de su participacion' de la linea de tiempo muestra esos valores, distintos del KPI actual. Un acta sellada con estas migraciones lleva la nueva valuacion. No hay actas reales.
- `valor_socio` usa la cuenta de capital de hoy aunque el sello o `p_hasta` sea de una fecha pasada; la valuacion contable si es a la fecha pedida.

## Tercera vuelta: reparaciones tras el verificador

Todo en `lane/historial-acta`, sin push, 0 builds, 0 despliegues, solo la base local `rtm-lane-hist` (se uso un `--workdir` temporal con puertos 633xx para no tocar `supabase/config.toml`).

| Hallazgo | Reparacion | Evidencia |
|---|---|---|
| Movil 390: chip 'Firmada' partido y fecha en 3 lineas | `premium.css`: el chip de estado en tarjeta movil ya no parte la palabra (`nowrap`), la tabla Firmas declara Socio como titulo y Estado como principal, la fecha no se parte. | `docs/capturas/historial-acta/390-claro-acta.png` regenerada y vista: 'Firmada' completa, fecha en una linea. |
| Fila Total desalineada | La clave `p` de `totales.celdas` era la columna Periodo; ahora `p2` (Su parte). `DataTable` avisa en desarrollo de claves de totales sin columna (`clavesTotalesHuerfanas`). | `1440-claro-historial-javier.png`: Total (2) bajo Su parte $14,750.00 y Periodo vacio; prueba e2e que comprueba las celdas de la fila Total; vitest `totales-tabla`. |
| Total incluia actas corregidas | `corregida` solo es verdadera con la contra-acta firmada por los dos; con la contra-acta propuesta sale `contra_propuesta` (el acta sigue vigente). El Total y el conteo excluyen las corregidas y el encabezado lo dice. | pgTAP 028: propuesta -> no corregida y `contra_propuesta`; firmada -> corregida, utilidad recibida 0. |
| 'Retirado' omitia `liquidacion_recibida` | Cabecera, serie, flujos de TIR, sello y `explicar retirado` la cuentan igual que `api.socio_cuenta`. | pgTAP 028: tras `registrar_liquidacion_entre_socios('Angelo'->'Javier', 100000)`, retirado de Javier = 100000, coincide con el libro y su comprobacion cuadra; el flujo de TIR la trae. |
| Dos vias tautologicas | 'parte': via 2 = lo repartible del acta menos la parte del otro socio menos lo ya recibido. 'invertido': via 2 = aportaciones declaradas mas la reinversion segun el libro de utilidad. 'retirado' y 'utilidad' suman la apertura firmada, igual que `libro_socio` (con apertura real habrian marcado 'no cuadra'; SIN prueba pgTAP propia con apertura: queda por probar con los datos de apertura). `api.acta_detalle` entrega `utilidad_cuadra` y `por_socio_acta.*.cuadra` y la pagina del acta ya no fija 'cuadra'. | pgTAP 028 comprueba `via2_valor` de 'parte' (600000) e 'invertido' (200000) y los `cuadra` del acta. |
| e2e no reproducible | La suite documenta su precondicion (base recien sembrada) y SALTA con aviso las pruebas 2 y 3 si octubre ya tiene acta, en vez de fallar. | Primera corrida (base sembrada): 5 passed. Segunda corrida inmediata: 3 passed, 2 skipped (con aviso). |
| Reinversion por fecha de firma; proyeccion repetida y `piso()` | La reinversion de la serie se ubica en el periodo del acta de origen. La proyeccion muestra el acumulado a 1, 2 y 3 meses (media x k, banda con varianza predictiva s2 k (1 + k/N)): tres filas distintas, y se conserva el signo (una perdida esperada ya no sale como $0). | pgTAP 028 (serie mes/dia); vitest `proyeccionPersonal` (acumulados 200/400/600, media negativa); captura: reinversion de $11,700 en sep 26 y $1,525 en ago 26. |
| Inexactitudes del informe | Corregido arriba: 45 migraciones (47 son archivos de prueba); 016 = 51 y 028 = 88 por separado (ahora 108). | |

### Comandos corridos y resultado real (tercera vuelta)
- `npx tsc --noEmit`: exit 0. `npx eslint src scripts test`: exit 0. `npm run guardas`: 0 violaciones. `npm run secretos`: 0 hallazgos (3126 archivos).
- `npx vitest run`: 116 archivos, 1751 pasan y 2 expected fail.
- pgTAP: `supabase db reset` limpio (45 migraciones) y `supabase test db`: 47 archivos, 2314 pruebas; falla solo `024_omar_cuenta_sin_folio` prueba 13 (preexistente, fecha fija, ver `docs/union-produccion.md`) y 990 son los TODO esperados. 016: 51 pruebas, 028: 108 pruebas.
- Playwright `playwright.historial.config.ts` contra `next dev -p 3184` y `rtm-lane-hist` sembrada con `datos-demo-historial.mjs`: corrida 1 = 5 passed; corrida 2 (sin re-sembrar) = 3 passed, 2 skipped.
- Capturas 1440 y 390, claro y oscuro, regeneradas con `playwright.capturas-historial.config.ts`; vistas a ojo: 390-claro-acta, 1440-claro-historial-javier, 390-oscuro-historial-angelo.

### Pendientes y limites
- Integracion con `puente-efectivo`, `devolucion-parcial` y `cuadrar-cuentas` NO verificada; repetir pgTAP 016 y 028 al integrar.
- Las sumas de apertura en `explicar retirado` y `explicar utilidad` no tienen prueba con una apertura firmada.
- El valor mostrado en actas ya selladas sigue siendo el del momento del sello (inmutable).
- `explicar_historial` de 'valor' y 'cuenta' no se tocaron.

## Aislamiento
Proyecto Supabase `rtm-lane-hist`, puertos 633xx (solo local), servidor en 3184. Otras sesiones tumbaron una vez mi base y mi servidor (se reiniciaron). `supabase/config.toml` vuelve a los puertos del repo en el ultimo commit.

## Pendientes
- Firma por boton de Telegram y envio del PDF del acta por correo a los socios: pertenecen a los carriles agente-telegram y reportes (aqui solo estan la web y el PDF).
- Estimado del valor personal = valor en libros (rango: sin contar por cobrar a clientes); supuestos editables y flujo descontado quedan para la pagina Valuacion.
- Integracion: prefijos 20261113200000 y 20261113200100 (45 migraciones en total), por encima de todas las ramas revisadas (la mas alta es 20261113100000 de telegram-agente); si otra rama agrega migraciones despues, renumerar la mia al final de la cadena. Otro aviso para quien integre: lane/devolucion-parcial y lane/cuadrar-cuentas comparten el prefijo 20261113000100 con nombres distintos. Tambien la linea de `.rtm-region`; si otro carril quita la misma linea de CSS el merge es identico.
- Sin datos reales cargados: el historial estara en "Sin dato" hasta los datos de apertura.
