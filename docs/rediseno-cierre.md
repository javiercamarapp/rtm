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

- Las 26 capturas `390-claro-*.png` de `docs/capturas/rediseno-etapa4` se regeneraron con el codigo actual (commit 5e716c5), contra un build de produccion (`next build` + `next start`), por lo que ya no aparece el indicador '1 Issue' del servidor de desarrollo. Las capturas de 1440 y 1280 no se rehicieron (el cambio de CSS solo afecta tarjetas moviles).
- Alcance declarado: en el commit d63d0c0 se borraron ademas los 9 `.txt` versionados de `docs/capturas/rediseno-etapa3-antes` (metricas de la etapa 3). La tarea solo pedia resolver las capturas sin versionar (que pesaban 16 MB y se borraron); los `.txt` fueron un exceso menor y se recuperan con `git show d63d0c0^:docs/capturas/rediseno-etapa3-antes/<archivo>`.

## 5. No migrados

PDFs y login siguen sin Geist (decision de Javier pendiente).

## Resultados (unica seccion, verificados sobre HEAD de la rama)

Entorno: copia limpia del arbol en el scratchpad, Supabase local `rtm-fx` (puertos 598xx) recien creado, `generar-env-local.mjs`. Carga de la maquina entre 11 y 53 durante las corridas.

- `npx tsc --noEmit`: 0 errores.
- `npx eslint src scripts test`: 0 problemas.
- `npm run guardas`: 0 violaciones (baseline 0).
- `npm run secretos`: 0 hallazgos en 3064 archivos y en el historial.
- `npx vitest run --maxWorkers=4 --testTimeout=90000`: 112 archivos pasan; 1713 pruebas pasan y 2 son fallos esperados (marcados).
- Playwright completo (`E2E_PUERTO=3117`, 4 proyectos, base recien creada sin datos demo, build de produccion): 113 passed, 2 skipped (test.skip existentes), 0 failed, 9.2 min. Incluye `acceso.spec.ts` prueba 4 y la vista previa de reportes.
- pgTAP: no se corrio; esta rama no agrega migraciones (ultima migracion heredada de main: 20261112300000).

Historial explicado (para no confundir con corridas anteriores): una primera pasada sobre una base con datos de capturas fallo 9 pruebas que suponen base vacia; el unico fallo real de integracion-db (reportes) era el encabezado global `X-Frame-Options: DENY`, que bloqueaba el marco de la vista previa `/reportes/:clave/:version/html`; se corrigio (6f7f2cd) con `SAMEORIGIN` y `frame-ancestors 'self'` solo en esa ruta. El descuadre de $58,752 entre C4 y C5 que se llego a atribuir a datos NO era la causa; la causa fue el bloqueo de marco.

## Pendientes

- Decision de Javier: PDFs y login a Geist; politica fail-open del limitador.
- Recapturar 1440 y 1280 si se cambia algo de las tablas de escritorio.
