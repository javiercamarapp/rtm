# Rediseno: cierre de la rama rediseno/premium

Worktree `~/rtm-rediseno`. Sin push, sin Vercel, sin nube: 0 builds de Vercel y 0 despliegues. Las verificaciones se corrieron sobre una copia limpia del arbol con Supabase local propio (proyecto `rtm-fx`, puertos 598xx) y servidor propio (3117 e2e, 3118 capturas). Proyectos ajenos (`rtm-e3`, `likida`) sin tocar.

## 1. Prueba 4 de acceso (limite de 3 correos)

- La app y el spec no difieren de main. Causa real: el limitador (`limitador_postgres.ts`) falla ABIERTO si no conecta con el rol `servidor`, que en una base nueva es `nologin`; `scripts/entorno/generar-env-local.mjs` le asigna login y contrasena local (`alter role servidor login password`). Con eso las pruebas de `acceso.spec.ts` pasan y el tope sigue en 3 por correo y 10 por IP.
- Pendiente de decision de Javier (no tocado): politica fail-open del limitador.

## 2. Subnavs

`rtm-subnav` eliminado. Movimientos, Apertura, Inventario y Contabilidad usan `Pestanas` (con scroll horizontal; 44 px en pantallas tactiles hasta 900 px). Se conservaron los `data-testid`.

## 3. Defectos visuales corregidos

- Grave (antes): `.rtm-region { display: contents }` pisaba la clase del armazon y a 1440 el contenido caia bajo el sidebar. Renombrada a `rtm-region-pag`.
- Avisos: los tipos sin etiqueta se agrupan en uno solo.
- Movimientos: acciones en una fila, fechas en una linea, lista movil completa, sin etiquetas vacias (regla `:has(> .rtm-dt-trunc:empty)`).
- Avisos a 390 px (hallazgo del verificador, corregido en 3406523): la tabla no declaraba prioridades moviles y el aviso quedaba en una columna de ~80 px con la insignia sola. Ahora el aviso es el titulo (dos columnas) y la severidad la cifra principal. Verificado en la captura nueva.
- Movimientos a 390 px (corregido en 3406523): la insignia de estado ('Sin clasificar', 'Conciliado') quedaba recortada con el fondo mas angosto que el texto; ahora `.rtm-chip-estado` dentro de tarjetas moviles usa `width: max-content`. Verificado en la captura nueva. Nota: en avisos la insignia 'Importante' queda a ras del borde interior derecho de la tarjeta (cabe, sin recorte).
- Nota menor sin cambio: en `1440-oscuro-movimientos.png` hay textos de la columna Mensaje truncados con elipsis (comportamiento de `truncar`, con el texto completo en el atributo title).

## 4. Capturas

- Las 110 capturas `docs/capturas/rediseno-etapa4/*.png` (1440, 1280, 390 claro y oscuro, y Omar `mi-*`) se regeneraron con el codigo de HEAD contra un build de produccion (`next build` + `next start`, puerto 3126, Supabase `rtm-fx2` con datos ilustrativos de preparar-demo, a2, a3, contactos y apertura). Comprobacion automatica: un script de PIL cuenta pixeles rojo (212,84,89) en la esquina inferior izquierda de cada PNG: 0 de 110 con el indicador 'N Issue' (antes 80). Revisadas con Read: `1440-claro-mi-cuenta`, `1440-claro-contactos`, `1440-claro-movimientos`, `1440-oscuro-apertura`, `390-claro-mi-paquetes`, `390-claro-contactos`.
- `test/capturas/e4.spec.ts` y `playwright.capturas-e4.config.ts` aceptan `E4_BASE` para apuntar a un build de produccion. El servidor de desarrollo por omision pinta el indicador en la imagen; no usarlo para entregables.
- Metricas de la recaptura: solo lineas COLA (paginas cortas); 0 TABLA, 0 HUECO, 0 SCROLLH, 0 ERROR. Nota: los datos ilustrativos de esta corrida difieren de los anteriores (en Mi cuenta hay 80 pz enviadas y sin toma; antes 100 pz y una toma de $300), por eso las cifras de las capturas no coinciden con las viejas.
- Los 9 `.txt` de `docs/capturas/rediseno-etapa3-antes` que el commit d63d0c0 borro fuera de mandato se restauraron (commit e26070e).

## 4b. Defectos menores corregidos (hallazgos del verificador)

- Contactos a 390 px: el correo ya no se parte a media palabra (la celda ocupa todo el ancho); el telefono enmascarado y el boton Revelar van en una fila completa; el selector 'Elegir' queda arriba a la derecha.
- Filtros de contactos: rejilla `auto-fit` de columnas iguales; los cuatro campos tienen el mismo ancho (a 1440 y a 390). Primer intento con `flex: 1 1 200px` lo detecto la prueba `css_sin_espacio_muerto` (prohibe flex-basis); se cambio a rejilla.
- Mi cuenta (Omar): el hueco entre 'Tus tomas autorizadas de la semana' y la cifra era el margen por omision de un `<p>`; ahora `.omar-cifra-media`.
- Sin corregir (visible en `1440-claro-mi-cuenta`): bajo la tabla 'Renta de esta semana, por dia' queda espacio vacio porque la tarjeta vecina (Proyeccion) es mas alta. Es la rejilla de dos columnas; no se toco.

## 5. No migrados

PDFs y login siguen sin Geist (decision de Javier pendiente).

## Resultados (unica seccion, verificados sobre HEAD de la rama tras fusionar main)

Entorno: copia limpia del arbol (git archive de HEAD mas los cambios) en el scratchpad, Supabase local `rtm-fx2` (puertos 596xx) recien creado, `generar-env-local.mjs`, servidor propio en 3126. Carga de la maquina entre 10 y 22. Sin push, 0 builds de Vercel, 0 despliegues.

- `npx tsc --noEmit`: 0 errores. `npx eslint src scripts test`: 0 problemas. `npm run guardas`: 0 violaciones (baseline 0). `npm run secretos`: 0 hallazgos en 3073 archivos y en el historial (se corre en el repo, no en la copia sin .git).
- `npx vitest run --maxWorkers=4 --testTimeout=90000`: 112 archivos pasan; 1713 pruebas pasan y 2 son fallos esperados.
- `npm run test:integracion`: 3 archivos, 18 de 18.
- pgTAP (`supabase test db`, base recien reseteada): 46 archivos, 2206 pruebas, `Result: PASS`. Antes fallaba `024_omar_cuenta_sin_folio` por fechas fijas; ahora usa el dia de negocio (`negocio.hoy()`, leido una vez como superusuario porque `authenticated` no puede llamarlo). Un primer arreglo con `current_date` fallo cuando el reloj UTC de la base paso la medianoche (13 nov UTC contra 12 nov de negocio): por eso se usa `negocio.hoy()`. Verificado precisamente en ese desfase. Advertencia: correr pgTAP despues de `test:integracion` sin resetear la base da fallos por datos residuales de esas pruebas; resetear antes.
- Playwright completo (`E2E_PUERTO=3126`, base recien reseteada, build de produccion): 113 passed, 2 skipped, 0 failed, 9.1 min; incluye `acceso.spec.ts`.
- Rama: main (f3c9d4a, c01adcc, 5633549) fusionado en 86b285c sin conflictos; `scripts/despliegue/desplegar.mjs` conserva `--incluir-todo` (`git diff main HEAD -- scripts/despliegue` vacio).

## Pendientes

- Decision de Javier: PDFs y login a Geist; politica fail-open del limitador.
- Recapturar con build de produccion (E4_BASE) si se cambia algo visual.
