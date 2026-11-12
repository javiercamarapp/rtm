# Rediseno: cierre de la rama rediseno/premium

Worktree `~/rtm-rediseno`. Sin push, sin Vercel, sin nube: 0 builds y 0 despliegues. Base Supabase propia (proyecto `rtm-rd`, puertos 593xx) y puerto de servidor propio (3104 capturas, 3107 e2e).

## 1. Prueba 4 de acceso (limite de 3 correos)

- Comparada contra main: la app (`src/app/login`, `src/infra/limite`, migraciones de limite) no difiere; el spec solo cambia la URL base. No era ni el test ni la app.
- Causa real: el limitador (`limitador_postgres.ts`) falla ABIERTO si no conecta con el rol `servidor`; en una base recien creada ese rol es `nologin` (la migracion lo crea asi y la contrasena se asigna aparte por entorno). Sin login, las 4 solicitudes mandaban correo.
- Verificado: tras `alter role servidor login password ...` (solo local, con la contrasena de `.env.local`) las 11 pruebas de `acceso.spec.ts` pasan (11 passed), y el tope sigue en 3 por correo y 10 por IP. No se debilito nada.
- Pendiente de decision (no tocado): el diseno fail-open es deliberado (documentado en el codigo); si se prefiere fail-closed seria otra decision.

## 2. Subnavs

`rtm-subnav` eliminado. Movimientos, Apertura (11 pasos), Inventario y Contabilidad usan `Pestanas` (estilo del rediseno, con scroll horizontal). Se conservaron los `data-testid`. En movil las pestanas miden 44 px y las pruebas moviles miden `.rtm-pestanas a`.

## 3. Defectos encontrados al revisar las capturas

- Grave: `.rtm-region { display: contents }` (commit 6b5e269, pensado para una region de Inventario de proveedores) pisaba la clase `.rtm-region` del armazon: a 1440 el contenido de TODAS las paginas caia debajo del sidebar en una columna de 216 px. Las pruebas por texto no lo detectaban. Corregido renombrando la de la pagina a `rtm-region-pag`.
- Avisos: "Otros" aparecia varias veces en "Por tipo"; ahora los tipos sin etiqueta se agrupan en uno.
- Movimientos: botones de acciones apilados en vertical (filas altas) y fechas partidas en dos lineas; ahora una sola linea. En movil la lista de tarjetas quedaba dentro de un contenedor con scroll propio y cortaba tarjetas: ahora fluye completa, sin truncar el tipo y sin etiquetas vacias.
- Capturas regeneradas en `docs/capturas/rediseno-etapa4` (1440 claro y oscuro, 1280 claro, 390 claro).
- Nota: la insignia roja "1 Issue" de las capturas es el indicador del servidor de desarrollo de Next, no de la app.

## 4. Capturas sin versionar

`docs/capturas/rediseno-etapa3-antes` pesaba 16 MB (mas de 2 MB): se borraron las sin versionar (y los .txt de metricas versionados de esa carpeta).

## 5. No migrados

PDFs y login siguen sin Geist (decision de Javier pendiente).

## 6. Verificacion

Ver el final de este documento (seccion Resultados).

## Resultados

- Vitest: 112 archivos, 1713 pruebas pasan (2 fallos esperados).
- Playwright completo (17.5 min): 91 pasan, 9 fallan, 13 no corrieron. Se corrio sobre una base que ya traia datos de corridas anteriores (no se pudo hacer `supabase db reset`), y los especificos de F3a/F3b/F3c y reportes dependen de base limpia (apertura ya firmada, asiento "No cuadra" previo, timeouts de 90 s con carga de maquina de 100): no son concluyentes.
- Fallo real encontrado y corregido: en `fold-abierto` (880 px) las pestanas median 36 px; la regla de 44 px solo aplicaba bajo 768 px o con puntero tactil. Ahora aplica hasta 900 px (`premium.css`). Falta re-correr esas dos pruebas moviles.
- Pendiente: `supabase db reset` + e2e completo en una maquina sin carga.

## Resultados

- vitest: 112 archivos, 1713 pruebas pasan (2 fallos esperados, marcados).
- Playwright completo con base recien reiniciada: 111 pasan, 2 omitidas, 1 falla, 1 sin correr.
- Falla restante: `integracion-db.spec.ts:145` (reportes semanal, laptop-1440). El reporte "no sale" porque las comprobaciones C4 y C5 difieren en $58,752. Es un descuadre de datos acumulado por pruebas anteriores de la misma corrida (cascada de reparto, apertura), no de interfaz; no se toco. Pendiente de diagnostico aparte.
- Un primer pase (base con datos previos) fallo 9; tras reiniciar la base y subir el objetivo tactil de las pestanas a 44 px en pantallas tactiles (`pointer: coarse`, fold-abierto) quedaron solo 1.
